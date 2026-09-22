import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { AuthFileAdapter } from '../adapters/authFileAdapter';
import { switchAccount } from '../switchOrchestrator';
import type { AccountRecord, AuthAdapter, RestartVerificationStore } from '../types';

const account: AccountRecord = {
  id: 'account-1',
  label: 'Primary',
  bundlePath: 'bundle.bin',
  authSource: 'codex-auth-file',
  canSwitch: true,
  switchBlockedReason: null,
  status: 'ready',
  planType: 'plus',
  usage: {
    fetchedAt: '2026-04-08T00:00:00.000Z',
    source: 'fixture',
    primaryRemainingPercent: 70,
    secondaryRemainingPercent: 60,
    primaryResetAt: '2026-04-08T05:00:00.000Z',
    secondaryResetAt: '2026-04-15T00:00:00.000Z'
  },
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
};

describe('switch orchestrator', () => {
  it('restores the backup if auth writing fails', async () => {
    let restored = false;
    const authAdapter: AuthAdapter = {
      backupCurrentAuth: async () => 'backup.json',
      readCurrentAuth: async () => JSON.stringify({ account_id: 'old' }),
      writeBundle: async () => {
        throw new Error('write failed');
      },
      restoreBackup: async () => {
        restored = true;
      }
    };

    const verificationStore: RestartVerificationStore = {
      markPending: async () => {
        throw new Error('should not run');
      }
    };

    await expect(switchAccount(account, JSON.stringify({ account_id: 'new' }), authAdapter, verificationStore)).rejects.toThrow('write failed');
    expect(restored).toBe(true);
  });

  it('switches to a saved account after logout removes the current auth file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'switch-logged-out-test-'));
    const authPath = join(root, 'auth.json');
    const adapter = new AuthFileAdapter(authPath, join(root, 'backups'));
    const bundle = JSON.stringify({ account_id: account.id });
    const markPending = vi.fn(async () => undefined);

    await switchAccount(account, bundle, adapter, { markPending });

    await expect(readFile(authPath, 'utf8')).resolves.toBe(`${bundle}\n`);
    expect(markPending).toHaveBeenCalledWith(expect.objectContaining({ accountId: account.id }));
  });

  it('removes newly written auth if recording the switch fails while logged out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'switch-logged-out-rollback-test-'));
    const authPath = join(root, 'auth.json');
    const adapter = new AuthFileAdapter(authPath, join(root, 'backups'));

    await expect(
      switchAccount(account, JSON.stringify({ account_id: account.id }), adapter, {
        markPending: async () => { throw new Error('state write failed'); }
      })
    ).rejects.toThrow('state write failed');

    await expect(readFile(authPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
