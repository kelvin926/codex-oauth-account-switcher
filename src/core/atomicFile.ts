import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class InvalidJsonFileError extends Error {
  constructor(
    public readonly filePath: string,
    message: string
  ) {
    super(message);
    this.name = 'InvalidJsonFileError';
  }
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx');

  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const backupPath = `${filePath}.bak`;

  try {
    await copyFile(filePath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function quarantineInvalidFile(filePath: string): Promise<void> {
  const quarantinePath = `${filePath}.corrupt-${timestampForFileName()}`;

  try {
    await copyFile(filePath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function parseJson<T>(text: string, filePath: string): T {
  if (!text.trim()) {
    throw new InvalidJsonFileError(filePath, `JSON 파일이 비어 있습니다: ${filePath}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new InvalidJsonFileError(
      filePath,
      `JSON 파일을 읽을 수 없습니다: ${filePath} (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

export async function readJsonWithBackup<T>(
  filePath: string,
  fallback: T,
  validate: (value: unknown) => value is T
): Promise<{ value: T; recovered: boolean }> {
  let primaryError: unknown = null;

  try {
    const parsed = parseJson<unknown>(await readFile(filePath, 'utf8'), filePath);
    if (!validate(parsed)) {
      throw new InvalidJsonFileError(filePath, `JSON 구조가 올바르지 않습니다: ${filePath}`);
    }
    return { value: parsed, recovered: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { value: fallback, recovered: false };
    }
    primaryError = error;
    await quarantineInvalidFile(filePath);
  }

  const backupPath = `${filePath}.bak`;
  try {
    const parsed = parseJson<unknown>(await readFile(backupPath, 'utf8'), backupPath);
    if (!validate(parsed)) {
      throw new InvalidJsonFileError(backupPath, `백업 JSON 구조가 올바르지 않습니다: ${backupPath}`);
    }
    await writeFileAtomic(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return { value: parsed, recovered: true };
  } catch (backupError) {
    if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') {
      await quarantineInvalidFile(backupPath);
    }
  }

  await writeJsonAtomic(filePath, fallback);
  return {
    value: fallback,
    recovered: primaryError instanceof InvalidJsonFileError
  };
}
