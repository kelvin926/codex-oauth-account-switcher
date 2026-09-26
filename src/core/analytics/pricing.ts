import type { CostSummary, UsageEvent } from '../../shared/features.js';

// USD / 1M tokens, Standard API reference prices verified 2026-09-26.
// Sources: developers.openai.com/api/docs/pricing and /models/gpt-5.6-{sol,terra,luna}.
export const PRICING_DATE = '2026-09-26';
type Rate = { input: number; cached: number; write: number; output: number; long: boolean };
const rates: Record<string, Rate> = {
  'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50, long: true },
  'gpt-6-sol': { input: 2, cached: .2, write: 2.5, output: 10, long: true },
  'gpt-6-luna': { input: .1, cached: .01, write: .125, output: .5, long: true },
  'gpt-5.6-sol': { input: 4, cached: .4, write: 5, output: 20, long: false },
  'gpt-5.6-terra': { input: 2, cached: .2, write: 2.5, output: 12, long: false },
  'gpt-5.6-luna': { input: .2, cached: .02, write: .25, output: 1.2, long: false }
};
export const emptyCost = (): CostSummary => ({ usd: 0, cacheSavingsUsd: 0, pricedEvents: 0, unpricedEvents: 0, assumedWriteEvents: 0, cacheKnownInput: 0, cacheKnownRead: 0, cacheUnknownEvents: 0 });
export function hasCacheCount(e: UsageEvent) { return e.cacheKnown ?? e.cached > 0; }
export function cacheHit(cost: CostSummary): number | null { return cost.cacheKnownInput > 0 ? cost.cacheKnownRead / cost.cacheKnownInput * 100 : null; }
export function priceEvent(e: UsageEvent): { usd: number; savings: number; assumedWrite: boolean } | null {
  let name = e.model.toLowerCase().replace(/\s+/g, '-').replace(/-\d{4}-\d{2}-\d{2}$/, '');
  if (name === 'gpt-5.6') name = 'gpt-5.6-sol';
  const rate = rates[name];
  if (!rate || e.provider !== 'openai' || !hasCacheCount(e) || e.cached + e.cacheWrite > e.input || e.input + e.output !== e.total) return null;
  // Do not invent unverified long-context tariffs for older families or custom aliases.
  if (e.input > 272_000 && !rate.long) return null;
  const inputMultiplier = e.input > 272_000 ? 2 : 1;
  const outputMultiplier = e.input > 272_000 ? 1.5 : 1;
  const ordinary = e.input - e.cached - e.cacheWrite;
  const usd = ((ordinary * rate.input + e.cached * rate.cached + e.cacheWrite * rate.write) * inputMultiplier + e.output * rate.output * outputMultiplier) / 1e6;
  const withoutCache = (e.input * rate.input * inputMultiplier + e.output * rate.output * outputMultiplier) / 1e6;
  return { usd, savings: withoutCache - usd, assumedWrite: e.cacheWriteKnown !== true && e.cacheWrite === 0 };
}
export function addCost(cost: CostSummary, e: UsageEvent, price = priceEvent(e)) {
  if (hasCacheCount(e) && e.cached <= e.input) { cost.cacheKnownInput += e.input; cost.cacheKnownRead += e.cached; }
  else cost.cacheUnknownEvents++;
  if (!price) { cost.unpricedEvents++; return; }
  cost.usd += price.usd; cost.cacheSavingsUsd += price.savings; cost.pricedEvents++;
  if (price.assumedWrite) cost.assumedWriteEvents++;
}
