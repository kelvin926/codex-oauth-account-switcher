import { describe, expect, it } from 'vitest';
import {
  buildCodexLaunchScript,
  buildCodexRuntimeScript,
  buildCodexTerminationScript,
  toCodexTerminationErrorMessage
} from '../codexRestart';

describe('Codex process scripts', () => {
  it('recognizes both the new ChatGPT host and legacy Codex process', () => {
    const runtime = buildCodexRuntimeScript();
    const termination = buildCodexTerminationScript();

    expect(runtime).toContain("@('ChatGPT', 'Codex')");
    expect(termination).toContain("@('ChatGPT', 'Codex')");
    expect(termination).toContain('CloseMainWindow');
    expect(termination).toContain('Stop-Process -Force');
  });

  it('launches the installed OpenAI.Codex package with a protocol fallback', () => {
    const script = buildCodexLaunchScript();

    expect(script).toContain("Get-AppxPackage -Name 'OpenAI.Codex'");
    expect(script).toContain('shell:AppsFolder');
    expect(script).toContain("Start-Process 'codex://'");
  });
});

describe('toCodexTerminationErrorMessage', () => {
  it('explains access denied as a privilege mismatch', () => {
    expect(
      toCodexTerminationErrorMessage(
        new Error('Stop-Process : Cannot stop process "ChatGPT" because Access is denied')
      )
    ).toBe(
      '실행 중인 ChatGPT/Codex가 더 높은 권한으로 열려 있어 종료할 수 없습니다. 계정 전환기를 관리자 권한으로 다시 실행하거나 앱을 직접 종료해 주세요.'
    );
  });

  it('explains an incomplete shutdown', () => {
    expect(
      toCodexTerminationErrorMessage(new Error('ChatGPT/Codex 프로세스를 완전히 종료하지 못했습니다.'))
    ).toBe('ChatGPT/Codex가 아직 종료되지 않았습니다. 작업 저장이 끝난 뒤 다시 시도해 주세요.');
  });

  it('falls back to a generic terminate failure message', () => {
    expect(toCodexTerminationErrorMessage(new Error('unexpected'))).toBe(
      'ChatGPT/Codex 종료 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    );
  });
});
