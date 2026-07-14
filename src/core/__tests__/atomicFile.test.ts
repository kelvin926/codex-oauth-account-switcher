import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonWithBackup, writeJsonAtomic } from '../atomicFile';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

describe('atomic JSON files', () => {
  it('recovers a truncated primary file from its last valid backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atomic-json-test-'));
    const filePath = join(root, 'state.json');
    await writeJsonAtomic(filePath, { version: 1 });
    await writeJsonAtomic(filePath, { version: 2 });
    await writeFile(filePath, '{', 'utf8');

    const result = await readJsonWithBackup(filePath, {}, isRecord);

    expect(result).toEqual({ value: { version: 1 }, recovered: true });
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"version": 1');
  });

  it('quarantines invalid JSON and uses a safe fallback when no backup exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atomic-json-fallback-'));
    const filePath = join(root, 'state.json');
    await writeFile(filePath, '', 'utf8');

    const result = await readJsonWithBackup(filePath, { safe: true }, isRecord);

    expect(result.value).toEqual({ safe: true });
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"safe": true');
  });
});
