/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SummaryBar } from './SummaryBar';

describe('SummaryBar', () => {
  it('shows the automatic restart setting and a visible danger action', async () => {
    const user = userEvent.setup();
    const onAutoRestartChange = vi.fn();

    render(
      <SummaryBar
        activeLabel="active"
        recommendedLabel="recommended"
        recommendedDisabled={false}
        autoRestartOnSwitch={true}
        onSwitchRecommended={vi.fn()}
        onRefreshAll={vi.fn()}
        onAutoRestartChange={onAutoRestartChange}
        onTerminateCodex={vi.fn()}
        onAddAccount={vi.fn()}
      />
    );

    const toggle = screen.getByRole('checkbox', {
      name: '전환 시 자동 종료 및 재시작'
    });
    expect((toggle as HTMLInputElement).checked).toBe(true);

    await user.click(toggle);
    expect(onAutoRestartChange).toHaveBeenCalledWith(false);

    const terminateButton = screen.getByRole('button', {
      name: 'ChatGPT/Codex 종료'
    });
    expect(terminateButton.className).toContain('danger-button');

    expect(
      screen.getAllByRole('button').map((button) => button.textContent?.trim())
    ).toEqual([
      '추천으로 전환',
      '전체 갱신',
      'ChatGPT/Codex 종료',
      '계정 추가',
    ]);
  });
});

