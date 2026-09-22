import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dataRoot = mkdtempSync(path.join(tmpdir(), 'switcher-smoke-'));
const executable = path.resolve('release/win-unpacked/OAuth Account Switcher.exe');
const screenshot = path.resolve('release/smoke-dashboard.png');
const result = spawnSync(executable, [], {
  timeout: 30_000,
  env: {
    ...process.env,
    OAUTH_SWITCHER_DATA_ROOT: dataRoot,
    OAUTH_SWITCHER_DEMO_SCENARIO: 'populated',
    OAUTH_SWITCHER_SCREENSHOT_FILE: screenshot,
    OAUTH_SWITCHER_AUTOCLOSE_AFTER_CAPTURE: 'true'
  }
});
if (result.error || result.status !== 0) throw result.error ?? new Error(`Smoke exit: ${result.status}`);
const log = readFileSync(path.join(dataRoot, 'logs', 'main.log'), 'utf8');
if (log.includes('did-fail-load') || !log.includes('메인 작업용') || !log.includes('1주 남은 양')) {
  throw new Error('The packaged renderer did not display the account dashboard.');
}
if (statSync(screenshot).size < 10_000) throw new Error('Missing or empty dashboard screenshot');
console.log('Packaged Windows executable opened, rendered the demo dashboard, and exited successfully.');
