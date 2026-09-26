/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForecastPanel } from './ForecastPanel';
import { getDemoForecast } from '../../demo/forecast';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('forecast news', () => {
  it('shows pending posts, the 30-day pace and separate refresh/reset dates without rendering all historical text', async () => {
    render(<ForecastPanel demo/>);
    await waitFor(() => expect(screen.getByText('초기화 예고')).toBeTruthy());
    expect(screen.getByText('59%')).toBeTruthy();
    expect(screen.getByText('3.3일')).toBeTruthy();
    expect(screen.queryByText('3.6일')).toBeNull();
    expect(screen.getByText(/예측 갱신/)).toBeTruthy();
    expect(screen.getByText('마지막 초기화 기록')).toBeTruthy();
    expect(screen.queryByText(/데모용 공지입니다/)).toBeNull();
    fireEvent.click(screen.getByText('초기화 기록과 Tibo 공지'));
    await waitFor(() => expect(screen.getByText(/데모용 공지입니다/)).toBeTruthy());
  });
  it('labels a missing live timeline explicitly when the API fallback still has a fresh forecast', async () => {
    const value = getDemoForecast();
    value.data = { ...value.data!, source: 'api', posts: [], timelineLive: null };
    Object.defineProperty(window, 'desktopApi', { configurable: true, value: { getForecast: vi.fn(async () => value) } });
    render(<ForecastPanel demo={false}/>);
    await waitFor(() => expect(screen.getByText(/최신 Tibo 피드를 불러오지 못했습니다/)).toBeTruthy());
    expect(screen.queryByText(/오래된 저장 기록/)).toBeNull();
    expect(screen.queryByText('초기화 예고')).toBeNull();
  });
});
