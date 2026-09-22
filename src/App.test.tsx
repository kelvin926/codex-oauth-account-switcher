/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getDemoDashboard } from './demo/demoData';
import type { DashboardPayload, DesktopApi } from './shared/desktopApi';

const dashboard = getDemoDashboard('populated');
function setupApi() {
  const api: DesktopApi = {
    getDashboard: vi.fn().mockResolvedValue(dashboard),
    refreshAll: vi.fn().mockResolvedValue(dashboard),
    refreshAccount: vi.fn().mockResolvedValue(dashboard),
    deleteAccount: vi.fn().mockResolvedValue(dashboard),
    captureCurrentAuth: vi.fn().mockResolvedValue(dashboard),
    switchAccount: vi.fn().mockResolvedValue(dashboard),
    switchRecommendedAccount: vi.fn().mockResolvedValue(dashboard),
    setAutoRestartOnSwitch: vi.fn().mockResolvedValue(dashboard),
    terminateCodex: vi.fn().mockResolvedValue(dashboard)
  };
  window.desktopApi = api;
  return api;
}
afterEach(() => cleanup());

describe('dashboard operations', () => {
  it('does not queue another restart on repeated clicks while switching', async () => {
    const api = setupApi();
    let finish!: (value: DashboardPayload) => void;
    vi.mocked(api.switchRecommendedAccount).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<App />);
    const button = screen.getByRole('button', { name: '추천으로 전환' });
    await waitFor(() => expect(button.closest('fieldset')?.disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.switchRecommendedAccount).toHaveBeenCalledTimes(1);
    expect(button.closest('fieldset')?.disabled).toBe(true);
    await act(async () => { finish(dashboard); });
    expect(button.closest('fieldset')?.disabled).toBe(false);
  });

  it('keeps the account modal and entered label after a failed save', async () => {
    const api = setupApi();
    vi.mocked(api.captureCurrentAuth).mockRejectedValue(new Error('인증 파일 없음'));
    render(<App />);
    const add = screen.getByRole('button', { name: '계정 추가' });
    await waitFor(() => expect(add.closest('fieldset')?.disabled).toBe(false));
    fireEvent.click(add);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '내 계정' } });
    fireEvent.click(screen.getByRole('button', { name: '현재 계정 저장 또는 갱신' }));
    await waitFor(() => expect(screen.getByText('인증 파일 없음')).toBeTruthy());
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('내 계정');
  });
});
