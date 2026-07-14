import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';
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
import { createPendingVerification } from '../src/core/verification.js';
import type { AccountRecord } from '../src/core/types';
import type {
  CaptureAccountInput,
  DashboardPayload,
  DesktopState,
  RegistrationState
} from '../src/shared/desktopApi.js';

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

app.disableHardwareAcceleration();

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
    lastSwitchAt: typeof value.lastSwitchAt === 'string' ? value.lastSwitchAt : null,
    registration: isPendingRegistrationSession(value.registration)
      ? toPublicRegistrationState(value.registration)
      : null
  };
}

function serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
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
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    buildCodexRuntimeScript()
  ]);

  return JSON.parse(stdout.trim()) as CodexWindowRuntime;
}

async function stopCodexStack(): Promise<void> {
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      buildCodexTerminationScript()
    ]);
  } catch (error) {
    throw new Error(toCodexTerminationErrorMessage(error));
  }
}

async function launchCodex(): Promise<void> {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    buildCodexLaunchScript()
  ]);
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
  const codexRuntime = await getCodexWindowRuntime();
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
  await saveAccounts(normalizedAccounts);
  const state = await synchronizeStateWithRuntime(await loadState());
  await saveState(state);
  return {
    accounts: normalizedAccounts,
    state
  };
}

async function refreshUsage(account: AccountRecord): Promise<AccountRecord> {
  const bundle = await sessionVault.load(account.bundlePath);
  const switchability = getAuthBundleSwitchability(bundle);
  if (isAuthBundleExpired(bundle)) {
    return {
      ...account,
      canSwitch: switchability.canSwitch,
      switchBlockedReason: switchability.reason,
      status: 'expired',
      updatedAt: new Date().toISOString()
    };
  }

  const parsed = parseAuthBundle(bundle);
  const usage = await fetchUsageFromAccessToken(parsed.accessToken);

  return {
    ...account,
    canSwitch: switchability.canSwitch,
    switchBlockedReason: switchability.reason,
    planType: usage.planType,
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
  const accounts = await getAccounts();
  const rawAuth = await authAdapter.readCurrentAuth();

  const switchability = getAuthBundleSwitchability(rawAuth);
  const parsed = parseAuthBundle(rawAuth);
  const existingAccount = accounts.find((account) => account.id === parsed.accountId);

  let usageResult:
    | Awaited<ReturnType<typeof fetchUsageFromAccessToken>>
    | null = null;

  try {
    usageResult = await fetchUsageFromAccessToken(parsed.accessToken);
  } catch {
    usageResult = null;
  }

  const bundlePath = await sessionVault.save(parsed.accountId, rawAuth);
  const nextAccount: AccountRecord = {
    id: parsed.accountId,
    label:
      input.label.trim() || existingAccount?.label || usageResult?.email || parsed.email || parsed.accountId,
    bundlePath,
    authSource: 'codex-auth-file',
    canSwitch: switchability.canSwitch,
    switchBlockedReason: switchability.reason,
    status: usageResult ? 'ready' : 'needs-refresh',
    planType: usageResult?.planType ?? parsed.planType,
    usage: usageResult?.usage ?? null,
    createdAt: existingAccount?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveAccounts([
    nextAccount,
    ...accounts.filter((account) => account.id !== parsed.accountId)
  ]);
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
  const accounts = await getAccounts();
  const currentState = await loadState();
  const target = accounts.find((account) => account.id === accountId);
  if (!target) {
    throw new Error('Selected account was not found.');
  }

  const bundle = await sessionVault.load(target.bundlePath);
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

  await stopCodexStack();

  try {
    const latestAuth = await authAdapter.readCurrentAuth();
    const checkpointedAccounts = await checkpointCurrentAccount(
      accounts,
      latestAuth,
      (currentAccountId, payload) => sessionVault.save(currentAccountId, payload)
    );
    await saveAccounts(checkpointedAccounts);

    await switchAccount(target, bundle, authAdapter, {
      markPending: async () => {
        const verificationState = createPendingVerification(accountId);
        await saveState({
          activeAccountId: accountId,
          pendingVerificationAccountId: verificationState.accountId,
          pendingVerificationSawStop: true,
          lastSwitchAt: verificationState.createdAt,
          registration: currentState.registration
        });
      }
    });
  } catch (error) {
    try {
      await launchCodex();
    } catch {
      // Preserve the original switch error; the user can reopen ChatGPT manually.
    }
    throw error;
  }

  try {
    await launchCodex();
  } catch {
    throw new Error(
      '계정 인증은 전환됐지만 ChatGPT 앱을 자동으로 다시 열지 못했습니다. 시작 메뉴에서 ChatGPT를 직접 실행해 주세요.'
    );
  }

  return buildDashboard();
}

async function switchRecommendedAccount(): Promise<DashboardPayload> {
  const dashboard = await buildDashboard();
  const recommended = chooseRecommendedAccount(dashboard.accounts);

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

function createMainWindow(): BrowserWindow {
  const preloadPath = resolvePreloadPath(app.getAppPath());
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 760,
    title: 'Codex 계정 전환기',
    backgroundColor: '#f4f1ea',
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
      setTimeout(() => {
        void window.webContents.capturePage().then((image) => {
          const shotPath = screenshotOutputPath;
          mkdirSync(path.dirname(shotPath), { recursive: true });
          writeFileSync(shotPath, image.toPNG());
          logLine('renderer-capture', shotPath);
          if (autoQuitAfterCapture) {
            setTimeout(() => app.quit(), 150);
          }
        });
      }, 900);

      void window.webContents
        .executeJavaScript(
          `JSON.stringify({
            rootHtml: document.getElementById('root')?.innerHTML ?? null,
            scriptCount: document.scripts.length,
            bodyText: document.body?.innerText ?? ''
          })`
        )
        .then((snapshot) => logLine('renderer-snapshot', snapshot))
        .catch((error) =>
          logLine(
            'renderer-snapshot-error',
            error instanceof Error ? error.stack ?? error.message : String(error)
          )
        );
    }
  });

  window.webContents.on('console-message', (event) => {
    logLine('renderer-console', event.level, event.message);
  });

  if (rendererUrl) {
    const targetUrl = new URL(rendererUrl);
    if (demoScenario) {
      targetUrl.searchParams.set('demo', demoScenario);
    }
    void window.loadURL(targetUrl.toString());
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    logLine('loading-file', indexPath);
    void window.loadFile(indexPath, {
      search: demoScenario ? `demo=${encodeURIComponent(demoScenario)}` : undefined
    });
  }

  window.removeMenu();
  window.setMenuBarVisibility(false);

  return window;
}

app.whenReady().then(() => {
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
  ipcMain.handle('codex:terminate', () => serializeOperation(terminateCodex));

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
