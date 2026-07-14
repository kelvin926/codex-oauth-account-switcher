import type { RegistrationState } from '../../shared/desktopApi';

export function getRegistrationHelpText(registration: RegistrationState | null): string {
  if (registration?.mode === 'codex-login') {
    return 'ChatGPT/Codex에서 로그인을 마친 뒤 현재 인증 저장을 누르면 계정이 추가됩니다.';
  }

  return '전환 시 인증만 바뀝니다. 채팅, 프로젝트, 플러그인과 설정은 그대로 유지됩니다.';
}
