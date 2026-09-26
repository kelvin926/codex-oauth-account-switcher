import { useEffect, useState } from 'react';
import { FORECAST_HOME, type ForecastProbability, type ForecastState } from '../../shared/forecast';
import { Help, Disclosure } from '../../shared/Help';
import { getDemoForecast } from '../../demo/forecast';

const percent = (value: number | null) => value === null ? '확인 불가' : `${(value * 100).toFixed(1)}%`;
const count = (value: number | null, suffix = '') => value === null ? '확인 불가' : `${value.toLocaleString('ko-KR')}${suffix}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : '확인 불가';
function Probability({ label, value }: { label: string; value: ForecastProbability }) {
  return <div className="forecast-probability"><span>{label}</span><strong>{percent(value.probability)}</strong>
    <progress aria-label={label} value={(value.probability ?? 0) * 100} max="100" />
    <small>추정 범위 {percent(value.low)} ~ {percent(value.high)}</small>
  </div>;
}
export function ForecastPanel({ demo }: { demo: boolean }) {
  const [state, setState] = useState<ForecastState | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [tiboOnly, setTiboOnly] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true, pending = false;
    const load = (refresh: boolean) => {
      if (pending || document.hidden) return; pending = true;
      void (demo ? Promise.resolve(getDemoForecast()) : window.desktopApi.getForecast(refresh))
        .then(value => { if (active) { setState(value); setMessage(''); } })
        .catch(() => { if (active) setMessage('소식을 불러오지 못했습니다. 잠시 후 다시 확인하세요.'); })
        .finally(() => { pending = false; });
    };
    load(true); const timer = setInterval(() => { setNow(Date.now()); load(false); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [demo]);
  async function open(url: string) {
    if (demo) return;
    try { await window.desktopApi.openForecastSource(url); } catch { setMessage('원문 링크를 열지 못했습니다.'); }
  }
  async function refresh() {
    setBusy(true);
    try { setState(demo ? getDemoForecast() : await window.desktopApi.getForecast(true)); setNow(Date.now()); }
    catch { setMessage('소식 갱신에 실패했습니다.'); } finally { setBusy(false); }
  }
  const data = state?.data;
  const remaining = Math.max(0, Math.ceil(((state?.nextRefreshAt ? Date.parse(state.nextRefreshAt) : 0) - now) / 1000));
  const rows = data?.resets.filter(row => !tiboOnly || row.announcement?.tibo) ?? [];
  return <section className="feature-panel forecast-panel" aria-label="초기화 소식">
    <div className="panel-heading"><div><p className="eyebrow">Lunarwerx Codex Forecast</p><h2>초기화 예상과 소식<Help label="초기화 예상">Lunarwerx의 비공식 통계적 예상입니다. OpenAI의 확정 일정이나 내 계정의 정기 초기화 시간이 아닙니다. 초기화권 지급 기록도 포함됩니다.</Help></h2></div><div className="toolbar">
      <button className="secondary-button" disabled={busy || state?.refreshing || !state?.enabled || remaining > 0} onClick={() => void refresh()}>{remaining > 0 ? `${remaining}초 후 갱신 가능` : '소식 갱신'}</button>
      <button className="ghost-button" disabled={demo} onClick={() => void open(FORECAST_HOME)}>출처 사이트</button>
      <button className="ghost-button" disabled={demo} onClick={() => void open('https://x.com/thsottiaux')}>Tibo의 X</button>
    </div></div>
    <p className="compact-meta">비공식 예상 / 5분 간격 갱신</p>
    {message && <p role="alert" className="error-copy">{message}</p>}
    {!state && <p role="status">Lunarwerx 소식을 불러오는 중입니다.</p>}
    {state && !state.enabled && <p className="analysis-notice">소식 갱신이 꺼져 있습니다. 설정과 진단에서 다시 켤 수 있습니다.</p>}
    {state?.error && <p role="alert" className="error-copy">{state.error}</p>}
    {state?.stale && data && <p className="error-copy">오래된 저장 기록입니다. 현재 예상치로 해석하지 마세요.</p>}
    {state && !data && <p>아직 불러온 소식이 없습니다. 연결 상태와 다음 갱신 시각을 확인하세요.</p>}
    {data && <>
      <p className="forecast-headline">{data.headline}</p>
      <div className="forecast-hero"><Probability label="24시간 내 초기화 예상" value={data.next24Hours}/><Probability label={`${data.nearTerm.hours ?? '?'}시간 내 초기화 예상`} value={data.nearTerm}/>
        <div className="forecast-latest"><span>마지막 기록</span><strong>{date(data.lastResetAt)}</strong><small>출처: Lunarwerx 공개 초기화 기록</small></div>
      </div>

      <div className="stat-grid forecast-stats">{[['최근 7일',count(data.resetsLast7Days,'회')],['최근 30일',count(data.resetsLast30Days,'회')],['최근 평균 간격',count(data.recentMeanDays,'일')],['최근 중앙 간격',count(data.recentMedianDays,'일')],['전체 추적 기록',count(data.totalResets,'회')],['초기화권 지급 기록',count(data.bankedCount,'회')]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <Disclosure title="출처와 예측 검증">      <p className="muted">자료 생성: {date(data.generatedAt)} / 수신: {date(state?.fetchedAt ?? null)} / 5분 간격 갱신<br/>초기화 기록: {data.sources.record} / Tibo 타임라인: {data.sources.timeline} / OpenAI 상태: {data.sources.openaiStatus}</p><p className="muted">저장된 24시간 예측 평가 {count(data.accuracy.windows)}개 / {data.accuracy.status === 'collecting' ? '평가 자료 수집 중' : data.accuracy.status === 'available' ? '평가 자료 있음' : '평가 자료 없음'}<br/>Brier 오차 {data.accuracy.brier ?? '확인 불가'} / 단순 기준선 {data.accuracy.baselineBrier ?? '확인 불가'} (낮을수록 좋음). 과거 평가가 미래 정확도를 보장하지는 않습니다.</p></Disclosure>
      <div className="panel-heading"><h3>초기화 기록과 Tibo 공지<Help label="공지 출처">Lunarwerx에 연결된 초기화 공지입니다. 표시 시각은 초기화 기록 시각이며 게시물 작성 시각과 다를 수 있습니다. 알림은 앱이 실행 중일 때 제공되며 설정에서 변경할 수 있습니다.</Help></h3><label className="forecast-toggle"><input type="checkbox" checked={tiboOnly} onChange={e=>setTiboOnly(e.target.checked)}/> Tibo 공지만</label></div>

      <div className="forecast-feed">{rows.map(row => <article key={row.at}>
        <div className="panel-heading"><b>{date(row.at)}</b><span className="muted">직전 기록과 {count(row.gapDays,'일')} 간격</span></div>
        <span className="forecast-badge">{row.announcement?.tibo ? 'Tibo @thsottiaux' : row.announcement ? '출처 공지' : '연결된 공지 없음'}</span>
        <p>{row.announcement?.text ?? '출처에 기록된 초기화입니다. 연결된 원문 내용은 제공되지 않았습니다.'}</p>
        {row.announcement?.url && <button className="ghost-button" disabled={demo} onClick={() => void open(row.announcement!.url!)}>원문 열기</button>}
      </article>)}</div>
      {!rows.length && <p>표시할 공지가 없습니다.</p>}
      {data.hasMore && <p className="muted">최근 100개 기록입니다. 이전 기록은 출처 사이트에서 볼 수 있습니다.</p>}

    </>}
  </section>;
}
