import type { AccountRecord } from './types.js';
import { PLAN_CAPACITY_MULTIPLIER } from './planType.js';
import { getUsageWindows } from './usageWindows.js';

const RESET_BONUS_WEIGHT = 0.35;

function getResetUrgencyMultiplier(
  resetAt: string | null | undefined,
  windowHours: number | null,
  now = new Date()
): number {
  if (!resetAt || !windowHours) {
    return 1;
  }

  const resetTime = new Date(resetAt);
  if (Number.isNaN(resetTime.getTime()) || resetTime.getTime() <= now.getTime()) {
    return 1;
  }

  const hoursUntilReset = Math.max(0, (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));
  const normalizedRemainingWindow = Math.min(1, hoursUntilReset / windowHours);

  return 1 + (1 - normalizedRemainingWindow) * RESET_BONUS_WEIGHT;
}

export function computeEffectiveRemaining(account: AccountRecord): number {
  if (!account.usage || account.usage.allowed === false || account.usage.limitReached) {
    return 0;
  }

  const windows = getUsageWindows(account.usage);
  if (windows.length === 0) return 0;
  return Math.min(...windows.map((window) =>
    Math.min(100, Math.max(0, window.remaining)) *
      getResetUrgencyMultiplier(window.resetAt, window.seconds ? window.seconds / 3600 : null)
  )) * (PLAN_CAPACITY_MULTIPLIER[account.planType] ?? 1);
}

export function chooseRecommendedAccount(accounts: AccountRecord[]): AccountRecord | null {
  const eligibleAccounts = accounts.filter(
    (account) => account.status === 'ready' && account.canSwitch !== false &&
      computeEffectiveRemaining(account) > 0
  );

  if (eligibleAccounts.length === 0) {
    return null;
  }

  return [...eligibleAccounts].sort((left, right) => {
    const remainingDelta = computeEffectiveRemaining(right) - computeEffectiveRemaining(left);

    if (remainingDelta !== 0) {
      return remainingDelta;
    }

    return left.label.localeCompare(right.label);
  })[0] ?? null;
}
