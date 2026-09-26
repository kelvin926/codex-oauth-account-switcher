# v0.3.1

- 계정 카드에 사용 가능한 **초기화권 개수**와 **남은 크레딧**을 추가했습니다.
- 앱 시작 시 사용량 갱신, 계정별 갱신, 전체 갱신에서 함께 업데이트합니다.
- 초기화권은 서버의 `rate_limit_reset_credits.available_count`를 사용합니다. 상세 목록의 길이로 개수를 추정하지 않습니다.
- 크레딧은 서버의 `credits.balance`를 표시하며 소수점 잔액도 유지합니다. 명시적으로 무제한인 계정은 `무제한`, 잔액 없이 보유 여부만 제공되면 `보유 (잔액 미제공)`으로 표시합니다.
- 실제 0개/0 크레딧과 정보 미제공을 구분합니다. 이전 버전에서 저장된 데이터나 서버가 제공하지 않는 항목은 `확인 불가`로 표시합니다.
- 사용량 한도가 없는 크레딧 기반 계정의 잔액 응답도 처리합니다.
- 기존 조회 응답만 읽습니다. 초기화권 사용, 크레딧 구매 및 차감 동작은 추가하지 않았습니다.

설치 후 **전체 갱신**을 누르면 저장된 계정의 새 항목을 다시 조회할 수 있습니다.

필드 확인에 사용한 공식 소스:
- https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/types.rs
- https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs
- https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/credit_status_details.rs
- https://learn.chatgpt.com/docs/app-server
