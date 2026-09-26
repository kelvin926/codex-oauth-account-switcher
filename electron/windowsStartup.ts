import type { App } from 'electron';

export const STARTUP_NAME = 'CodexOAuthAccountSwitcher';
type LoginApi = Pick<App, 'getLoginItemSettings' | 'setLoginItemSettings'>;

export class WindowsStartup {
  private readonly options: { path: string; args: string[] };
  constructor(private readonly api: LoginApi, private readonly executable: string, private readonly name = STARTUP_NAME) {
    // Electron 35 writes this string directly into Run and parses it as a
    // command line when reading it. The executable contains spaces by default.
    this.options = { path: `"${executable}"`, args: ['--startup'] };
  }
  private find(path = this.options.path) {
    return this.api.getLoginItemSettings({ ...this.options, path }).launchItems
      .find(item => item.name === this.name && item.scope === 'user');
  }
  enabled() {
    const item = this.find();
    return !!item?.enabled && item.args.length === 1 && item.args[0] === '--startup';
  }
  set(enabled: boolean) {
    this.api.setLoginItemSettings({ ...this.options, name: this.name, openAtLogin: enabled, enabled });
    // openAtLogin only reads the AppUserModelId key, not our named Run entry.
    // executableWillLaunchAtLogin can describe an unrelated entry for this exe.
    if (enabled ? !this.enabled() : !!this.find()) {
      throw new Error(enabled ? 'Windows 자동 시작 등록을 확인하지 못했습니다.' : 'Windows 자동 시작 해제를 확인하지 못했습니다.');
    }
  }
  reconcile(configured: boolean, preferred: boolean) {
    const current = this.find();
    if (current && current.args.length === 1 && current.args[0] === '--startup') {
      // Reading an existing entry must not undo a Task Manager disable.
      return current.enabled;
    }
    // v0.6.0 used an unquoted path and could save false after a false-negative
    // verification. Read that entry with the old lookup before repairing it.
    const legacy = current ?? this.find(this.executable);
    if (legacy || !configured) this.set(legacy?.enabled ?? preferred);
    return this.enabled();
  }
}
