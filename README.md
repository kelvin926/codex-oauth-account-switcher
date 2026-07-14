# Codex OAuth Account Switcher

Windows용 ChatGPT/Codex에서 여러 ChatGPT 계정의 인증을 안전하게 저장하고 전환하는 데스크톱 앱입니다.

v0.2.0은 최신 Windows 앱의 `ChatGPT.exe` 호스트 구조에 맞춰 전환 엔진을 다시 만들었습니다. 계정을 전환할 때 공유 Codex 홈은 그대로 두고 `auth.json`만 교체하므로 기존 채팅, 프로젝트, 설정, 플러그인과 로컬 작업 기록이 유지됩니다.

## v0.2.0에서 해결한 문제

- 최신 앱의 프로세스 이름인 `ChatGPT.exe`와 기존 `Codex.exe`를 모두 인식합니다.
- 창에 정상 종료 요청을 먼저 보내 로컬 SQLite와 채팅 상태가 저장될 시간을 줍니다.
- 현재 계정을 떠나기 직전에 회전된 refresh token을 해당 계정 번들에 다시 저장합니다.
- `auth.json`, `catalog.json`, `app-state.json`, 계정 번들을 임시 파일과 rename으로 원자 저장합니다.
- 손상되거나 0바이트가 된 JSON은 `.bak`에서 자동 복구하고 원본을 `.corrupt-<시간>`으로 보존합니다.
- 카탈로그가 복구되지 않아도 정상 암호화 번들을 찾아 계정 목록을 재구성합니다.
- 이미 등록된 계정을 다시 저장하면 오류 대신 최신 인증과 이름으로 갱신합니다.
- 전환 전 `auth.json` 롤백 백업을 암호화해서 보관합니다.
- 계정 전환 후 설치된 `OpenAI.Codex` Windows 앱을 자동으로 다시 엽니다.

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

GitHub Releases에서 다음 중 하나를 받습니다.

- `OAuth Account Switcher-0.2.0-x64.exe`: 설치 프로그램
- `OAuth Account Switcher-0.2.0-x64.zip`: 포터블 패키지

기존 v0.1.x 위에 설치해도 `%USERPROFILE%\.oauth-account-switcher` 데이터는 그대로 사용합니다.

## 빠른 사용법

1. ChatGPT/Codex에서 첫 계정으로 로그인합니다.
2. 전환기를 열고 **계정 추가** → **현재 계정 저장 또는 갱신**을 누릅니다.
3. ChatGPT/Codex의 공식 로그아웃과 로그인 화면으로 두 번째 계정에 로그인합니다.
4. 전환기에서 두 번째 계정도 저장합니다.
5. 이후 계정 카드의 **이 계정으로 전환**을 누릅니다.

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

아래 오류가 발생했던 기존 데이터도 v0.2.0 시작 시 복구를 시도합니다.

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

테스트에는 JSON 손상 복구, 계정 카탈로그 재구성, refresh token 체크포인트, 전환 롤백, ChatGPT/Codex 프로세스 스크립트, 채팅·설정 파일 불변성 검증이 포함됩니다.

자세한 사용 절차는 [docs/USAGE.md](docs/USAGE.md), 변경 내역은 [docs/RELEASE_0.2.0.md](docs/RELEASE_0.2.0.md)를 참고하세요.
