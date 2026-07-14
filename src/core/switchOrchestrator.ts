import { createPendingVerification } from './verification.js';
import type { AccountRecord, AuthAdapter, RestartVerificationStore } from './types.js';

export async function switchAccount(
  account: AccountRecord,
  bundle: string,
  authAdapter: AuthAdapter,
  verificationStore: RestartVerificationStore
): Promise<void> {
  const backupPath = await authAdapter.backupCurrentAuth();

  try {
    await authAdapter.writeBundle(bundle);
    const written = await authAdapter.readCurrentAuth();
    if (written.trim() !== bundle.trim()) {
      throw new Error('인증 파일 교체 후 검증에 실패했습니다. 기존 인증으로 복원합니다.');
    }
    await verificationStore.markPending(createPendingVerification(account.id));
  } catch (error) {
    await authAdapter.restoreBackup(backupPath);
    throw error;
  }
}
