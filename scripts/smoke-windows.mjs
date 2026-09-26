import { copyFileSync, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const executable = path.resolve('release/win-unpacked/OAuth Account Switcher.exe');
const screens = [
  { tab: 'accounts', name: 'dashboard', markers: ['메인 작업용', '1주 남은 양', '초기화권', '3개', '1,234.56 크레딧'] },
  { tab: 'analytics', name: 'analytics', markers: ['모델별 사용 내역', 'CSV로 저장', 'GPT-6 Sol', '캐시 적중률', '사용 금액 (추정)', '주간 한도 100%를 금액으로', '남음 70.0%', '실제 청구 금액은 아닙니다.', 'Codex 앱 크레딧으로 계산합니다.', 'Fast 추가', '컨텍스트 추가', '최대 (max)', '울트라 (ultra)'] },
  { tab: 'forecast', name: 'forecast', markers: ['초기화 기록과 Tibo 공지', '59%', 'Lunarwerx', '평균 대기 (30일)', '3.3일', '예측 갱신'] },
  { tab: 'forecast', name: 'forecast-news', section: 'news', markers: ['최신 Tibo 소식', '초기화 예고', '초기화 관련 공지', 'X 원문 열기'] }
];
for (const { tab, name, markers, section } of screens) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), `switcher-smoke-${name}-`));
  const screenshot = path.resolve(`release/smoke-${name}.png`);
  const result = spawnSync(executable, [], {
    timeout: 30_000,
    env: { ...process.env, OAUTH_SWITCHER_DATA_ROOT: dataRoot, OAUTH_SWITCHER_DEMO_SCENARIO: 'populated',
      OAUTH_SWITCHER_DEMO_TAB: tab, OAUTH_SWITCHER_DEMO_SECTION: section ?? '', OAUTH_SWITCHER_SCREENSHOT_FILE: screenshot, OAUTH_SWITCHER_AUTOCLOSE_AFTER_CAPTURE: 'true' }
  });
  const logPath = path.join(dataRoot, 'logs', 'main.log');
  if (existsSync(logPath)) copyFileSync(logPath, `release/smoke-${name}.log`);
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} smoke exit: ${result.status}`);
  const log = readFileSync(logPath, 'utf8');
  if (log.includes('did-fail-load') || log.includes('renderer-capture-error') || markers.some(marker => !log.includes(marker))) {
    throw new Error(`The packaged ${name} renderer failed: ${markers.filter(marker => !log.includes(marker)).join(', ')}. See smoke-${name}.log.`);
  }
  if (statSync(screenshot).size < 10_000) throw new Error(`Missing or empty ${name} screenshot`);
  console.log(`Packaged Windows executable rendered ${name} and exited successfully.`);
}
