import { describe, expect, it } from 'vitest';
import { getRegistrationHelpText } from './registerAccountFlow';

describe('getRegistrationHelpText', () => {
  it('returns the default help text when no registration is pending', () => {
    expect(getRegistrationHelpText(null)).toBe(
      '전환 시 인증만 바뀝니다. 채팅, 프로젝트, 플러그인과 설정은 그대로 유지됩니다.'
    );
  });

  it('returns pending Codex login guidance when registration is in progress', () => {
    expect(
      getRegistrationHelpText({
        mode: 'codex-login',
        startedAt: '2026-04-09T12:00:00.000Z'
      })
    ).toBe(
      'ChatGPT/Codex에서 로그인을 마친 뒤 현재 인증 저장을 누르면 계정이 추가됩니다.'
    );
  });
});
