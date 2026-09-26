import type { CostSummary, PricingOptions, ServiceTier, UsageEvent } from '../../shared/features.js';

// Codex app / ChatGPT sign-in credits per 1M tokens. Not API token prices.
// https://learn.chatgpt.com/docs/pricing
// https://learn.chatgpt.com/docs/agent-configuration/speed
// https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing
export const PRICING_DATE = '2026-09-26';
// USD conversion is an editable comparison assumption, not a universal credit purchase price.
export const DEFAULT_PRICING: PricingOptions = { creditUsd: .04, unknownSpeed: 'exclude' };
export const LONG_CONTEXT_TOKENS = 272_000; // Per-request input, never cumulative session tokens or configured capacity.
type Rate = { input: number; cached: number; output: number; fast: number };
const rates: Record<string, Rate> = {
  'gpt-6-astra': { input: 250, cached: 25, output: 1250, fast: 2.5 },
  'gpt-6-sol': { input: 50, cached: 5, output: 250, fast: 2.5 },
  'gpt-6-luna': { input: 2.5, cached: .25, output: 12.5, fast: 2.5 },
  'gpt-5.6-sol': { input: 100, cached: 10, output: 500, fast: 2.5 },
  'gpt-5.6-terra': { input: 50, cached: 5, output: 300, fast: 2.5 },
  'gpt-5.6-luna': { input: 5, cached: .5, output: 30, fast: 2.5 },
  'gpt-5.5': { input: 125, cached: 12.5, output: 750, fast: 2.5 }
};
export function pricingOptions(raw?: Partial<PricingOptions> | null): PricingOptions {
  return {
    creditUsd: typeof raw?.creditUsd === 'number' && Number.isFinite(raw.creditUsd) && raw.creditUsd > 0 && raw.creditUsd <= 100 ? raw.creditUsd : DEFAULT_PRICING.creditUsd,
    unknownSpeed: raw?.unknownSpeed === 'standard' || raw?.unknownSpeed === 'fast' ? raw.unknownSpeed : 'exclude'
  };
}
export const tierText = (tier?: ServiceTier) => ({standard:'Standard',fast:'Fast',unknown:'속도 미기록',unsupported:'미지원 속도'}[tier ?? 'unknown']);
export const emptyCost = (): CostSummary => ({ usd: 0, credits: 0, cacheSavingsUsd: 0, fastExtraUsd: 0, contextExtraUsd: 0, fastEvents: 0, contextExemptEvents: 0, longContextEvents: 0, unknownSpeedEvents: 0, assumedEvents: 0, pricedEvents: 0, unpricedEvents: 0, cacheKnownInput: 0, cacheKnownRead: 0, cacheUnknownEvents: 0 });
export function hasCacheCount(e: UsageEvent) { return e.cacheKnown ?? e.cached > 0; }
export function cacheHit(cost: CostSummary): number | null { return cost.cacheKnownInput > 0 ? cost.cacheKnownRead / cost.cacheKnownInput * 100 : null; }
export function priceEvent(e: UsageEvent, options: PricingOptions = DEFAULT_PRICING) {
  let name = e.model.toLowerCase().replace(/\s+/g, '-').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (name === 'gpt-5.6') name = 'gpt-5.6-sol';
  const rate = rates[name];
  if (!rate || e.provider !== 'openai' || !hasCacheCount(e) || e.cached + e.cacheWrite > e.input || e.input + e.output !== e.total) return null;
  const unknownSpeed = !e.serviceTier || e.serviceTier === 'unknown';
  const speed = unknownSpeed ? options.unknownSpeed : e.serviceTier;
  if (speed !== 'standard' && speed !== 'fast') return null;
  const long = e.input > LONG_CONTEXT_TOKENS;
  const contextExempt = long && name === 'gpt-6-astra';
  const inputMultiplier = long && !contextExempt ? 2 : 1;
  const outputMultiplier = long && !contextExempt ? 1.5 : 1;
  const fastMultiplier = speed === 'fast' ? rate.fast : 1;
  // Cache writes are ordinary input in Codex credit billing. Reasoning is already output.
  const inputCost = ((e.input - e.cached) * rate.input + e.cached * rate.cached) / 1e6;
  const outputCost = e.output * rate.output / 1e6;
  const base = inputCost + outputCost;
  const contextCost = inputCost * inputMultiplier + outputCost * outputMultiplier;
  const credits = contextCost * fastMultiplier;
  const withoutCache = (e.input * rate.input * inputMultiplier + e.output * rate.output * outputMultiplier) / 1e6 * fastMultiplier;
  return { credits, usd: credits * options.creditUsd, savings: (withoutCache - credits) * options.creditUsd,
    contextExtraUsd: (contextCost - base) * options.creditUsd,
    fastExtraUsd: contextCost * (fastMultiplier - 1) * options.creditUsd,
    fast: speed === 'fast', contextExempt, assumed: unknownSpeed || e.tierSource === 'thread-default' };
}
export function addCost(cost: CostSummary, e: UsageEvent, price = priceEvent(e)) {
  if (hasCacheCount(e) && e.cached <= e.input) { cost.cacheKnownInput += e.input; cost.cacheKnownRead += e.cached; }
  else cost.cacheUnknownEvents++;
  if (!e.serviceTier || e.serviceTier === 'unknown') cost.unknownSpeedEvents++;
  if (e.input > LONG_CONTEXT_TOKENS) cost.longContextEvents++;
  if (!price) { cost.unpricedEvents++; return; }
  cost.usd += price.usd; cost.credits += price.credits; cost.cacheSavingsUsd += price.savings; cost.pricedEvents++;
  cost.fastExtraUsd += price.fastExtraUsd; cost.contextExtraUsd += price.contextExtraUsd;
  if (price.fast) cost.fastEvents++;
  if (price.contextExempt) cost.contextExemptEvents++;
  if (price.assumed) cost.assumedEvents++;
}
