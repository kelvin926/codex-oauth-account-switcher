import { join } from 'node:path';
import { readJsonWithBackup, writeJsonAtomic } from './atomicFile.js';
import type { AccountRecord } from './types.js';

function isAccountRecord(value: unknown): value is AccountRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const account = value as Partial<AccountRecord>;
  return (
    typeof account.id === 'string' &&
    typeof account.label === 'string' &&
    typeof account.bundlePath === 'string' &&
    typeof account.status === 'string' &&
    typeof account.planType === 'string' &&
    typeof account.createdAt === 'string' &&
    typeof account.updatedAt === 'string'
  );
}

function isAccountCatalog(value: unknown): value is AccountRecord[] {
  return Array.isArray(value) && value.every(isAccountRecord);
}

export class CatalogStore {
  private readonly catalogPath: string;

  constructor(private readonly rootDir: string) {
    this.catalogPath = join(rootDir, 'catalog.json');
  }

  async load(): Promise<AccountRecord[]> {
    const { value } = await readJsonWithBackup(this.catalogPath, [], isAccountCatalog);
    return value;
  }

  async save(accounts: AccountRecord[]): Promise<void> {
    await writeJsonAtomic(this.catalogPath, accounts);
  }
}
