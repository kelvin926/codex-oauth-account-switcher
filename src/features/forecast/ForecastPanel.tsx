import { useEffect, useState } from 'react';
import { FORECAST_HOME, type ForecastPost, type ForecastProbability, type ForecastState } from '../../shared/forecast';
import { Help, Disclosure } from '../../shared/Help';
import { getDemoForecast } from '../../demo/forecast';

const percent = (value: number | null) => value === null ? '확인 불가' : `${Math.round(value * 100)}%`;
const count = (value: number | null, suffix = '') => value === null ? '확인 불가' : `${value.toLocaleString('ko-KR')}${suffix}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '확인 불가';
function Probability({ label, value }: { label: string; value: ForecastProbability }) {
  return <div className="forecast-probability"><span>{label}</span><strong>{percent(value.probability)}</strong>
    <progress aria-label={label} value={(value.probability ?? 0) * 100} max="100" />
    <small>추정 범위 {percent(value.low)} ~ {percent(value.high)}</small>
  </div>;
}
function Post({ post, demo, open }: { post: ForecastPost; demo: boolean; open: (url: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const label = { incoming: '초기화 예고', reset: '초기화 관련 공지', hint: '초기화 힌트', watch: '관련 소식' }[post.kind];
  return <article>
    <div className="panel-heading"><span className="forecast-badge">{label}</span><time dateTime={post.at}>{date(post.at)}</time></div>
    <p className={!expanded && post.text.length > 180 ? 'forecast-excerpt' : ''}>{post.text}</p>
    <div className="toolbar">
      {post.text.length > 180 && <button className="ghost-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '더 보기'}</button>}
      <button className="ghost-button" disabled={demo} onClick={() => void open(post.url)}>X 원문 열기</button>
      {post.why && <Help label="소식 분류">Lunarwerx의 분류 근거: {post.why}. 게시물의 예고는 초기화 완료를 뜻하지 않습니다.</Help>}
    </div>
  </article>;
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
    const resume = () => { setNow(Date.now()); load(true); };
    load(true); const timer = setInterval(resume, 30000);
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
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
    <p className="compact-meta">비공식 예상 / 5분 간격 갱신{data && <> / 예측 갱신 {date(data.generatedAt)}</>}</p>
    {message && <p role="alert" className="error-copy">{message}</p>}
    {!state && <p role="status">Lunarwerx 소식을 불러오는 중입니다.</p>}
    {state && !state.enabled && <p className="analysis-notice">소식 갱신이 꺼져 있습니다. 설정과 진단에서 다시 켤 수 있습니다.</p>}
    {state?.error && <p role="alert" className="error-copy">{state.error}</p>}
    {state?.stale && data && <p className="error-copy">오래된 저장 기록입니다. 현재 예상치로 해석하지 마세요.</p>}
    {state && !data && <p>아직 불러온 소식이 없습니다. 연결 상태와 다음 갱신 시각을 확인하세요.</p>}
    {data && <>
      <p className="forecast-headline">{data.headline}</p>
      <div className="forecast-hero"><Probability label="24시간 내 초기화 예상" value={data.next24Hours}/><Probability label={`${data.nearTerm.hours ?? '?'}시간 내 초기화 예상`} value={data.nearTerm}/>
        <div className="forecast-latest"><span>마지막 초기화 기록</span><strong>{date(data.lastResetAt)}</strong><small>초기화권 지급 포함</small></div>
      </div>

      <div className="stat-grid forecast-stats">{[['최근 7일',count(data.resetsLast7Days,'회')],['최근 30일',count(data.resetsLast30Days,'회')],['평균 대기 (30일)',count(data.pace30Days,'일')],['중앙 간격 (120일)',count(data.recentMedianDays,'일')],['전체 추적 기록',count(data.totalResets,'회')],['초기화권 지급 기록',count(data.bankedCount,'회')]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <section className="forecast-news" aria-label="최신 Tibo 소식">
        <div className="panel-heading"><h3>최신 Tibo 소식<Help label="최신 소식">Lunarwerx 사이트 피드의 게시물입니다. 초기화 예고, 관련 공지와 실제 초기화 기록은 구분해서 표시합니다. 시각은 게시물 작성 시각입니다. 알림은 앱이 실행 중일 때 제공됩니다.</Help></h3><span className="muted">@thsottiaux</span></div>
        {data.timelineLive !== true && <p className="analysis-notice">{data.timelineLive === false ? 'Tibo 피드 갱신이 지연돼 저장된 게시물을 표시합니다.' : '최신 Tibo 피드를 불러오지 못했습니다. 초기화 기록과 원본 사이트를 확인하세요.'}</p>}
        <div className="forecast-feed">{data.posts.slice(0, 2).map(post => <Post key={post.url} post={post} demo={demo} open={open}/>)}</div>
        {data.posts.length > 2 && <Disclosure title={`이전 Tibo 소식 ${data.posts.length - 2}개`}><div className="forecast-feed">{data.posts.slice(2).map(post => <Post key={post.url} post={post} demo={demo} open={open}/>)}</div></Disclosure>}
        {!data.posts.length && data.timelineLive === true && <p className="muted">최근 초기화 관련 게시물이 없습니다.</p>}
      </section>
      <Disclosure title="초기화 기록과 Tibo 공지">
      <div className="panel-heading"><h3>초기화 기록과 Tibo 공지<Help label="공지 출처">Lunarwerx에 연결된 초기화 공지입니다. 표시 시각은 초기화 기록 시각이며 게시물 작성 시각과 다를 수 있습니다. 알림은 앱이 실행 중일 때 제공되며 설정에서 변경할 수 있습니다.</Help></h3><label className="forecast-toggle"><input type="checkbox" checked={tiboOnly} onChange={e=>setTiboOnly(e.target.checked)}/> Tibo 공지만</label></div>

      <div className="forecast-feed">{rows.map(row => <article key={row.at}>
        <div className="panel-heading"><b>{date(row.at)}</b><span className="muted">직전 기록과 {count(row.gapDays,'일')} 간격</span></div>
        <span className="forecast-badge">{row.announcement?.tibo ? 'Tibo @thsottiaux' : row.announcement ? '출처 공지' : '연결된 공지 없음'}</span>
        <p>{row.announcement?.text ?? '출처에 기록된 초기화입니다. 연결된 원문 내용은 제공되지 않았습니다.'}</p>
        {row.announcement?.url && <button className="ghost-button" disabled={demo} onClick={() => void open(row.announcement!.url!)}>원문 열기</button>}
      </article>)}</div>
      {!rows.length && <p>표시할 공지가 없습니다.</p>}
      {data.hasMore && <p className="muted">최근 100개 기록입니다. 이전 기록은 출처 사이트에서 볼 수 있습니다.</p>}
      </Disclosure>
      <Disclosure title="출처와 예측 검증">
        <p className="muted">자료 생성: {date(data.generatedAt)} / 수신: {date(state?.fetchedAt ?? null)}<br/>연동: {data.source === 'website' ? '원본 사이트 피드' : '공개 API 대체 조회'} / 초기화 기록: {data.sources.record} / Tibo 타임라인: {data.sources.timeline} / OpenAI 상태: {data.sources.openaiStatus}</p>
        <p className="muted">평균 대기는 원본 사이트와 같은 최근 30일 기준입니다 (30일 ÷ 초기화 횟수). 최근 120일의 완료된 간격 평균은 {count(data.recentMeanDays,'일')}입니다. 화면 확률은 사이트처럼 정수로 반올림합니다.</p>
        <p className="muted">저장된 24시간 예측 평가 {count(data.accuracy.windows)}개 / {data.accuracy.status === 'collecting' ? '평가 자료 수집 중' : data.accuracy.status === 'available' ? '평가 자료 있음' : '평가 자료 없음'}<br/>Brier 오차 {data.accuracy.brier ?? '확인 불가'} / 단순 기준선 {data.accuracy.baselineBrier ?? '확인 불가'} (낮을수록 좋음). 과거 평가가 미래 정확도를 보장하지는 않습니다.</p>
      </Disclosure>
    </>}
  </section>;
}
