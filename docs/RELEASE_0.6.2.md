# v0.6.2

사용량 분석을 Codex 앱의 ChatGPT 로그인 기준으로 수정했습니다. Fast와 긴 컨텍스트를 반영하고, Astra의 컨텍스트 할증 면제를 적용합니다.

## 계산 기준

| 항목 | 적용 내용 |
| --- | --- |
| Fast | GPT-6 Astra/Sol/Luna, GPT-5.6 Sol/Terra/Luna, GPT-5.5에서 크레딧 2.5배 |
| 긴 컨텍스트 | 요청 입력이 272,000토큰을 초과하면 해당 요청 전체 입력과 캐시 입력 2배, 출력 1.5배 |
| Astra 예외 | Codex의 GPT-6 Astra는 긴 컨텍스트 할증 면제. Fast를 쓰면 Fast 2.5배는 적용 |
| 캐시 쓰기 | 별도 가산 없음. 캐시 쓰기 토큰은 일반 입력 안에서 계산 |
| Max와 Ultra | 로그에 기록된 이름을 구분. 고정 할증률을 추가하지 않고 실제 입력/출력 토큰으로 계산 |

Fast 배수는 컨텍스트 배수를 적용한 금액에 곱합니다. 추가 소모 내역은 컨텍스트 가산 후 Fast 가산 순서로 나누어 중복 합산하지 않습니다. 추론 토큰은 출력에 이미 포함되어 있어 한 번만 계산합니다. 설정된 최대 컨텍스트나 누적 토큰 합계로 할증을 판단하지 않습니다.

## 화면과 이력

- 사용 금액 아래 Codex 크레딧 상당량을 표시하고, Fast와 컨텍스트로 추가된 금액을 분리합니다.
- 속도 필터와 개별 기록의 속도를 추가했습니다. 생각 깊이는 Max와 Ultra까지 자연스러운 순서로 정렬합니다.
- 주간 한도 감소분을 단순 토큰 비율 대신 모델 단가, 캐시 할인, Fast, 컨텍스트를 반영한 크레딧 비중으로 배분합니다. 실제 계정 한도는 서버 관측값입니다.
- 기존 분석 파일을 원본 로그에서 순차적으로 다시 읽어 속도 정보를 보완합니다. 계정의 한도 관측 이력은 유지하며 기록을 중복 합산하지 않습니다.
- CSV에 크레딧 상당량, 추가 소모 금액, Astra 면제 건수, 계산 가정을 함께 저장합니다.

## 추정의 범위

금액은 현재 공개 Codex 요율로 환산한 비교용 추정치입니다. **실제 청구액이나 Pro 주간 한도의 고정 가격이 아닙니다.** 공개 Enterprise USD 요율과 일치하는 기본 환산값 `1크레딧 = $0.04`를 사용하며, 계산 기준에서 구매 단가에 맞춰 변경할 수 있습니다. 실제 구매 단가는 요금제와 계약에 따라 달라집니다. 과거 기록도 현재 기준으로 다시 환산하며 과거 단가 변경을 재현하지는 않습니다.

턴의 속도 기록을 우선 사용합니다. 당시 대화의 기본 속도만 있는 로그는 **기본 설정 기반 추정**으로 표시합니다. 턴 전용 변경이나 실행 중 변경을 완전히 복원할 수는 없습니다. 속도 정보가 전혀 없으면 기본적으로 금액 계산에서 제외하며, 계산 기준에서 Standard 또는 Fast로 가정할 수 있습니다. 가정을 사용한 기록 수는 화면과 CSV에 표시합니다. 현재 Codex 설정으로 과거 기록의 속도를 덮어씌우지 않습니다.

주간 100% 금액은 같은 계정과 초기화 주기의 연속 관측 구간에서 비용과 한도 감소를 비교해 추정합니다. 모델, 생각 깊이, 속도 필터를 바꿔도 계정 전체 추정은 유지합니다. 계산 불가 기록이 섞인 구간은 주간 배분과 금액 추정에서 제외합니다. 로컬에 없는 다른 기기, 도구, 이미지 생성 등의 사용은 누락될 수 있습니다. Ultra가 사용한 하위 에이전트도 로컬에 남은 각 기록만 집계하며, Max를 임의로 Ultra로 바꾸지 않습니다.

## 공식 근거

2026-09-26 확인했습니다.

- [Codex 크레딧 요율과 구독 한도 안내](https://learn.chatgpt.com/docs/pricing)
- [Codex Fast 속도와 크레딧 배수](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [Codex USD 요율, 장문 배수와 Astra 예외](https://help.openai.com/en/articles/20001415-chatgpt-rate-card-enterprise-token-based-pricing)
- [Codex 크레딧 과금과 캐시 쓰기](https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing)
- [Max와 Ultra](https://learn.chatgpt.com/docs/models)

## 화면 예시

실제 Windows EXE에서 촬영한 데모입니다. 계정과 수치는 예시입니다.

![Codex 사용량과 추가 소모 분석](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.2/smoke-analytics.png)

![계정 관리](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.6.2/smoke-dashboard.png)

## 검증

272K 경계, Fast와 컨텍스트 조합, Astra 면제, 캐시 할인과 쓰기 처리, Max/Ultra, 속도 정보 누락, 구버전 기록 재분석, 주간 한도 배분과 필터를 검사합니다. Windows 전체 테스트, 실제 자동 시작 등록 검사, 패키지 EXE의 3개 화면 캡처가 성공한 뒤 배포합니다.
