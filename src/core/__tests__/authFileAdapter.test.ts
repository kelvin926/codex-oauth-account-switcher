import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AuthFileAdapter } from '../adapters/authFileAdapter';

const reverseSecretBox = {
  encrypt: (value: string) => value.split('').reverse().join(''),
  decrypt: (value: string) => value.split('').reverse().join('')
};

describe('auth file adapter', () => {
  it('writes a new auth bundle and creates a backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'auth-file-test-'));
    const authPath = join(root, 'auth.json');
    const backupRoot = join(root, 'backups');
    await writeFile(authPath, JSON.stringify({ account_id: 'old' }), 'utf8');
    await mkdir(join(root, 'sessions'));
    await writeFile(join(root, 'config.toml'), 'model = "gpt-test"\n', 'utf8');
    await writeFile(join(root, 'sessions', 'chat.jsonl'), 'preserve-chat\n', 'utf8');

    const adapter = new AuthFileAdapter(authPath, backupRoot);
    const backupPath = await adapter.backupCurrentAuth();
    if (backupPath === null) throw new Error('Expected an existing auth backup');
    await adapter.writeBundle(JSON.stringify({ account_id: 'new' }));

    await expect(readFile(authPath, 'utf8')).resolves.toContain('"new"');
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('"old"');
    await expect(readFile(join(root, 'config.toml'), 'utf8')).resolves.toBe(
      'model = "gpt-test"\n'
    );
    await expect(readFile(join(root, 'sessions', 'chat.jsonl'), 'utf8')).resolves.toBe(
      'preserve-chat\n'
    );
  });

  it('encrypts rollback backups when a secret box is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'auth-backup-test-'));
    const authPath = join(root, 'auth.json');
    const rawAuth = JSON.stringify({ token: 'do-not-store-in-plaintext' });
    await writeFile(authPath, rawAuth, 'utf8');

    const adapter = new AuthFileAdapter(authPath, join(root, 'backups'), reverseSecretBox);
    const backupPath = await adapter.backupCurrentAuth();
    if (backupPath === null) throw new Error('Expected an existing auth backup');
    const stored = await readFile(backupPath, 'utf8');

    expect(backupPath).toMatch(/\.bundle$/);
    expect(stored).not.toContain('do-not-store-in-plaintext');

    await adapter.writeBundle(JSON.stringify({ token: 'new' }));
    await adapter.restoreBackup(backupPath);
    await expect(readFile(authPath, 'utf8')).resolves.toBe(rawAuth);
  });

  it('restores an originally logged-out state by removing the new auth file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'auth-logged-out-test-'));
    const authPath = join(root, 'codex', 'auth.json');
    const adapter = new AuthFileAdapter(authPath, join(root, 'backups'), reverseSecretBox);

    const backupPath = await adapter.backupCurrentAuth();
    expect(backupPath).toBeNull();

    await adapter.writeBundle(JSON.stringify({ token: 'saved-account' }));
    await expect(readFile(authPath, 'utf8')).resolves.toContain('saved-account');

    await adapter.restoreBackup(backupPath);
    await expect(readFile(authPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
