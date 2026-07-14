import { getAuthBundleSwitchability, parseAuthBundle } from './authBundle.js';
import type { AccountRecord } from './types.js';

type DiscoveredBundle = {
  bundlePath: string;
  payload: string;
};

export async function checkpointCurrentAccount(
  accounts: AccountRecord[],
  rawAuth: string,
  saveBundle: (accountId: string, payload: string) => Promise<string>,
  now = new Date()
): Promise<AccountRecord[]> {
  const parsed = parseAuthBundle(rawAuth);
  const current = accounts.find((account) => account.id === parsed.accountId);
  if (!current) {
    return accounts;
  }

  const switchability = getAuthBundleSwitchability(rawAuth);
  if (!switchability.canSwitch) {
    throw new Error(
      switchability.reason ?? '현재 계정의 갱신 토큰을 저장할 수 없어 안전하게 전환할 수 없습니다.'
    );
  }

  const bundlePath = await saveBundle(current.id, rawAuth);
  return accounts.map((account) =>
    account.id === current.id
      ? {
          ...account,
          bundlePath,
          authSource: 'codex-auth-file',
          canSwitch: true,
          switchBlockedReason: null,
          updatedAt: now.toISOString()
        }
      : account
  );
}

export function mergeDiscoveredAccounts(
  accounts: AccountRecord[],
  discovered: DiscoveredBundle[],
  now = new Date()
): AccountRecord[] {
  const known = new Set(accounts.map((account) => account.id));
  const recovered: AccountRecord[] = [];

  for (const entry of discovered) {
    try {
      const parsed = parseAuthBundle(entry.payload);
      if (known.has(parsed.accountId)) {
        continue;
      }

      const switchability = getAuthBundleSwitchability(entry.payload);
      recovered.push({
        id: parsed.accountId,
        label: parsed.email ?? `복구된 계정 ${parsed.accountId.slice(0, 8)}`,
        bundlePath: entry.bundlePath,
        authSource: 'codex-auth-file',
        canSwitch: switchability.canSwitch,
        switchBlockedReason: switchability.reason,
        status: switchability.canSwitch ? 'needs-refresh' : 'error',
        planType: parsed.planType,
        usage: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
      known.add(parsed.accountId);
    } catch {
      // Keep unreadable bundles on disk for manual recovery, but do not break the dashboard.
    }
  }

  return [...accounts, ...recovered];
}
