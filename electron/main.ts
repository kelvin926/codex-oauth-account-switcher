import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { AuthFileAdapter } from '../src/core/adapters/authFileAdapter.js';
import {
  fetchUsageFromAccessToken,
  UsageAuthExpiredError
} from '../src/core/adapters/usageProvider.js';
import {
  getAuthBundleSwitchability,
  isAuthBundleExpired,
  parseAuthBundle
} from '../src/core/authBundle.js';
import {
  buildCodexLaunchScript,
  buildCodexRuntimeScript,
  buildCodexTerminationScript,
  toCodexTerminationErrorMessage
} from '../src/core/codexRestart.js';
import {
  checkpointCurrentAccount,
  mergeDiscoveredAccounts
} from '../src/core/accountSession.js';
import { readJsonWithBackup, writeFileAtomic, writeJsonAtomic } from '../src/core/atomicFile.js';
import { resolvePreloadPath } from '../src/core/electronPaths.js';
import { chooseRecommendedAccount } from '../src/core/recommendation.js';
import { CatalogStore } from '../src/core/storage.js';
import { createAesSecretBox } from '../src/core/security/createAesSecretBox.js';
import { SessionVault } from '../src/core/security/sessionVault.js';
import { switchAccount } from '../src/core/switchOrchestrator.js';
import {
  createSwitchExecutionPlan,
  normalizeAutoRestartOnSwitch
} from '../src/core/switchExecution.js';
import { createPendingVerification } from '../src/core/verification.js';
import type { AccountRecord } from '../src/core/types';
import type {
  CaptureAccountInput,
  DashboardPayload,
  DesktopState,
  RegistrationState
} from '../src/shared/desktopApi.js';

import { FeatureRuntime } from './features.js';
import type { Diagnostic } from '../src/shared/features.js';

let features: FeatureRuntime | null = null;
let quitting = false;

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const demoScenario = process.env.OAUTH_SWITCHER_DEMO_SCENARIO ?? null;
const screenshotOutputPath = process.env.OAUTH_SWITCHER_SCREENSHOT_FILE ?? null;
const autoQuitAfterCapture = process.env.OAUTH_SWITCHER_AUTOCLOSE_AFTER_CAPTURE === 'true';
const dataRoot = process.env.OAUTH_SWITCHER_DATA_ROOT ?? path.join(homedir(), '.oauth-account-switcher');
const bundleRoot = path.join(dataRoot, 'bundles');
const registrationRoot = path.join(dataRoot, 'registration');
const registrationStatePath = path.join(registrationRoot, 'pending-codex-login.json');
const registrationOriginalAuthPath = path.join(registrationRoot, 'original-auth.json');
const appStatePath = path.join(dataRoot, 'app-state.json');
const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), '.codex');
const codexAuthPath = path.join(codexHome, 'auth.json');
const backupAuthRoot = path.join(dataRoot, 'backups', 'auth');
const catalogStore = new CatalogStore(dataRoot);
const secretBox = createAesSecretBox();
const sessionVault = new SessionVault(bundleRoot, secretBox);
const authAdapter = new AuthFileAdapter(codexAuthPath, backupAuthRoot, secretBox);
const execFileAsync = promisify(execFile);
let operationQueue: Promise<void> = Promise.resolve();

async function runPowerShell(script: string, timeout = 20_000) {
  return execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
}

type PendingRegistrationSession = {
  mode: 'codex-login';
  startedAt: string;
  originalAuthPath: string | null;
};

type CodexWindowRuntime = {
  isOpen: boolean;
  processCount: number;
  latestStartTime: string | null;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPendingRegistrationSession(value: unknown): value is PendingRegistrationSession {
  if (!isJsonObject(value)) {
    return false;
  }

  return (
    value.mode === 'codex-login' &&
    typeof value.startedAt === 'string' &&
    (typeof value.originalAuthPath === 'string' || value.originalAuthPath === null)
  );
}

if (process.env.OAUTH_SWITCHER_DISABLE_GPU === '1') app.disableHardwareAcceleration();

function logLine(...parts: unknown[]) {
  const logDir = path.join(dataRoot, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'main.log');
  appendFileSync(logPath, `${new Date().toISOString()} ${parts.map((part) => String(part)).join(' ')}\n`);
}

process.on('uncaughtException', (error) => {
  logLine('uncaught-exception', error.stack ?? error.message);
});

process.on('unhandledRejection', (reason) => {
  logLine(
    'unhandled-rejection',
    reason instanceof Error ? reason.stack ?? reason.message : String(reason)
  );
});

async function ensureDataRoot(): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await mkdir(bundleRoot, { recursive: true });
  await mkdir(path.join(dataRoot, 'backups'), { recursive: true });
  await mkdir(registrationRoot, { recursive: true });
}

function toPublicRegistrationState(
  session: PendingRegistrationSession | null
): RegistrationState | null {
  if (!session) {
    return null;
  }

  return {
    mode: session.mode,
    startedAt: session.startedAt
  };
}

async function loadRegistrationSession(): Promise<PendingRegistrationSession | null> {
  const result = await readJsonWithBackup<PendingRegistrationSession | null>(
    registrationStatePath,
    null,
    (value): value is PendingRegistrationSession | null =>
      value === null || isPendingRegistrationSession(value)
  );
  return result.value;
}

async function clearRegistrationSession(): Promise<void> {
  await rm(registrationStatePath, { force: true });
  await rm(registrationOriginalAuthPath, { force: true });
}

async function restoreOriginalAuth(session: PendingRegistrationSession): Promise<void> {
  if (session.originalAuthPath) {
    const originalAuth = await readFile(session.originalAuthPath, 'utf8');
    await writeFileAtomic(codexAuthPath, originalAuth);
  } else {
    await rm(codexAuthPath, { force: true });
  }
}

async function loadState(): Promise<DesktopState> {
  const { value } = await readJsonWithBackup<Record<string, unknown>>(
    appStatePath,
    {},
    isJsonObject
  );
  return {
    activeAccountId: typeof value.activeAccountId === 'string' ? value.activeAccountId : null,
    pendingVerificationAccountId:
      typeof value.pendingVerificationAccountId === 'string'
        ? value.pendingVerificationAccountId
        : null,
    pendingVerificationSawStop: value.pendingVerificationSawStop === true,
    autoRestartOnSwitch: normalizeAutoRestartOnSwitch(value.autoRestartOnSwitch),
    lastSwitchAt: typeof value.lastSwitchAt === 'string' ? value.lastSwitchAt : null,
    registration: isPendingRegistrationSession(value.registration)
      ? toPublicRegistrationState(value.registration)
      : null
  };
}

function serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (quitting) return Promise.reject(new Error('앱을 종료하는 중입니다.'));
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function saveState(state: DesktopState): Promise<void> {
  await writeJsonAtomic(appStatePath, state);
}

async function updateRegistrationState(
  session: PendingRegistrationSession | null
): Promise<void> {
  const state = await loadState();
  await saveState({
    ...state,
    registration: toPublicRegistrationState(session)
  });
}

async function getAccounts(): Promise<AccountRecord[]> {
  await ensureDataRoot();
  const accounts = await catalogStore.load();
  const merged = mergeDiscoveredAccounts(accounts, await sessionVault.discover());
  if (merged.length !== accounts.length) {
    await catalogStore.save(merged);
  }
  return merged;
}

async function saveAccounts(accounts: AccountRecord[]): Promise<void> {
  await ensureDataRoot();
  await catalogStore.save(accounts);
}

async function getCodexWindowRuntime(): Promise<CodexWindowRuntime> {
  const { stdout } = await runPowerShell(buildCodexRuntimeScript());

  return JSON.parse(stdout.trim()) as CodexWindowRuntime;
}

async function stopCodexStack(): Promise<void> {
  try {
    await runPowerShell(buildCodexTerminationScript(), 30_000);
  } catch (error) {
    throw new Error(toCodexTerminationErrorMessage(error));
  }
}

async function launchCodex(): Promise<void> {
  await runPowerShell(buildCodexLaunchScript(), 30_000);
}

async function clearStaleRegistrationSession(): Promise<void> {
  const session = await loadRegistrationSession();
  if (!session) {
    return;
  }

  await restoreOriginalAuth(session);
  await clearRegistrationSession();
  await updateRegistrationState(null);
}

async function synchronizeStateWithRuntime(state: DesktopState): Promise<DesktopState> {
  const codexRuntime = state.pendingVerificationAccountId
    ? await getCodexWindowRuntime()
    : { isOpen: false, processCount: 0, latestStartTime: null };
  const nextState: DesktopState = {
    ...state,
    registration: null
  };

  if (state.pendingVerificationAccountId && !codexRuntime.isOpen) {
    nextState.pendingVerificationSawStop = true;
  }

  try {
    const liveAuth = await authAdapter.readCurrentAuth();
    const parsed = parseAuthBundle(liveAuth);
    nextState.activeAccountId = parsed.accountId;

    const reopenedAfterSwitch =
      !!state.lastSwitchAt &&
      !!codexRuntime.latestStartTime &&
      new Date(codexRuntime.latestStartTime).getTime() > new Date(state.lastSwitchAt).getTime();

    if (
      nextState.pendingVerificationAccountId === parsed.accountId &&
      codexRuntime.isOpen &&
      (nextState.pendingVerificationSawStop || reopenedAfterSwitch)
    ) {
      nextState.pendingVerificationAccountId = null;
      nextState.pendingVerificationSawStop = false;
    }
  } catch {
    nextState.activeAccountId = null;
  }

  if (!nextState.pendingVerificationAccountId) {
    nextState.pendingVerificationSawStop = false;
  }

  return nextState;
}

async function buildDashboard(): Promise<DashboardPayload> {
  await clearStaleRegistrationSession();
  const accounts = await getAccounts();
  const normalizedAccounts = await Promise.all(
    accounts.map(async (account) => {
      try {
        const bundle = await sessionVault.load(account.bundlePath);
        const switchability = getAuthBundleSwitchability(bundle);
        const authSource =
          account.authSource ??
          (switchability.canSwitch ? 'codex-auth-file' : 'session-import');
        if (isAuthBundleExpired(bundle)) {
          return {
            ...account,
            authSource,
            canSwitch: switchability.canSwitch,
            switchBlockedReason: switchability.reason,
            status: switchability.canSwitch ? ('needs-refresh' as const) : ('expired' as const)
          };
        }

        return {
          ...account,
          authSource,
          canSwitch: switchability.canSwitch,
          switchBlockedReason: switchability.reason,
          status: account.status === 'expired' ? ('needs-refresh' as const) : account.status
        };
      } catch {
        return {
          ...account,
          canSwitch: false,
          switchBlockedReason:
            '저장된 인증 번들을 읽을 수 없습니다. 현재 로그인된 계정이라면 계정 추가로 다시 저장해 주세요.',
          status: 'error' as const
        };
      }
    })
  );
  if (JSON.stringify(normalizedAccounts) !== JSON.stringify(accounts)) {
    await saveAccounts(normalizedAccounts);
  }
  const previousState = await loadState();
  const state = await synchronizeStateWithRuntime(previousState);
  if (JSON.stringify(state) !== JSON.stringify(previousState)) await saveState(state);
  return {
    accounts: normalizedAccounts,
    state,
    settings: features?.store.settings
  };
}

async function refreshUsage(account: AccountRecord): Promise<AccountRecord> {
  let bundle: string | null = null;
  try {
    const liveAuth = await authAdapter.readCurrentAuth();
    if (parseAuthBundle(liveAuth).accountId === account.id) bundle = liveAuth;
  } catch {
    // The active auth may be absent during official logout. Saved accounts remain usable.
  }
  if (bundle !== null && getAuthBundleSwitchability(bundle).canSwitch) {
    await sessionVault.save(account.id, bundle);
  }
  bundle ??= await sessionVault.load(account.bundlePath);
  const switchability = getAuthBundleSwitchability(bundle);
  if (isAuthBundleExpired(bundle)) {
    return {
      ...account,
      canSwitch: switchability.canSwitch,
      switchBlockedReason: switchability.reason,
      status: switchability.canSwitch ? 'needs-refresh' : 'expired',
      updatedAt: new Date().toISOString()
    };
  }

  const parsed = parseAuthBundle(bundle);
  const usage = await fetchUsageFromAccessToken(parsed.accessToken, parsed.accountId);
  await features?.observe(account.id, usage.usage);

  return {
    ...account,
    canSwitch: switchability.canSwitch,
    switchBlockedReason: switchability.reason,
    planType: usage.planType === 'unknown' ? parsed.planType : usage.planType,
    usage: usage.usage,
    status: 'ready',
    updatedAt: new Date().toISOString()
  };
}

async function refreshAccount(accountId: string): Promise<DashboardPayload> {
  const accounts = await getAccounts();
  const nextAccounts = await Promise.all(
    accounts.map(async (account) => {
      if (account.id !== accountId) {
        return account;
      }

      try {
        return await refreshUsage(account);
      } catch (error) {
        if (error instanceof UsageAuthExpiredError) {
          return {
            ...account,
            status: 'expired' as const,
            updatedAt: new Date().toISOString()
          };
        }

        return {
          ...account,
          status: 'needs-refresh' as const,
          updatedAt: new Date().toISOString()
        };
      }
    })
  );

  await saveAccounts(nextAccounts);
  return buildDashboard();
}

async function refreshAll(): Promise<DashboardPayload> {
  const accounts = await getAccounts();
  const nextAccounts = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await refreshUsage(account);
      } catch (error) {
        if (error instanceof UsageAuthExpiredError) {
          return {
            ...account,
            status: 'expired' as const,
            updatedAt: new Date().toISOString()
          };
        }

        return {
          ...account,
          status: 'needs-refresh' as const,
          updatedAt: new Date().toISOString()
        };
      }
    })
  );

  await saveAccounts(nextAccounts);
  return buildDashboard();
}

async function captureCurrentAuth(input: CaptureAccountInput): Promise<DashboardPayload> {
  const rawAuth = await authAdapter.readCurrentAuth();
  return captureRawAuth(rawAuth, input.label);
}

async function captureRawAuth(rawAuth: string, label: string, expectedId?: string, fromLogin = false): Promise<DashboardPayload> {
  const accounts = await getAccounts();
  if (expectedId && parseAuthBundle(rawAuth).accountId !== expectedId) throw new Error('다른 계정으로 로그인했습니다. 기존 계정 인증은 변경하지 않았습니다.');
  if (typeof label !== 'string' || label.length > 100) throw new Error('계정 이름은 100자 이내로 입력하세요.');
  const switchability = getAuthBundleSwitchability(rawAuth);
  const parsed = parseAuthBundle(rawAuth);
  const existingAccount = accounts.find((account) => account.id === parsed.accountId);

  let usageResult:
    | Awaited<ReturnType<typeof fetchUsageFromAccessToken>>
    | null = null;

  try {
    usageResult = await fetchUsageFromAccessToken(parsed.accessToken, parsed.accountId);
  } catch {
    usageResult = null;
  }

  let reopen = false;
  if (fromLogin) {
    let activeId: string | null = null;
    try { activeId = parseAuthBundle(await authAdapter.readCurrentAuth()).accountId; } catch { /* Inactive login. */ }
    if (activeId === parsed.accountId) {
      const choice = await dialog.showMessageBox({ type: 'question', buttons: ['취소', '새 인증 적용'], defaultId: 0, cancelId: 0,
        message: '현재 사용 중인 계정의 새 인증을 적용할까요?', detail: '실행 중인 Codex를 종료하고 인증을 갱신한 뒤 다시 엽니다. 진행 중인 작업을 마친 후 적용하세요.' });
      if (choice.response !== 1) throw new Error('새 인증 적용을 취소했습니다. 다시 로그인하려면 재시도하세요.');
      reopen = (await getCodexWindowRuntime()).isOpen;
      if (reopen) await stopCodexStack();
      features?.analytics.pulse(null);
      // An external login may have changed while Codex was stopping.
      if (parseAuthBundle(await authAdapter.readCurrentAuth()).accountId !== parsed.accountId) throw new Error('현재 계정이 변경되어 새 인증 적용을 중단했습니다.');
      const backup = await authAdapter.backupCurrentAuth();
      try { await authAdapter.writeBundle(rawAuth); }
      catch(error) { await authAdapter.restoreBackup(backup); throw error; }
    }
  }
  if (usageResult) await features?.observe(parsed.accountId, usageResult.usage);
  const bundlePath = await sessionVault.save(parsed.accountId, rawAuth);
  const nextAccount: AccountRecord = {
    ...existingAccount,
    id: parsed.accountId,
    label:
      label.trim() || existingAccount?.label || usageResult?.email || parsed.email || parsed.accountId,
    bundlePath,
    authSource: 'codex-auth-file',
    canSwitch: switchability.canSwitch,
    switchBlockedReason: switchability.reason,
    status: usageResult ? 'ready' : 'needs-refresh',
    planType: usageResult && usageResult.planType !== 'unknown' ? usageResult.planType : parsed.planType,
    usage: usageResult?.usage ?? null,
    createdAt: existingAccount?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveAccounts([
    nextAccount,
    ...accounts.filter((account) => account.id !== parsed.accountId)
  ]);
  if (reopen) await launchCodex();
  return buildDashboard();
}

async function deleteAccount(accountId: string): Promise<DashboardPayload> {
  const accounts = await getAccounts();
  const target = accounts.find((account) => account.id === accountId);
  if (target) {
    await rm(target.bundlePath, { force: true });
  }

  await saveAccounts(accounts.filter((account) => account.id !== accountId));
  const state = await loadState();
  if (state.activeAccountId === accountId || state.pendingVerificationAccountId === accountId) {
    await saveState({
      ...state,
      activeAccountId: state.activeAccountId === accountId ? null : state.activeAccountId,
      pendingVerificationAccountId:
        state.pendingVerificationAccountId === accountId
          ? null
          : state.pendingVerificationAccountId,
      pendingVerificationSawStop:
        state.pendingVerificationAccountId === accountId
          ? false
          : state.pendingVerificationSawStop
    });
  }

  return buildDashboard();
}

async function switchSelectedAccount(accountId: string): Promise<DashboardPayload> {
  return features ? features.switchOperation(accountId, () => executeSwitch(accountId)) : executeSwitch(accountId);
}

async function executeSwitch(accountId: string): Promise<DashboardPayload> {
  features?.analytics.pulse(null);
  const accounts = await getAccounts();
  const currentState = await loadState();
  const target = accounts.find((account) => account.id === accountId);
  if (!target) {
    throw new Error('Selected account was not found.');
  }

  const bundle = await sessionVault.load(target.bundlePath);
  if (parseAuthBundle(bundle).accountId !== accountId) {
    throw new Error('저장된 인증의 계정이 선택한 계정과 다릅니다. 인증을 다시 저장해 주세요.');
  }
  const switchability = getAuthBundleSwitchability(bundle);
  if (target.authSource !== 'codex-auth-file' || !switchability.canSwitch) {
    throw new Error(
      switchability.reason ??
        '이 계정은 아직 Codex 재시작 후 유지되는 전환용 인증이 아닙니다.'
    );
  }

  try {
    const currentAuth = parseAuthBundle(await authAdapter.readCurrentAuth());
    if (currentAuth.accountId === accountId) {
      throw new Error('이미 선택한 계정이 활성 상태입니다.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('이미 선택한 계정')) {
      throw error;
    }
  }

  if (features) features.progress = '실행 중인 Codex 확인 중';
  const runtime = await getCodexWindowRuntime();
  const executionPlan = createSwitchExecutionPlan(
    currentState.autoRestartOnSwitch,
    runtime.isOpen
  );

  if (executionPlan.shouldStop) {
    if (features) features.progress = 'Codex 종료 중';
    await stopCodexStack();
  }

  try {
    const runtimeBeforeSwap = await getCodexWindowRuntime();
    const recheckedExecutionPlan = createSwitchExecutionPlan(
      currentState.autoRestartOnSwitch,
      runtimeBeforeSwap.isOpen
    );
    if (runtimeBeforeSwap.isOpen && recheckedExecutionPlan.shouldStop) {
      if (features) features.progress = 'Codex 종료 중';
    await stopCodexStack();
    }

    // Checkpoint only after the final shutdown; a respawned app may rotate tokens.
    let latestAuth: string | null = null;
    try {
      latestAuth = await authAdapter.readCurrentAuth();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (latestAuth !== null) {
      const checkpointedAccounts = await checkpointCurrentAccount(
        accounts, latestAuth,
        (currentAccountId, payload) => sessionVault.save(currentAccountId, payload)
      );
      await saveAccounts(checkpointedAccounts);
    }

    if (features) features.progress = '인증 백업 및 교체 중';
    const recoveryBackup = await authAdapter.backupCurrentAuth();
    await writeJsonAtomic(path.join(dataRoot, 'last-switch.json'), { targetId: accountId, backup: recoveryBackup, state: currentState });
    await switchAccount(target, bundle, authAdapter, {
      markPending: async () => {
        const verificationState = createPendingVerification(accountId);
        await saveState({
          ...currentState,
          activeAccountId: accountId,
          pendingVerificationAccountId: verificationState.accountId,
          pendingVerificationSawStop: true,
          lastSwitchAt: verificationState.createdAt
        });
      }
    });
  } catch (error) {
    if (executionPlan.shouldLaunch) {
      try {
        await launchCodex();
      } catch {
        // Preserve the original switch error; the user can reopen ChatGPT manually.
      }
    }
    throw error;
  }

  if (executionPlan.shouldLaunch) {
    if (features) features.progress = 'Codex 재실행 중';
    try {
      await launchCodex();
    } catch {
      throw new Error(
        '계정 인증은 전환됐지만 ChatGPT 앱을 자동으로 다시 열지 못했습니다. 시작 메뉴에서 ChatGPT를 직접 실행해 주세요.'
      );
    }
  }

  return buildDashboard();
}

async function switchRecommendedAccount(): Promise<DashboardPayload> {
  const dashboard = await buildDashboard();
  const recommended = chooseRecommendedAccount(dashboard.accounts, features?.store.settings.strategy);

  if (!recommended) {
    throw new Error('전환할 추천 계정이 없습니다.');
  }

  if (dashboard.state.activeAccountId === recommended.id) {
    throw new Error('이미 추천 계정이 활성 상태입니다.');
  }

  return switchSelectedAccount(recommended.id);
}

async function terminateCodex(): Promise<DashboardPayload> {
  await stopCodexStack();

  return buildDashboard();
}

async function setAutoRestartOnSwitch(enabled: boolean): Promise<DashboardPayload> {
  if (typeof enabled !== 'boolean') {
    throw new Error('자동 종료 및 재시작 설정 값이 올바르지 않습니다.');
  }

  const state = await loadState();
  await saveState({
    ...state,
    autoRestartOnSwitch: enabled
  });

  return buildDashboard();
}

async function getAccountAccessToken(id: string): Promise<string> {
  const account = (await getAccounts()).find(a=>a.id===id);
  if (!account) throw new Error('계정을 찾을 수 없습니다.');
  let raw = await sessionVault.load(account.bundlePath);
  try {
    const active = await authAdapter.readCurrentAuth();
    if (parseAuthBundle(active).accountId === id) raw = active;
  } catch { /* Use the encrypted saved bundle. */ }
  if (parseAuthBundle(raw).accountId !== id) throw new Error('인증 계정이 일치하지 않습니다.');
  if (isAuthBundleExpired(raw)) throw new Error('인증이 만료됐습니다. 이 계정을 다시 로그인해 주세요.');
  return parseAuthBundle(raw).accessToken;
}

async function resolveCodexCli(): Promise<string> {
  const { stdout } = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$cmd = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cmd) { $cmd.Source; exit }
$packages = @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue) + @(Get-AppxPackage -Name OpenAI.ChatGPT -ErrorAction SilentlyContinue)
foreach ($p in $packages) {
  $exe = Get-ChildItem -LiteralPath $p.InstallLocation -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { $exe.FullName; exit }
}
$shim = Get-Command codex.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shim) {
  $root = Join-Path (Split-Path $shim.Source) 'node_modules/@openai'
  $exe = Get-ChildItem -LiteralPath $root -Filter codex.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { $exe.FullName; exit }
}
throw 'Codex CLI executable not found'
`);
  const executable = stdout.trim();
  if (!path.isAbsolute(executable) || path.basename(executable).toLowerCase() !== 'codex.exe') throw new Error('Codex CLI를 찾지 못했습니다. 최신 Codex 앱 또는 CLI를 설치해 주세요.');
  return executable;
}

async function diagnoseInstallation(): Promise<Diagnostic[]> {
  const results: Diagnostic[] = [];
  try {
    const parsed = parseAuthBundle(await authAdapter.readCurrentAuth());
    results.push({name:'현재 인증',ok:true,detail:`계정 ${parsed.accountId.slice(0,8)} / 파일 읽기 정상`});
  } catch { results.push({name:'현재 인증',ok:false,detail:'auth.json을 읽지 못했습니다. 로그인 또는 저장된 계정 전환을 사용하세요.'}); }
  try { const runtime=await getCodexWindowRuntime(); results.push({name:'Codex 프로세스',ok:true,detail:runtime.isOpen?`${runtime.processCount}개 실행 중`:'종료 상태'}); }
  catch { results.push({name:'Codex 프로세스',ok:false,detail:'PowerShell 실행을 확인해 주세요.'}); }
  try { results.push({name:'로그인용 CLI',ok:true,detail:await resolveCodexCli()}); }
  catch { results.push({name:'로그인용 CLI',ok:false,detail:'Codex 앱 또는 CLI를 업데이트해 주세요. 현재 계정 저장 기능은 계속 사용할 수 있습니다.'}); }
  const accounts=await getAccounts();
  for(const account of accounts) {
    try { const raw=await sessionVault.load(account.bundlePath); const valid=parseAuthBundle(raw).accountId===account.id; results.push({name:account.label,ok:valid&&!isAuthBundleExpired(raw),detail:!valid?'계정 불일치':isAuthBundleExpired(raw)?'인증 만료: 재로그인 필요':'저장된 인증 정상'}); }
    catch { results.push({name:account.label,ok:false,detail:'저장된 인증을 읽지 못했습니다. 다시 로그인해 주세요.'}); }
  }
  results.push({name:'세션 기록 위치',ok:true,detail:codexHome});
  return results;
}

async function recoverLastSwitch(): Promise<void> {
  let journal: any;
  try { journal=JSON.parse(await readFile(path.join(dataRoot,'last-switch.json'),'utf8')); }
  catch { throw new Error('복구할 마지막 전환 기록이 없습니다.'); }
  if (typeof journal.targetId !== 'string' || !journal.state || (journal.backup!==null && (typeof journal.backup!=='string' || path.dirname(journal.backup)!==backupAuthRoot))) throw new Error('복구 기록을 확인할 수 없습니다.');
  const current=parseAuthBundle(await authAdapter.readCurrentAuth());
  if(current.accountId!==journal.targetId) throw new Error('마지막 전환 이후 로그인 계정이 바뀌었습니다. 저장된 계정을 직접 선택해 주세요.');
  features?.analytics.pulse(null);
  await stopCodexStack();
  // Verify again after shutdown because Codex can rotate credentials while exiting.
  if(parseAuthBundle(await authAdapter.readCurrentAuth()).accountId!==journal.targetId) throw new Error('종료 중 로그인 계정이 바뀌어 복구를 중단했습니다.');
  const latestAuth = await authAdapter.readCurrentAuth();
  const checkpointed = await checkpointCurrentAccount(await getAccounts(), latestAuth, (id, raw) => sessionVault.save(id, raw));
  await saveAccounts(checkpointed);
  await authAdapter.restoreBackup(journal.backup);
  await saveState({...journal.state,pendingVerificationAccountId:null,pendingVerificationSawStop:false});
  await rm(path.join(dataRoot,'last-switch.json'),{force:true});
  await features?.store.record(null,'복구',true,'마지막 전환 직전의 인증으로 복구했습니다.');
}

function createMainWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath(app.getAppPath());
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 760,
    title: 'Codex 계정 전환기',
    backgroundColor: '#edf3fc',
    show: !(process.argv.includes('--startup') && features?.store.settings.tray),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    logLine('did-fail-load', JSON.stringify({ errorCode, errorDescription, validatedUrl }));
  });

  window.webContents.on('did-finish-load', () => {
    logLine('did-finish-load', window.webContents.getURL());
    if (screenshotOutputPath) {
      void (async () => {
        const tab = process.env.OAUTH_SWITCHER_DEMO_TAB;
        const marker = tab === 'analytics' ? '모델과 리즈닝별 상세' : tab === 'forecast' ? '초기화 기록과 Tibo 공지' : '계정 추가';
        let ready = false;
        for (let attempt = 0; attempt < 50 && !window.isDestroyed(); attempt++) {
          ready = await window.webContents.executeJavaScript(`document.body?.innerText.includes(${JSON.stringify(marker)})`);
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (window.isDestroyed()) return;
        const snapshot = await window.webContents.executeJavaScript(`JSON.stringify({
          rootHtml: document.getElementById('root')?.innerHTML ?? null,
          bodyText: document.body?.innerText ?? ''
        })`);
        logLine('renderer-snapshot', snapshot);
        // DOM readiness precedes Chromium's first painted frame on Windows runners.
        const section = tab === 'analytics' ? '.analytics-stats' : tab === 'forecast' ? '.forecast-panel' : '.workspace-header';
        await window.webContents.executeJavaScript(`(async () => {
          if (${JSON.stringify(!!tab)}) document.querySelector(${JSON.stringify(section)})?.scrollIntoView({block:'start'});
          await Promise.race([document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))), new Promise(resolve => setTimeout(resolve, 1000))]);
        })()`);
        await new Promise(resolve => setTimeout(resolve, 300));
        const image = await window.webContents.capturePage();
        mkdirSync(path.dirname(screenshotOutputPath), { recursive: true });
        writeFileSync(screenshotOutputPath, image.toPNG());
        logLine('renderer-capture', screenshotOutputPath);
        if (!ready) throw new Error(`Renderer did not become ready: ${marker}`);
        const pixels = image.getBitmap(); let darkPixels = 0;
        for (let i = 0; i < pixels.length && darkPixels < 500; i += 4) {
          if (pixels[i] < 140 && pixels[i + 1] < 140 && pixels[i + 2] < 140) darkPixels++;
        }
        if (darkPixels < 500) throw new Error('Renderer capture contains no painted content');
        if (autoQuitAfterCapture) app.quit();
      })().catch(error => {
        logLine('renderer-capture-error', error instanceof Error ? error.stack : String(error));
        if (autoQuitAfterCapture) app.exit(1);
      });
    }
  });

  window.webContents.on('console-message', (event) => {
    logLine('renderer-console', event.level, event.message);
  });

  if (rendererUrl) {
    const targetUrl = new URL(rendererUrl);
    if (demoScenario) {
      targetUrl.searchParams.set('demo', demoScenario);
      targetUrl.searchParams.set('tab', ['analytics','forecast'].includes(process.env.OAUTH_SWITCHER_DEMO_TAB ?? '') ? process.env.OAUTH_SWITCHER_DEMO_TAB! : 'accounts');
    }
    void window.loadURL(targetUrl.toString());
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    logLine('loading-file', indexPath);
    void window.loadFile(indexPath, {
      search: demoScenario ? `demo=${encodeURIComponent(demoScenario)}&tab=${['analytics','forecast'].includes(process.env.OAUTH_SWITCHER_DEMO_TAB ?? '') ? process.env.OAUTH_SWITCHER_DEMO_TAB : 'accounts'}` : undefined
    });
  }

  window.on('close', (event) => {
    if (!quitting && features?.store.settings.tray) { event.preventDefault(); window.hide(); }
  });
  window.removeMenu();
  window.setMenuBarVisibility(false);

  return window;
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.codex.oauth-account-switcher');
    if (!demoScenario) {
      await ensureDataRoot();
      await rm(path.join(dataRoot, 'login-staging'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      features = new FeatureRuntime({
        root: dataRoot, home: codexHome, serialize: serializeOperation,
        dashboard: buildDashboard, refresh: refreshAll, switchAccount: switchSelectedAccount,
        token: getAccountAccessToken,
        preference: async (id, input) => {
          const accounts = await getAccounts();
          if (!accounts.some(a=>a.id===id)) throw new Error('계정을 찾을 수 없습니다.');
          await saveAccounts(accounts.map(a=>a.id===id?{...a,...input}:a));
        },
        capture: async (raw,label,id) => { await captureRawAuth(raw,label,id,true); },
        cli: resolveCodexCli, diagnose: diagnoseInstallation, recover: recoverLastSwitch
      });
      await features.initialize();
    }
    Menu.setApplicationMenu(null);
    ipcMain.handle('dashboard:get', () => serializeOperation(buildDashboard));
    ipcMain.handle('account:refresh-all', () => serializeOperation(refreshAll));
    ipcMain.handle('account:refresh', (_event, accountId: string) =>
      serializeOperation(() => refreshAccount(accountId))
    );
    ipcMain.handle('account:delete', (_event, accountId: string) =>
      serializeOperation(() => deleteAccount(accountId))
    );
    ipcMain.handle('account:capture-current-auth', (_event, input: CaptureAccountInput) =>
      serializeOperation(() => captureCurrentAuth(input))
    );
    ipcMain.handle('account:switch', (_event, accountId: string) =>
      serializeOperation(() => switchSelectedAccount(accountId))
    );
    ipcMain.handle('account:switch-recommended', () =>
      serializeOperation(switchRecommendedAccount)
    );
    ipcMain.handle('settings:set-auto-restart-on-switch', (_event, enabled: boolean) =>
      serializeOperation(() => setAutoRestartOnSwitch(enabled))
    );
    ipcMain.handle('codex:terminate', () => serializeOperation(terminateCodex));

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

let disposalPending = false;
let disposalComplete = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (!features || disposalComplete) return;
  event.preventDefault();
  if (disposalPending) return;
  disposalPending = true;
  void operationQueue.then(() => features?.dispose()).catch(error => logLine('shutdown-save-error',String(error))).finally(() => { disposalComplete = true; app.quit(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
