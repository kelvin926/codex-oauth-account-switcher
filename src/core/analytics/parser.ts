import type { TokenCounts, UsageEvent } from '../../shared/features.js';

export type ParserState = {
  session: string; createdAt: string; fork: boolean; model: string; effort: string; provider: string; turn: string;
  previous: TokenCounts | null; skipped: number;
};
export const emptyCounts = (): TokenCounts => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 });
export const createParserState = (session: string): ParserState => ({
  session, createdAt: '', fork: false, model: '확인 불가', effort: '확인 불가', provider: '확인 불가', turn: '', previous: null, skipped: 0
});
export function counts(raw: any): TokenCounts | null {
  if (!raw || !Number.isSafeInteger(raw.total_tokens) || raw.total_tokens < 0) return null;
  const result = emptyCounts();
  for (const [key, wire] of Object.entries({ input: 'input_tokens', cached: 'cached_input_tokens', cacheWrite: 'cache_write_input_tokens', output: 'output_tokens', reasoning: 'reasoning_output_tokens', total: 'total_tokens' })) {
    const value = raw[wire] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) return null;
    result[key as keyof TokenCounts] = value;
  }
  return result;
}
const text = (v: unknown, fallback = '확인 불가') => typeof v === 'string' && v.length <= 300 ? v : fallback;

/** Read only metadata and numeric usage. Never persist message/tool text or authentication. */
export function parseRolloutLine(line: string, state: ParserState): UsageEvent | null {
  if (!/"(?:session_meta|turn_context|token_count|model_reroute)"/.test(line)) return null;
  let item: any;
  try { item = JSON.parse(line); } catch { state.skipped++; return null; }
  const p = item.payload;
  if (!p || typeof p !== 'object') return null;
  if (item.type === 'session_meta') {
    state.session = text(p.id, state.session);
    state.createdAt = text(p.timestamp, '');
    state.fork = !!p.forked_from_id || !!p.parent_thread_id;
    state.provider = text(p.model_provider);
    // creator_account_id is immutable creation metadata, NOT the billing account on resume.
    return null;
  }
  if (item.type === 'turn_context') {
    state.turn = text(p.turn_id, '');
    state.model = text(p.model);
    state.effort = text(p.effort ?? p.reasoning_effort ?? p.collaboration_mode?.settings?.reasoning_effort);
    return null;
  }
  if (item.type !== 'event_msg') return null;
  if (p.type === 'model_reroute') { state.model = text(p.to_model ?? p.toModel); return null; }
  if (p.type !== 'token_count' || !p.info) return null;
  const current = counts(p.info.total_token_usage);
  const last = counts(p.info.last_token_usage);
  if (!current) { state.skipped++; return null; }
  const previous = state.previous;
  state.previous = current;
  const timestamp = Date.parse(item.timestamp);
  if (!Number.isFinite(timestamp)) { state.skipped++; return null; }
  // Fork prefixes are inherited context, not new spending. Keep their counters as a baseline.
  if (state.fork && (!state.createdAt || timestamp < Date.parse(state.createdAt))) return null;
  if (previous && current.total <= previous.total) {
    if (current.total < previous.total) state.skipped++; // Compaction/revert: never count a negative reset.
    return null;
  }
  if (!last || last.total === 0) { state.skipped++; return null; }
  if (!previous && current.total > last.total) state.skipped++;
  const delta = previous ? current.total - previous.total : last.total;
  if (delta !== last.total) state.skipped++; // Missing observations are not assigned to the current model.
  if (delta < last.total) return null;
  return {
    ...last,
    id: `${state.session}:${state.turn}:${timestamp}:${current.total}`,
    at: new Date(timestamp).toISOString(), session: state.session, turn: state.turn,
    model: state.model, effort: state.effort, provider: state.provider,
    accountId: null, attribution: 'unknown'
  };
}
