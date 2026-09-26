import type { AccountRecord } from '../core/types';
import type { DashboardPayload } from '../shared/desktopApi';

export type DemoScenario = 'empty' | 'populated' | 'switching';

const baseTimestamp = new Date().toISOString();
const afterHours = (hours: number) => new Date(Date.parse(baseTimestamp) + hours * 3600_000).toISOString();

function createAccount(
  id: string,
  label: string,
  planType: AccountRecord['planType'],
  primaryRemainingPercent: number,
  secondaryRemainingPercent: number,
  canSwitch = true
): AccountRecord {
  return {
    id,
    label,
    bundlePath: `${id}.bin`,
    authSource: 'codex-auth-file',
    canSwitch,
    switchBlockedReason: canSwitch ? null : '현재 세션으로는 재시작 전환을 지원하지 않습니다.',
    status: 'ready',
    planType,
    usage: {
      fetchedAt: baseTimestamp,
      source: 'fixture',
      primaryRemainingPercent: planType === 'pro-5x' ? null : primaryRemainingPercent,
      secondaryRemainingPercent,
      primaryResetAt: planType === 'pro-5x' ? null : afterHours(4.5),
      secondaryResetAt: afterHours(72),
      primaryWindowSeconds: planType === 'pro-5x' ? null : 18000,
      secondaryWindowSeconds: 604800,
      availableResetCredits: id === 'demo-recommended' ? 3 : 0,
      credits: {
        balance: id === 'demo-recommended' ? 1234.56 : 0,
        hasCredits: id === 'demo-recommended',
        unlimited: false
      }
    },
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp
  };
}

function emptyDashboard(): DashboardPayload {
  return {
    accounts: [],
    state: {
      activeAccountId: null,
      pendingVerificationAccountId: null,
      pendingVerificationSawStop: false,
      autoRestartOnSwitch: true,
      lastSwitchAt: null,
      registration: null
    }
  };
}

export function readDemoScenario(search: string): DemoScenario | null {
  const params = new URLSearchParams(search);
  const rawScenario = params.get('demo');

  if (rawScenario === 'populated' || rawScenario === 'switching' || rawScenario === 'empty') {
    return rawScenario;
  }

  return rawScenario === null ? null : 'empty';
}

export function resolveDemoScenario(search: string): DemoScenario {
  return readDemoScenario(search) ?? 'empty';
}

export function getDemoDashboard(scenario: DemoScenario): DashboardPayload {
  if (scenario === 'empty') {
    return emptyDashboard();
  }

  const accounts: AccountRecord[] = [
    createAccount('demo-active', '메인 작업용', 'plus', 48, 70),
    createAccount('demo-backup', '긴급 전환용', 'plus', 23, 65, false),
    createAccount('demo-recommended', '여유 Pro', 'pro-5x', 82, 88)
  ];

  if (scenario === 'switching') {
    return {
      accounts,
      state: {
        activeAccountId: 'demo-active',
        pendingVerificationAccountId: 'demo-recommended',
        pendingVerificationSawStop: true,
        autoRestartOnSwitch: true,
        lastSwitchAt: baseTimestamp,
        registration: null
      }
    };
  }

  return {
    accounts,
    state: {
      activeAccountId: 'demo-active',
      pendingVerificationAccountId: null,
      pendingVerificationSawStop: false,
      autoRestartOnSwitch: true,
      lastSwitchAt: null,
      registration: null
    }
  };
}
