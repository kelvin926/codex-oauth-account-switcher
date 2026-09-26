/* @vitest-environment jsdom */
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import { AnalyticsPanel } from './AnalyticsPanel';
afterEach(cleanup);
describe('analytics filters',()=>{
 it('filters the model and changes time granularity without hiding the estimation caveat',async()=>{
  render(<AnalyticsPanel accounts={[]} demo/>);
  await waitFor(()=>expect(screen.getByText('모델과 리즈닝별 상세')).toBeTruthy());
  expect(screen.getByText('GPT-6 Astra / medium')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('모델'),{target:{value:'GPT-6 Sol'}});
  await waitFor(()=>expect(screen.queryByText('GPT-6 Astra / medium')).toBeNull());
  expect(screen.getByText('GPT-6 Sol / xhigh')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('집계 단위'),{target:{value:'hour'}});
  await waitFor(()=>expect(screen.getByRole('img',{name:'기간별 총토큰 막대 그래프'}).querySelectorAll('rect').length).toBeGreaterThan(2));
  fireEvent.focus(screen.getByRole('button',{name:'주간 한도 추정 도움말'}));
  expect(screen.getByRole('tooltip').textContent).toContain('주간 소모율은 추정값입니다.');
  fireEvent.keyDown(screen.getByRole('button',{name:'주간 한도 추정 도움말'}),{key:'Escape'});
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('button',{name:'캐시 적중률 도움말'})).toBeTruthy();
 });
});
