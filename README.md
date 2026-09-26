# Codex OAuth Account Switcher

Windows용 ChatGPT/Codex에서 여러 ChatGPT 계정의 인증을 안전하게 저장하고 전환하는 데스크톱 앱입니다.

v0.4.0은 탐색기를 경유하지 않는 Windows 앱 재실행, 서버 응답에 따른 사용량 표시, 중복 전환 방지를 제공합니다. 계정 전환 시 공용 Codex 홈은 유지하고 `auth.json`만 교체합니다.

## v0.4.0 주요 변경

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

- `OAuth Account Switcher-0.4.0-x64.exe`: 설치 프로그램
- `OAuth Account Switcher-0.4.0-x64.zip`: 포터블 패키지

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

자세한 사용 절차는 [docs/USAGE.md](docs/USAGE.md), 변경 내역은 [docs/RELEASE_0.4.0.md](docs/RELEASE_0.4.0.md)를 참고하세요.
