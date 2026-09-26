# Codex OAuth Account Switcher

Windows용 ChatGPT/Codex에서 여러 ChatGPT 계정의 인증을 안전하게 저장하고 전환하는 데스크톱 앱입니다.

v0.6.3은 Lunarwerx 사이트와 초기화 소식 표시를 맞췄습니다. 최신 Tibo 초기화 예고를 가져오고, 평균 대기는 사이트와 같은 최근 30일 기준으로 표시합니다. 실제 자료가 오래된 경우와 갱신 실패를 구분합니다. Codex 앱 기준 비용 분석, Fast와 Astra 컨텍스트 예외, Windows 자동 시작과 잔여량 1% 알림을 유지합니다.

[v0.6.3 변경 안내](docs/RELEASE_0.6.3.md)

## 화면 예시

Windows 실행 화면의 데모 캡처입니다. 계정, 날짜, 사용량과 예상 확률은 예시 값입니다. 실제 한도 창은 서버 응답에 따라 표시하며, 없는 5시간 제한을 추가하지 않습니다.

### 계정 관리

계정별 잔여량, 초기화 시각, 초기화권과 크레딧을 확인하고 계정을 전환합니다.

![계정 관리 데모 화면](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.3/smoke-dashboard.png)

### 사용량 분석

사용 금액, 처리한 글의 양, 입력 재사용 비율과 절약액을 쉬운 설명으로 확인합니다. 생각 깊이(리즈닝)는 Max와 Ultra까지 표시하고 원래 옵션 이름도 함께 제공합니다. 기간, 계정, 모델, 생각 깊이와 속도로 필터링할 수 있습니다. 같은 계정의 한도 관측과 비용으로 주간 100% 금액을 추정합니다. 모델별 주간 소모율은 추정값이며, 관측 자료가 없으면 확인 불가로 표시합니다.

![사용량 분석 데모 화면](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.3/smoke-analytics.png)

### 초기화 예상과 소식

Lunarwerx 사이트 피드의 24시간 및 단기 예상 확률, 추정 범위와 초기화 통계를 표시합니다. 예측 갱신 시각과 마지막 초기화 시각을 구분합니다. 최신 Tibo 소식에는 초기화 예고도 포함되며, 과거 기록은 펼쳐서 확인합니다. 사이트처럼 확률은 정수로 반올림하고 평균 대기는 최근 30일 기준으로 표시합니다.

![초기화 예상과 소식 데모 화면](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.3/smoke-forecast.png)

![최신 Tibo 소식 데모 화면](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.3/smoke-forecast-news.png)

## 주요 기능

- **자동 실행과 갱신**: Windows 자동 시작과 5분 간격 사용량 갱신이 기본값입니다. 설정에서 자동 시작과 1/2/5/10/15분 갱신 또는 끄기를 선택합니다. 트레이 유지 시 자동 시작은 창을 띄우지 않습니다.
- **잔여량 부족 알림**: 1/5/10/20/30% 이하 중 선택합니다. 기준을 바꾸면 다음 갱신부터 적용합니다. 같은 부족 상태에서는 반복하지 않습니다.
- **주간 한도 초기화 알림**: 정기 초기화 시각이 같아도 사용률이 1%p 이상 감소하면 복구를 알립니다. 마지막 유효 관측을 저장하여 앱 재시작 후에도 비교합니다. Windows 알림 허용과 앱 실행이 필요합니다.
- **비용과 캐시**: Codex 크레딧 상당량과 USD 환산액, 캐시 적중률과 절약액, 주간 한도 100%와 사용/잔여 금액을 추정합니다. Fast는 지원 모델에서 2.5배입니다. 272K 초과 요청은 입력/캐시 2배와 출력 1.5배이며 Astra는 컨텍스트 할증이 면제됩니다. 실제 Pro 구독 청구액은 아니며 [계산 근거와 한계](docs/RELEASE_0.6.2.md)를 확인하세요.

- **사용량 분석**: 모델, 리즈닝, 입력/캐시/출력/추론 토큰을 기간별, 날짜별, 시간별로 보고 CSV로 내보냅니다.
- **주간 한도와 크레딧 이력**: 서버 관측값을 보관하고 제한된 관측 구간에서 모델별 주간 소모를 추정합니다. 정확한 모델별 과금률은 아닙니다. 로컬 로그에 없는 사용량과 계정을 확인하지 못한 과거 기록은 임의 배정하지 않습니다.
- 트레이와 빠른 전환, 자동 갱신과 잔여량/한도 복구 알림을 추가했습니다. 창을 닫으면 트레이에 유지되고 트레이 메뉴에서 종료할 수 있습니다.
- 초기화권 만료일과 수동 사용, 추천 방식과 계정 우선순위/제외, 공식 로그인과 재로그인, 단계별 전환 상태와 진단/복구를 추가했습니다.
- 분석과 검증의 정확한 범위는 [v0.4.0 안내](docs/RELEASE_0.4.0.md)를 확인하세요.


- 계정별 사용 가능한 초기화권 개수와 남은 크레딧을 표시합니다. 설치 후 **전체 갱신**으로 새 정보를 불러오세요. 서버가 정보를 제공하지 않으면 `확인 불가`로 표시합니다.

- 전환 때 문서 폴더를 열 수 있던 `explorer.exe` 호출을 Windows 앱 활성화 API로 교체했습니다.
- 주간 한도만 있는 Pro 계정을 지원하며, 없는 5시간 제한을 잔여량 0%로 표시하거나 추천 점수에 반영하지 않습니다.
- 활성 계정의 최신 토큰으로 사용량을 갱신합니다. 조회와 PowerShell 실행에 제한 시간을 적용했습니다.
- 전환 중 중복 클릭, 앱 중복 실행, 상태 조회 요청 누적을 방지합니다.
- 로그아웃 상태에서도 저장한 계정으로 돌아갈 수 있고, 전환 실패 시 이전 상태로 복원합니다.
- 자동 종료 및 재시작 선택, 암호화 번들, 손상된 JSON 복구, 최신 refresh token 저장 기능을 유지합니다.

## 채팅과 설정이 유지되는 이유

전환기는 `%USERPROFILE%\.codex` 전체를 바꾸지 않습니다. 다음 항목은 복사, 이동, 삭제 또는 덮어쓰기하지 않습니다.

- `config.toml`
- `.codex-global-state.json`
- `state_5.sqlite`와 다른 SQLite 파일
- `sessions\`, `archived_sessions\`, `session_index.jsonl`
- `plugins\`, `skills\`, `memories\`, `rules\`
- 프로젝트와 worktree 상태

계정 전환 과정에서 Codex 쪽에서 변경되는 파일은 `%USERPROFILE%\.codex\auth.json` 하나뿐입니다. 계정별 서버 채팅은 해당 계정으로 다시 돌아오면 다시 표시되고, 공용 로컬 작업 기록과 설정은 계속 같은 Codex 홈을 사용합니다.

## 설치

[GitHub Releases](https://github.com/kelvin926/codex-oauth-account-switcher/releases/latest)에서 다음 중 하나를 받습니다.

- `OAuth.Account.Switcher-0.6.3-x64.exe`: 설치 프로그램
- `OAuth.Account.Switcher-0.6.3-x64.zip`: 포터블 패키지

기존 v0.1.x 위에 설치해도 `%USERPROFILE%\.oauth-account-switcher` 데이터는 그대로 사용합니다.

## 빠른 사용법

1. ChatGPT/Codex에서 첫 계정으로 로그인합니다.
2. 전환기를 열고 **계정 추가** → **현재 계정 저장 또는 갱신**을 누릅니다.
3. 전환기의 **계정 추가 → 브라우저에서 로그인 시작**으로 다음 계정을 추가합니다.
4. 브라우저에 표시된 기기 코드를 입력하면 인증이 저장됩니다. 설치된 Codex CLI가 없는 경우 공식 Codex에서 로그인한 계정을 직접 저장할 수 있습니다.
5. 이후 계정 카드의 **이 계정으로 전환**을 누릅니다.

기본값인 **전환 시 자동 종료 및 재시작**을 켜 두면 종료와 재실행까지 전환기가 처리합니다. 이 옵션을 끈 경우에는 먼저 빨간색 **ChatGPT/Codex 종료** 버튼을 누르고, 계정 전환이 끝난 뒤 앱을 직접 실행하세요.

전환기는 다음 순서로 처리합니다.

```text
대상 인증 검증
→ ChatGPT/Codex 정상 종료 요청
→ 현재 계정의 최신 회전 토큰 저장
→ 현재 auth.json 암호화 백업
→ 대상 auth.json 원자 교체 및 재검증
→ ChatGPT 앱 자동 재실행
```

## 기존 오류에서 자동 복구

아래 오류가 발생했던 기존 데이터도 v0.2.0 이상에서 시작 시 복구를 시도합니다.

```text
Error invoking remote method 'dashboard:get':
SyntaxError: Unexpected end of JSON input
```

복구 우선순위는 다음과 같습니다.

1. 현재 JSON이 정상이라면 그대로 사용
2. `.bak`이 정상이면 자동 복원
3. 둘 다 손상됐으면 안전한 기본값 생성
4. `bundles\*.bundle`을 복호화해 누락된 계정 목록 재구성

손상 파일은 삭제하지 않고 같은 폴더에 `.corrupt-<시간>` 이름으로 남깁니다.

## 데이터 위치

```text
%USERPROFILE%\.oauth-account-switcher\
├─ catalog.json
├─ catalog.json.bak
├─ app-state.json
├─ app-state.json.bak
├─ bundles\
└─ backups\auth\
```

계정 번들과 전환 롤백 백업은 로컬 암호화되어 저장됩니다. 이 폴더도 사용자 계정의 중요한 인증 자료로 취급하고 외부에 공유하지 마세요.

## 요구 사항과 제한

- Windows용 최신 ChatGPT/Codex 앱과 파일 기반 Codex 인증이 필요합니다.
- `%USERPROFILE%\.codex\auth.json`이 없거나 비어 있으면 먼저 ChatGPT/Codex에서 공식 로그인을 완료해야 합니다.
- `cli_auth_credentials_store = "keyring"`만 강제로 사용하는 환경은 파일 전환 방식과 호환되지 않습니다.
- 조직 정책의 `forced_login_method` 또는 `forced_chatgpt_workspace_id`를 우회하지 않습니다.
- 계정 전환 중 실행 중인 ChatGPT/Codex 창과 같은 Codex 홈을 쓰는 CLI 프로세스가 종료됩니다.

## 개발과 검증

```powershell
npm install
npm run lint
npm test
npm run build
npm run dist:win
```

테스트에는 JSON 손상 복구, 계정 카탈로그 재구성, refresh token 체크포인트, 전환 롤백, ChatGPT/Codex 프로세스 스크립트, 채팅 및 설정 파일 불변성 검증이 포함됩니다.

자세한 사용 절차는 [docs/USAGE.md](docs/USAGE.md), 최신 변경 내역은 [docs/RELEASE_0.6.3.md](docs/RELEASE_0.6.3.md)를 참고하세요.

`초기화 소식`에서는 [Lunarwerx Codex Forecast](https://codex.lunarwerx.com/)의 초기화 예상 확률과 범위, 초기화 이력, 이력에 연결된 Tibo 공지를 볼 수 있습니다. 5분 간격으로 갱신하며 새 기록, 공지, 예상 확률 상승 시 Windows 알림을 제공합니다. 제3자의 예상이며 내 계정의 초기화나 잔여 크레딧을 보장하지 않습니다. 데이터가 오래되거나 연결이 끊기면 마지막 정상 기록과 경고를 표시합니다. 이 공개 데이터 연결에는 계정 인증을 보내지 않습니다.
