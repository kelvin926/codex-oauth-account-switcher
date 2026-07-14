import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../atomicFile.js';
import type { SecretBox } from '../types.js';

export class SessionVault {
  constructor(
    private readonly rootDir: string,
    private readonly secretBox: SecretBox
  ) {}

  async save(accountId: string, payload: string): Promise<string> {
    await mkdir(this.rootDir, { recursive: true });
    const bundlePath = join(this.rootDir, `${accountId}.bundle`);
    const encrypted = this.secretBox.encrypt(payload);
    await writeFileAtomic(bundlePath, encrypted);
    return bundlePath;
  }

  async load(bundlePath: string): Promise<string> {
    const encrypted = await readFile(bundlePath, 'utf8');
    return this.secretBox.decrypt(encrypted);
  }

  async discover(): Promise<Array<{ bundlePath: string; payload: string }>> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      const bundles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.bundle'));
      const discovered = await Promise.all(
        bundles.map(async (entry) => {
          const bundlePath = join(this.rootDir, entry.name);
          try {
            return { bundlePath, payload: await this.load(bundlePath) };
          } catch {
            return null;
          }
        })
      );

      return discovered.filter(
        (entry): entry is { bundlePath: string; payload: string } => entry !== null
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
