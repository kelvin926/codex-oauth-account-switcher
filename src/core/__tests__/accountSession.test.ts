import { describe, expect, it, vi } from 'vitest';
import { checkpointCurrentAccount, mergeDiscoveredAccounts } from '../accountSession';
import type { AccountRecord } from '../types';

function createAuth(accountId: string, refreshToken = 'refresh'): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: `${accountId}@example.com`,
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: 'plus'
      }
    })
  ).toString('base64url');

  return JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: `header.${payload}.signature`,
      refresh_token: refreshToken,
      id_token: 'id-token',
      account_id: accountId
    }
  });
}

const account: AccountRecord = {
  id: 'work',
  label: 'Work',
  bundlePath: 'old.bundle',
  authSource: 'codex-auth-file',
  canSwitch: true,
  switchBlockedReason: null,
  status: 'ready',
  planType: 'plus',
  usage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

describe('account session maintenance', () => {
  it('checkpoints the latest rotating refresh token before switching away', async () => {
    const saveBundle = vi.fn(async () => 'latest.bundle');
    const rawAuth = createAuth('work', 'rotated-refresh-token');

    const next = await checkpointCurrentAccount(
      [account],
      rawAuth,
      saveBundle,
      new Date('2026-07-14T01:00:00.000Z')
    );

    expect(saveBundle).toHaveBeenCalledWith('work', rawAuth);
    expect(next[0]).toMatchObject({
      bundlePath: 'latest.bundle',
      updatedAt: '2026-07-14T01:00:00.000Z'
    });
  });

  it('rebuilds missing catalog entries from intact encrypted bundles', () => {
    const recovered = mergeDiscoveredAccounts(
      [],
      [{ bundlePath: 'bundles/work.bundle', payload: createAuth('work') }],
      new Date('2026-07-14T01:00:00.000Z')
    );

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: 'work',
      label: 'work@example.com',
      bundlePath: 'bundles/work.bundle',
      canSwitch: true
    });
  });
});
