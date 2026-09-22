import type { UsageSnapshot } from './types.js';

export function getUsageWindows(usage: UsageSnapshot | null) {
  if (!usage) return [];
  return [
    { key: 'primary', remaining: usage.primaryRemainingPercent, resetAt: usage.primaryResetAt,
      seconds: usage.primaryWindowSeconds === undefined ? 5 * 3600 : usage.primaryWindowSeconds },
    { key: 'secondary', remaining: usage.secondaryRemainingPercent, resetAt: usage.secondaryResetAt,
      seconds: usage.secondaryWindowSeconds === undefined ? 7 * 86400 : usage.secondaryWindowSeconds }
  ].filter((window): window is typeof window & { remaining: number } =>
    typeof window.remaining === 'number' && Number.isFinite(window.remaining));
}

export function formatWindowLabel(seconds: number | null, key: string): string {
  if (!seconds) return key === 'primary' ? '첫 번째 한도' : '두 번째 한도';
  if (seconds % 604800 === 0) return `${seconds / 604800}주`;
  if (seconds % 86400 === 0) return `${seconds / 86400}일`;
  if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
  if (seconds % 60 === 0) return `${seconds / 60}분`;
  return `${seconds}초`;
}
