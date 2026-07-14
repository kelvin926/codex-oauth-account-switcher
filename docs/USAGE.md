# Codex 계정 전환기 사용법

## 설치 전 백업

v0.2.0은 기존 데이터를 자동 마이그레이션하지만 업무용 PC에서는 처음 실행 전에 다음 두 폴더를 백업하는 것을 권장합니다.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:USERPROFILE "Desktop\codex-switcher-backup-$stamp"
New-Item -ItemType Directory -Force $backup | Out-Null

if (Test-Path "$env:USERPROFILE\.oauth-account-switcher") {
  Copy-Item "$env:USERPROFILE\.oauth-account-switcher" "$backup\oauth-account-switcher" -Recurse
}

if (Test-Path "$env:USERPROFILE\.codex\auth.json") {
  New-Item -ItemType Directory -Force "$backup\codex" | Out-Null
  Copy-Item "$env:USERPROFILE\.codex\auth.json" "$backup\codex\auth.json"
}

Write-Host "백업 완료: $backup"
```

이 수동 백업에는 인증 토큰이 포함되므로 외부 공유 폴더나 클라우드 동기화 폴더에 두지 마세요.

## 계정 등록

1. ChatGPT/Codex 앱에서 등록할 계정으로 공식 로그인합니다.
2. 계정 전환기를 실행합니다.
3. **계정 추가**를 누릅니다.
4. 알아보기 쉬운 이름을 입력합니다.
5. **현재 계정 저장 또는 갱신**을 누릅니다.

같은 계정이 이미 등록돼 있으면 최신 `auth.json`으로 안전하게 갱신됩니다. 기존의 “이미 등록된 계정” 오류는 더 이상 발생하지 않습니다.

다른 계정을 처음 등록할 때만 ChatGPT/Codex에서 공식 로그아웃 후 새 계정으로 로그인하고 위 절차를 반복합니다.

v0.1.x에서 오래 보관한 번들은 이미 서버에서 교체된 refresh token을 담고 있을 수 있습니다. 해당 계정이 첫 전환에서 로그아웃 상태가 되면 공식 로그인 후 **현재 계정 저장 또는 갱신**을 한 번 실행하세요. 이후 v0.2.0은 계정을 떠날 때마다 최신 회전 토큰을 체크포인트합니다.

## 계정 전환

계정 카드에서 **이 계정으로 전환**을 누릅니다. 전환기가 자동으로:

1. 대상 계정 번들의 구조와 refresh token을 확인합니다.
2. `ChatGPT.exe` 및 `Codex.exe`에 정상 종료를 요청합니다.
3. 현재 `auth.json`의 최신 회전 토큰을 현재 계정 번들에 저장합니다.
4. 현재 `auth.json`을 암호화 백업합니다.
5. 대상 인증을 원자적으로 기록하고 다시 읽어 검증합니다.
6. Windows의 `OpenAI.Codex` 패키지를 다시 실행합니다.

정상 종료가 12초 안에 끝나지 않을 때만 남은 프로세스를 강제 종료합니다. 종료 또는 파일 교체가 실패하면 기존 인증을 복원하고 가능한 경우 앱도 다시 엽니다.

## 채팅과 설정 보존

전환기는 공용 `%USERPROFILE%\.codex` 홈을 계속 사용합니다. `auth.json` 이외의 Codex 파일에는 쓰지 않습니다.

따라서 다음 항목이 유지됩니다.

- 로컬/최근/보관 채팅 기록
- 프로젝트 및 작업 폴더 연결
- `config.toml` 설정과 MCP 구성
- 플러그인, 스킬, 규칙, 메모리
- 테마, 단축키, 앱 전역 상태

서버에 저장된 채팅은 계정 소유이므로 다른 계정에서는 보이지 않을 수 있지만, 원래 계정으로 돌아가면 다시 나타납니다.

## 손상 데이터 복구

`catalog.json` 또는 `app-state.json`이 비어 있거나 중간까지만 기록된 경우 앱이 자동으로:

- 손상본을 `.corrupt-<시간>`으로 복사
- 마지막 `.bak` 복원
- 필요하면 `bundles` 폴더에서 계정 카드 재구성

복구된 카드 이름은 이메일 또는 `복구된 계정 <ID 앞부분>`으로 표시될 수 있습니다. **계정 추가**에서 현재 계정을 다시 저장하면 원하는 이름과 최신 토큰으로 갱신됩니다.

## 문제 해결

### 현재 계정을 확인할 수 없음

ChatGPT/Codex에서 로그인이 끝났는지 확인하고 다음 파일이 존재하며 0바이트가 아닌지 확인합니다.

```powershell
Get-Item "$env:USERPROFILE\.codex\auth.json"
```

파일을 직접 수정하지 말고 공식 로그인 화면에서 다시 로그인하세요.

### ChatGPT/Codex를 종료할 수 없음

ChatGPT 앱이 관리자 권한으로 실행 중이면 계정 전환기도 관리자 권한으로 실행해야 합니다. 먼저 실행 중인 작업이 끝났는지 확인하세요.

### 앱이 자동으로 다시 열리지 않음

인증 전환은 완료됐을 수 있습니다. 시작 메뉴에서 ChatGPT를 직접 실행하고 활성 계정을 확인하세요.

### 조직 계정이 자동 로그아웃됨

`forced_login_method` 또는 `forced_chatgpt_workspace_id` 같은 조직 정책과 선택한 계정이 맞는지 관리자에게 확인하세요. 전환기는 관리 정책을 변경하거나 우회하지 않습니다.
