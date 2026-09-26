export type AccountStatus = 'ready' | 'needs-refresh' | 'switching' | 'error' | 'expired';

export type PlanType =
  | 'free'
  | 'go'
  | 'plus'
  | 'pro'
  | 'pro-5x'
  | 'pro-20x'
  | 'business'
  | 'business-codex'
  | 'enterprise'
  | 'enterprise-codex'
  | 'edu'
  | 'unknown';

export type AccountAuthSource =
  | 'codex-auth-file'
  | 'browser-session'
  | 'login-window'
  | 'session-import';

export type CreditsSnapshot = {
  balance: number | null;
  hasCredits: boolean | null;
  unlimited: boolean | null;
};

export type UsageSnapshot = {
  fetchedAt: string;
  source: 'fixture' | 'live';
  primaryRemainingPercent: number | null;
  secondaryRemainingPercent: number | null;
  primaryResetAt: string | null;
  secondaryResetAt: string | null;
  // Missing duration fields identify legacy snapshots. Explicit null means unknown.
  primaryWindowSeconds?: number | null;
  secondaryWindowSeconds?: number | null;
  allowed?: boolean;
  limitReached?: boolean;
  // Optional for compatibility with saved snapshots from before v0.3.1.
  availableResetCredits?: number | null;
  credits?: CreditsSnapshot | null;
};

export type AccountRecord = {
  id: string;
  label: string;
  bundlePath: string;
  priority?: number;
  excluded?: boolean;
  authSource?: AccountAuthSource;
  canSwitch?: boolean;
  switchBlockedReason?: string | null;
  status: AccountStatus;
  planType: PlanType;
  usage: UsageSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

export type SecretBox = {
  encrypt(value: string): string;
  decrypt(value: string): string;
};

export type AuthAdapter = {
  readCurrentAuth(): Promise<string>;
  backupCurrentAuth(): Promise<string | null>;
  writeBundle(bundle: string): Promise<void>;
  restoreBackup(backupPath: string | null): Promise<void>;
};

export type RestartVerificationState = {
  accountId: string;
  status: 'pending-restart-verification';
  createdAt: string;
};

export type RestartVerificationStore = {
  markPending(state: RestartVerificationState): Promise<void>;
};
