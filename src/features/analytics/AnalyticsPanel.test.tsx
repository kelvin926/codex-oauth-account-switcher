/* @vitest-environment jsdom */
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import { AnalyticsPanel } from './AnalyticsPanel';
import { getDemoDashboard } from '../../demo/demoData';
afterEach(cleanup);
describe('analytics filters',()=>{
 it('filters the model and changes time granularity without hiding the estimation caveat',async()=>{
  render(<AnalyticsPanel accounts={getDemoDashboard('populated').accounts} demo/>);
  await waitFor(()=>expect(screen.getByText('모델별 사용 내역')).toBeTruthy());
  expect(screen.getByText('실제 청구 금액은 아닙니다.',{exact:false})).toBeTruthy();
  expect(screen.getByText('남음 70.0%')).toBeTruthy();
  const budget=screen.getByRole('progressbar',{name:'주간 한도 사용률'});
  expect(Number(budget.getAttribute('value'))).toBeCloseTo(30);
  fireEvent.change(screen.getByLabelText('모델'),{target:{value:'GPT-6 Sol'}});
  await waitFor(()=>expect(screen.queryByRole('rowheader',{name:/GPT-6 Astra/})).toBeNull());
  expect(screen.getByRole('rowheader',{name:/GPT-6 Sol.*매우 깊게/})).toBeTruthy();
  expect(Number(budget.getAttribute('value'))).toBeCloseTo(30); // Account budget must not change with model filter.
  fireEvent.change(screen.getByLabelText('생각 깊이'),{target:{value:'medium'}});
  await waitFor(()=>expect(screen.queryByRole('rowheader',{name:/매우 깊게/})).toBeNull());
  fireEvent.change(screen.getByLabelText('묶어 보기'),{target:{value:'hour'}});
  fireEvent.change(screen.getByLabelText('그래프 수치'),{target:{value:'tokens'}});
  await waitFor(()=>expect(screen.getByRole('img',{name:'기간별 총토큰 막대 그래프'}).querySelectorAll('rect').length).toBeGreaterThan(2));
  fireEvent.focus(screen.getByRole('button',{name:'주간 한도 추정 도움말'}));
  expect(screen.getByRole('tooltip').textContent).toContain('주간 소모율은 추정값입니다.');
  fireEvent.keyDown(screen.getByRole('button',{name:'주간 한도 추정 도움말'}),{key:'Escape'});
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('button',{name:'캐시 적중률 도움말'})).toBeTruthy();
  fireEvent.focus(screen.getByRole('button',{name:'캐시 적중률 도움말'}));
  expect(screen.getByRole('tooltip').textContent).toContain('입력 100토큰 중 60토큰');
 });
});
