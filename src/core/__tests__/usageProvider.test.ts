import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUsageFromAccessToken, parseUsageResponse, UsageAuthExpiredError } from '../adapters/usageProvider';
import { formatWindowLabel, getUsageWindows } from '../usageWindows';

const now = new Date('2026-09-22T12:00:00Z');
afterEach(() => vi.unstubAllGlobals());

describe('server-provided quota windows', () => {
  it('reads reset-credit totals and decimal credit balances from the usage response', () => {
    const { usage } = parseUsageResponse({
      rate_limit: { allowed: true },
      rate_limit_reset_credits: { available_count: 3, credits: [{ id: 'one-visible-row' }] },
      credits: { has_credits: true, unlimited: false, balance: '1234.5678' }
    }, now);
    expect(usage.availableResetCredits).toBe(3);
    expect(usage.credits).toEqual({ hasCredits: true, unlimited: false, balance: 1234.5678 });
  });

  it('accepts credit-based accounts without quota windows and preserves a zero balance', () => {
    const { usage } = parseUsageResponse({
      rate_limit: null,
      rate_limit_reset_credits: { available_count: 0 },
      credits: { has_credits: false, unlimited: false, balance: '0' }
    }, now);
    expect(usage.availableResetCredits).toBe(0);
    expect(usage.credits?.balance).toBe(0);
    expect(getUsageWindows(usage)).toEqual([]);
  });

  it('keeps absent or malformed optional balances unknown while retaining valid usage', () => {
    for (const balance of [null, '', ' ', false, '-1', 'not-a-number', Infinity]) {
      const { usage } = parseUsageResponse({ rate_limit: { allowed: true },
        credits: { balance }, rate_limit_reset_credits: { available_count: -1 } }, now);
      expect(usage.credits).toBeNull();
      expect(usage.availableResetCredits).toBeNull();
    }
    const { usage } = parseUsageResponse({ rate_limit: { allowed: true } }, now);
    expect(usage.credits).toBeNull();
    expect(usage.availableResetCredits).toBeNull();
  });

  it('preserves explicit unlimited credits without inferring a balance', () => {
    const { usage } = parseUsageResponse({
      credits: { has_credits: true, unlimited: true, balance: null }
    }, now);
    expect(usage.credits).toEqual({ hasCredits: true, unlimited: true, balance: null });
  });

  it('supports weekly-only Pro without manufacturing a zero-percent five-hour limit', () => {
    const result = parseUsageResponse({ plan_type: 'pro', rate_limit: {
      primary_window: null,
      secondary_window: { used_percent: 24, limit_window_seconds: 604800 }
    } }, now);
    expect(result.usage.primaryRemainingPercent).toBeNull();
    expect(result.usage.primaryResetAt).toBeNull();
    const windows = getUsageWindows(result.usage);
    expect(windows).toHaveLength(1);
    expect(windows[0].remaining).toBe(76);
    expect(formatWindowLabel(windows[0].seconds, windows[0].key)).toBe('1주');
  });

  it('also recognizes a weekly window in the primary slot', () => {
    const result = parseUsageResponse({ rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 604800, reset_after_seconds: 60 }
    } }, now);
    const [window] = getUsageWindows(result.usage);
    expect(formatWindowLabel(window.seconds, window.key)).toBe('1주');
    expect(window.resetAt).toBe('2026-09-22T12:01:00.000Z');
    expect(result.usage.secondaryRemainingPercent).toBeNull();
  });

  it('keeps both windows when actually returned, regardless of plan name', () => {
    const result = parseUsageResponse({ plan_type: 'pro', rate_limit: {
      primary_window: { used_percent: 100, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 20, limit_window_seconds: 604800 }
    } }, now);
    expect(getUsageWindows(result.usage).map(w => w.remaining)).toEqual([0, 80]);
  });

  it('does not claim unlimited usage or invent resets when windows are absent', () => {
    const result = parseUsageResponse({ rate_limit: { allowed: true, primary_window: null, secondary_window: null } }, now);
    expect(getUsageWindows(result.usage)).toEqual([]);
    expect(result.usage.primaryResetAt).toBeNull();
  });

  it('rejects malformed responses instead of treating them as a quota', () => {
    for (const payload of [null, {}, { rate_limit: {} }, { rate_limit: { primary_window: {} } }]) {
      expect(() => parseUsageResponse(payload, now)).toThrow();
    }
  });

  it('bounds percentages and tolerates unavailable reset timestamps', () => {
    const { usage } = parseUsageResponse({ rate_limit: {
      primary_window: { used_percent: -20, reset_at: 1e99 },
      secondary_window: { used_percent: 150 }
    } }, now);
    expect(usage.primaryRemainingPercent).toBe(100);
    expect(usage.secondaryRemainingPercent).toBe(0);
    expect(usage.primaryResetAt).toBeNull();
  });
});

describe('usage requests', () => {
  it('sends workspace identity and a bounded timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rate_limit: { allowed: true } })));
    vi.stubGlobal('fetch', fetchMock);
    await fetchUsageFromAccessToken('test-token', 'test-account');
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers['ChatGPT-Account-Id']).toBe('test-account');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('marks only 401 as expired; a 403 does not prove expiry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(fetchUsageFromAccessToken('test')).rejects.toBeInstanceOf(UsageAuthExpiredError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(fetchUsageFromAccessToken('test')).rejects.not.toBeInstanceOf(UsageAuthExpiredError);
  });
});
