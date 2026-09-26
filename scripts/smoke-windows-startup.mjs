import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { WindowsStartup } from '../dist-electron/electron/windowsStartup.js';

// Exercise Electron's real registry implementation, including a spaced exe
// path. Only unique test values are written, never the user's app registration.
const name = `CodexOAuthAccountSwitcher.Smoke.${process.pid}`;
const otherName = `${name}.Other`;
const executable = path.resolve('release/win-unpacked/OAuth Account Switcher.exe');
const options = { path: `"${executable}"`, args: ['--startup'] };
const startup = new WindowsStartup(app, executable, name);

app.whenReady().then(() => {
  let code = 0;
  try {
    assert.equal(process.platform, 'win32');
    assert.ok(existsSync(executable));
    app.setAppUserModelId(`${name}.DifferentAppId`);

    // Reproduce the v0.6.0 entry and the false preference saved after its error.
    app.setLoginItemSettings({ name, path: executable, args: ['--startup'], openAtLogin: true, enabled: true });
    assert.equal(app.getLoginItemSettings({ path: executable, args: ['--startup'] }).openAtLogin, false);
    assert.equal(startup.reconcile(false, false), true);
    let item = app.getLoginItemSettings(options).launchItems.find(item => item.name === name);
    assert.equal(item?.path.toLowerCase(), executable.toLowerCase());
    assert.deepEqual(item?.args, ['--startup']);
    console.log('PASS: legacy false-negative registration repaired, spaced path quoted.');

    startup.set(false);
    assert.equal(startup.reconcile(true, false), false);
    startup.set(true);
    assert.equal(startup.reconcile(true, false), true);
    assert.equal(app.getLoginItemSettings(options).openAtLogin, false);
    console.log('PASS: named startup enable, disable and restart readback.');

    // Simulate Task Manager's disable, with another enabled entry for the same
    // binary. The app must inspect its own entry, not an aggregate boolean.
    execFileSync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
      '/v', name, '/t', 'REG_BINARY', '/d', '030000000000000000000000', '/f'], { windowsHide: true });
    app.setLoginItemSettings({ ...options, name: otherName, openAtLogin: true, enabled: true });
    assert.equal(app.getLoginItemSettings(options).executableWillLaunchAtLogin, true);
    assert.equal(startup.reconcile(true, true), false);
    item = app.getLoginItemSettings(options).launchItems.find(item => item.name === name);
    assert.equal(item?.enabled, false);
    startup.set(true);
    assert.equal(startup.enabled(), true);
    console.log('PASS: Task Manager disable respected, explicit re-enable succeeds.');
  } catch (error) {
    console.error(error);
    code = 1;
  } finally {
    for (const key of [name, otherName]) app.setLoginItemSettings({ name: key, openAtLogin: false });
  }
  app.exit(code);
});
