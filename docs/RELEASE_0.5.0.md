# v0.5.0

Liquid Glass에서 영감을 받은 Windows UI로 바꿨습니다. Electron과 CSS로 구현한 시각적 스타일이며 Apple의 iOS 네이티브 API를 사용하지 않습니다.

- 푸른 배경 위에 반투명 패널, 밝은 유리 테두리와 부드러운 그림자를 적용했습니다.
- 상단에 캡슐형 탭을 배치하고 현재 계정, 추천 계정과 주요 버튼을 간결하게 정리했습니다.
- 계정 아바타와 잔여량 막대를 추가했습니다. 현재 계정과 추천 계정은 배지와 색상으로 구분합니다.
- 사용량 분석, 초기화 예상, 설정과 로그인 창을 같은 색상과 간격으로 통일했습니다. 표와 수치는 읽기 쉽도록 밝은 바탕과 선명한 글자를 사용합니다.
- 키보드 포커스, 선택된 탭 상태와 진행률 이름을 제공합니다. 동작 줄이기, 투명도 줄이기, 고대비 설정에 대응하는 스타일을 추가했습니다.
- 작은 창에서 버튼과 필터가 줄바꿈되도록 배치했습니다. 과도한 배경 애니메이션과 중첩된 흐림 효과는 사용하지 않습니다.
- Pro 데모는 주간 한도만 표시하도록 갱신했습니다. 실제 계정은 계속 서버가 제공한 한도 창만 표시합니다.

계정 전환, 인증 저장, 초기화권 사용, 사용량 집계와 알림 로직은 그대로입니다. 기능과 통계 해석은 [v0.4.0 안내](https://github.com/kelvin926/codex-oauth-account-switcher/blob/main/docs/RELEASE_0.4.0.md)를 참고하세요.

## 화면 예시

Windows에서 실행한 데모 캡처입니다. 계정, 날짜, 잔여량과 초기화 예상 확률은 예시 값입니다.

### 계정 관리

유리 느낌의 탭과 버튼, 계정 카드, 잔여량 표시를 확인할 수 있습니다.

![계정 관리](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.5.0/smoke-dashboard.png)

### 사용량 분석

기간, 모델, 리즈닝 필터와 토큰 집계를 표시합니다. 모델별 주간 소모는 추정값이며 자료가 없으면 확인 불가로 남습니다.

![사용량 분석](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.5.0/smoke-analytics.png)

### 초기화 예상과 소식

예상 확률과 범위, 자료 시각과 초기화 통계를 표시합니다. 제3자의 예상이며 확정 일정이 아닙니다.

![초기화 예상과 소식](https://github.com/kelvin926/codex-oauth-account-switcher/releases/download/v0.5.0/smoke-forecast.png)

## 검증

UI 버튼, 비활성화 조건과 분석 필터의 기존 테스트를 확인했습니다. Windows 릴리스는 전체 테스트, 설치용 EXE와 ZIP 빌드, 세 화면의 실행 검사와 빈 캡처 검사를 통과한 후 게시됩니다. 캡처 PNG도 릴리스에 함께 첨부합니다.

디자인 참고: [Adopt Liquid Glass](https://learn.chatgpt.com/use-cases/ios-liquid-glass)
