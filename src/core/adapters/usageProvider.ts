import type { CreditsSnapshot, PlanType, UsageSnapshot } from '../types.js';
import { normalizePlanType } from '../planType.js';

export class UsageAuthExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageAuthExpiredError';
  }
}

export type UsageFetchResult = {
  email: string | null;
  planType: PlanType;
  usage: UsageSnapshot;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseCredits(value: unknown): CreditsSnapshot | null {
  const credits = object(value);
  if (!credits) return null;
  const rawBalance = credits.balance;
  // The backend sends a decimal string. Never coerce null, blanks or booleans to zero.
  const numericBalance = typeof rawBalance === 'number' ? rawBalance :
    typeof rawBalance === 'string' && /^\d+(?:\.\d+)?$/.test(rawBalance.trim())
      ? Number(rawBalance.trim()) : NaN;
  const balance = Number.isFinite(numericBalance) && numericBalance >= 0 ? numericBalance : null;
  const hasCredits = typeof credits.has_credits === 'boolean' ? credits.has_credits : null;
  const unlimited = typeof credits.unlimited === 'boolean' ? credits.unlimited : null;
  return balance === null && hasCredits === null && unlimited === null
    ? null : { balance, hasCredits, unlimited };
}

function parseResetCreditCount(value: unknown): number | null {
  const count = object(value)?.available_count;
  // The detail list can be capped; available_count is the authoritative total.
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function parseWindow(value: unknown, now: number) {
  if (value === null || value === undefined) return { remaining: null, resetAt: null, seconds: null };
  const window = object(value);
  if (!window || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) {
    throw new Error('사용량 응답의 제한 정보를 읽을 수 없습니다. 다시 갱신해 주세요.');
  }
  const resetAt = positiveNumber(window.reset_at);
  const resetAfter = typeof window.reset_after_seconds === 'number' &&
    Number.isFinite(window.reset_after_seconds) && window.reset_after_seconds >= 0
    ? window.reset_after_seconds : null;
  const resetMs = resetAt !== null ? resetAt * 1000 : resetAfter !== null ? now + resetAfter * 1000 : null;
  const resetDate = resetMs === null ? null : new Date(resetMs);
  return {
    remaining: Math.min(100, Math.max(0, 100 - window.used_percent)),
    resetAt: resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : null,
    seconds: positiveNumber(window.limit_window_seconds)
  };
}

export function parseUsageResponse(value: unknown, now = new Date()): UsageFetchResult {
  const payload = object(value);
  const rateLimit = object(payload?.rate_limit);
  const credits = parseCredits(payload?.credits);
  const availableResetCredits = parseResetCreditCount(payload?.rate_limit_reset_credits);
  const hasRateLimit = rateLimit && ('primary_window' in rateLimit || 'secondary_window' in rateLimit ||
    typeof rateLimit.allowed === 'boolean' || typeof rateLimit.limit_reached === 'boolean');
  if (!payload || (!hasRateLimit && !credits && availableResetCredits === null)) {
    throw new Error('서버가 사용량 제한 정보를 반환하지 않았습니다. 다시 갱신해 주세요.');
  }
  const primary = parseWindow(rateLimit?.primary_window, now.getTime());
  const secondary = parseWindow(rateLimit?.secondary_window, now.getTime());
  return {
    email: typeof payload.email === 'string' ? payload.email : null,
    planType: normalizePlanType(typeof payload.plan_type === 'string' ? payload.plan_type : null),
    usage: {
      fetchedAt: now.toISOString(),
      source: 'live',
      primaryRemainingPercent: primary.remaining,
      secondaryRemainingPercent: secondary.remaining,
      primaryResetAt: primary.resetAt,
      secondaryResetAt: secondary.resetAt,
      primaryWindowSeconds: primary.seconds,
      secondaryWindowSeconds: secondary.seconds,
      allowed: typeof rateLimit?.allowed === 'boolean' ? rateLimit.allowed : undefined,
      limitReached: typeof rateLimit?.limit_reached === 'boolean' ? rateLimit.limit_reached : undefined,
      availableResetCredits,
      credits
    }
  };
}

export async function fetchUsageFromAccessToken(accessToken: string, accountId?: string): Promise<UsageFetchResult> {
  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      'User-Agent': 'Mozilla/5.0'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new UsageAuthExpiredError(`Usage request failed with status ${response.status}`);
    }
    // A 403 can also be a workspace policy or network restriction, not token expiry.
    throw new Error(`Usage request failed with status ${response.status}`);
  }
  return parseUsageResponse(await response.json());
}
