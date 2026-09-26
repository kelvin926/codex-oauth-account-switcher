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
if (log.includes('did-fail-load') || !log.includes('메인 작업용') || !log.includes('1주 남은 양') ||
    !log.includes('초기화권') || !log.includes('3개') || !log.includes('1,234.56 크레딧')) {
  throw new Error('The packaged renderer did not display the account dashboard.');
}
if (statSync(screenshot).size < 10_000) throw new Error('Missing or empty dashboard screenshot');
console.log('Packaged Windows executable opened, rendered the demo dashboard, and exited successfully.');

const analyticsScreenshot = path.resolve('release/smoke-analytics.png');
const analytics = spawnSync(executable, [], {
  timeout: 30_000,
  env: { ...process.env, OAUTH_SWITCHER_DATA_ROOT: dataRoot, OAUTH_SWITCHER_DEMO_SCENARIO: 'populated',
    OAUTH_SWITCHER_DEMO_TAB: 'analytics', OAUTH_SWITCHER_SCREENSHOT_FILE: analyticsScreenshot,
    OAUTH_SWITCHER_AUTOCLOSE_AFTER_CAPTURE: 'true' }
});
if (analytics.error || analytics.status !== 0) throw analytics.error ?? new Error(`Analytics smoke exit: ${analytics.status}`);
const analyticsLog = readFileSync(path.join(dataRoot, 'logs', 'main.log'), 'utf8');
if (!analyticsLog.includes('모델과 리즈닝별 상세') || !analyticsLog.includes('통계 CSV') || statSync(analyticsScreenshot).size < 10_000) {
  throw new Error('The packaged analytics screen did not render.');
}
console.log('Packaged usage analytics rendered model/reasoning breakdown, filters, and chart.');
