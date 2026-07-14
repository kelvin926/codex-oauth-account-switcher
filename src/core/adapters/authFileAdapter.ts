import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../atomicFile.js';
import type { AuthAdapter, SecretBox } from '../types.js';

export class AuthFileAdapter implements AuthAdapter {
  constructor(
    private readonly authPath: string,
    private readonly backupRoot: string,
    private readonly backupSecretBox: SecretBox | null = null
  ) {}

  async readCurrentAuth(): Promise<string> {
    return readFile(this.authPath, 'utf8');
  }

  async backupCurrentAuth(): Promise<string> {
    await mkdir(this.backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = this.backupSecretBox ? 'bundle' : 'json';
    const backupPath = join(this.backupRoot, `auth-${stamp}-${process.pid}.${extension}`);
    const currentAuth = await readFile(this.authPath, 'utf8');
    const backup = this.backupSecretBox
      ? this.backupSecretBox.encrypt(currentAuth)
      : currentAuth;
    await writeFileAtomic(backupPath, backup);
    return backupPath;
  }

  async writeBundle(bundle: string): Promise<void> {
    await writeFileAtomic(this.authPath, `${bundle.trim()}\n`);
  }

  async restoreBackup(backupPath: string): Promise<void> {
    const stored = await readFile(backupPath, 'utf8');
    const backup = this.backupSecretBox ? this.backupSecretBox.decrypt(stored) : stored;
    await writeFileAtomic(this.authPath, backup);
  }
}
