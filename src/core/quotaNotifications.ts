import { getUsageWindows } from './usageWindows.js';
import type { UsageSnapshot } from './types.js';
export type QuotaNoticeState = { at: string; low: boolean; weeklyAt: string | null; used: number | null; reset: string | null };
export function quotaNotice(previous: QuotaNoticeState | undefined, usage: UsageSnapshot, threshold: number) {
  const windows = getUsageWindows(usage);
  if (!windows.length || !Number.isFinite(Date.parse(usage.fetchedAt)) || (previous && usage.fetchedAt <= previous.at)) return null;
  const remaining = Math.min(...windows.map(w => w.remaining));
  const week = windows.find(w => w.seconds === 604800);
  const used = week ? 100 - week.remaining : null;
  // Missing weekly data must not wipe out the last usable baseline.
  const state: QuotaNoticeState = { at: usage.fetchedAt, low: remaining <= threshold,
    weeklyAt: week ? usage.fetchedAt : previous?.weeklyAt ?? null,
    used: used ?? previous?.used ?? null, reset: week ? week.resetAt : previous?.reset ?? null };
  const drop = used !== null && previous?.used !== null && previous?.used !== undefined ? previous.used - used : 0;
  // Ignore rounding noise. Same reset timestamp is valid for an unscheduled reset.
  const reset = !!week && !!previous && (drop >= 1 || (drop > 0 && week.resetAt !== previous.reset));
  return { state, reset, low: state.low && !previous?.low, remaining, before: previous?.used ?? null, used };
}
