import type { FeatureApi, FeatureSettings } from './features';
import type { AccountRecord } from '../core/types';
export { PLAN_LABELS } from '../core/planType';

export type DesktopState = {
  activeAccountId: string | null;
  pendingVerificationAccountId: string | null;
  pendingVerificationSawStop: boolean;
  autoRestartOnSwitch: boolean;
  lastSwitchAt: string | null;
  registration: RegistrationState | null;
};

export type RegistrationState = {
  mode: 'codex-login';
  startedAt: string;
};

export type DashboardPayload = {
  accounts: AccountRecord[];
  state: DesktopState;
  settings?: FeatureSettings;
};

export type CaptureAccountInput = {
  label: string;
};

export type DesktopApi = FeatureApi & {
  getDashboard(): Promise<DashboardPayload>;
  refreshAll(): Promise<DashboardPayload>;
  refreshAccount(accountId: string): Promise<DashboardPayload>;
  deleteAccount(accountId: string): Promise<DashboardPayload>;
  captureCurrentAuth(input: CaptureAccountInput): Promise<DashboardPayload>;
  switchAccount(accountId: string): Promise<DashboardPayload>;
  switchRecommendedAccount(): Promise<DashboardPayload>;
  setAutoRestartOnSwitch(enabled: boolean): Promise<DashboardPayload>;
  terminateCodex(): Promise<DashboardPayload>;
};
