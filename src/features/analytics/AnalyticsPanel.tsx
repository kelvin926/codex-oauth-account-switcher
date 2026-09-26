import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord } from '../../core/types';
import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow } from '../../shared/features';
import { getDemoAnalytics } from '../../demo/analytics';

const number = (value:number)=>value.toLocaleString('ko-KR');
const percent = (value:number|null)=>value===null?'확인 불가':`${value.toFixed(3)}%p`;
function localInput(date:Date){const shifted=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return shifted.toISOString().slice(0,16);}
function TokenTable({rows,first}:{rows:AnalyticsRow[];first:string}){
  return <div className="table-scroll"><table><thead><tr><th>{first}</th><th>입력</th><th>캐시 입력</th><th>캐시 쓰기</th><th>출력</th><th>추론</th><th>총토큰</th><th>주간 소모 추정</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.key}><th>{r.key}</th><td>{number(r.input)}</td><td>{number(r.cached)}</td><td>{number(r.cacheWrite)}</td><td>{number(r.output)}</td><td>{number(r.reasoning)}</td><td><b>{number(r.total)}</b></td><td>{percent(r.weeklyEstimate)}</td></tr>)}
    {!rows.length&&<tr><td colSpan={8}>선택한 기간에 기록이 없습니다.</td></tr>}
  </tbody></table></div>;
}
export function AnalyticsPanel({accounts,demo}:{accounts:AccountRecord[];demo:boolean}){
  const [start,setStart]=useState(()=>localInput(new Date(Date.now()-7*86400_000)));
  const [end,setEnd]=useState(()=>localInput(new Date(Date.now()+60_000)));
  const [bucket,setBucket]=useState<AnalyticsQuery['bucket']>('day');
  const [accountId,setAccount]=useState('');const [model,setModel]=useState('');const [effort,setEffort]=useState('');
  const [page,setPage]=useState(0);const [result,setResult]=useState<AnalyticsResult|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
  const query=useMemo<AnalyticsQuery|null>(()=>{
    const a=new Date(start),b=new Date(end);if(!Number.isFinite(+a)||!Number.isFinite(+b)||+b<=+a)return null;
    return {start:a.toISOString(),end:b.toISOString(),bucket,accountId,model,effort,page};
  },[start,end,bucket,accountId,model,effort,page]);
  useEffect(()=>{setPage(0);},[start,end,bucket,accountId,model,effort]);
  useEffect(()=>{
    if(!query){setError('종료 시각을 시작 시각 이후로 설정하세요.');return;}
    let current=true;setBusy(true);setError('');
    const promise=demo?Promise.resolve(getDemoAnalytics(query)):window.desktopApi.getAnalytics(query);
    void promise.then(r=>{if(current)setResult(r);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setBusy(false);});
    return()=>{current=false;};
  },[query,demo,revision]);
  const preset=(days:number)=>{const now=new Date();const from=new Date();if(days===0)from.setHours(0,0,0,0);else from.setDate(from.getDate()-days);setStart(localInput(from));setEnd(localInput(new Date(+now+60_000)));};
  const max=Math.max(1,...(result?.timeline.map(r=>r.total)??[]));
  const chartWidth=Math.max(800,(result?.timeline.length??0)*30);
  return <section className="feature-panel analytics-panel" aria-label="사용량 분석">
    <div className="panel-heading"><div><p className="eyebrow">로컬 Codex 사용 기록</p><h2>사용량 분석</h2></div><div className="toolbar">
      <button className="secondary-button" disabled={busy} onClick={async()=>{setBusy(true);try{if(!demo)await window.desktopApi.scanAnalytics();setRevision(x=>x+1);}catch(e){setError(String(e));}finally{setBusy(false);}}}>기록 가져오기</button>
      <button className="ghost-button" disabled={!query||busy||demo} onClick={async()=>{try{if(query)await window.desktopApi.exportAnalytics(query);}catch(e){setError(String(e));}}}>통계 CSV</button>
    </div></div>
    <p className="analysis-notice">이 PC의 세션에 기록된 토큰만 집계합니다. 입력에는 캐시 입력이, 출력에는 추론 토큰이 포함됩니다. 모델과 리즈닝은 기록된 설정입니다. 다른 기기와 클라우드 작업은 누락될 수 있습니다.</p>
    <div className="toolbar presets">{[[0,'오늘'],[7,'최근 7일'],[30,'최근 30일'],[90,'최근 90일']].map(([n,label])=><button key={label} className="ghost-button" onClick={()=>preset(Number(n))}>{label}</button>)}</div>
    <div className="analysis-filters">
      <label>시작<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>종료 (미포함)<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
      <label>집계 단위<select value={bucket} onChange={e=>setBucket(e.target.value as AnalyticsQuery['bucket'])}><option value="hour">시간별</option><option value="day">날짜별</option><option value="week">주별 (월요일 시작)</option><option value="month">월별</option></select></label>
      <label>계정<select value={accountId} onChange={e=>setAccount(e.target.value)}><option value="">전체 계정</option><option value="unknown">계정 미확인</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></label>
      <label>모델<select value={model} onChange={e=>setModel(e.target.value)}><option value="">전체 모델</option>{result?.models.map(m=><option key={m}>{m}</option>)}</select></label>
      <label>리즈닝<select value={effort} onChange={e=>setEffort(e.target.value)}><option value="">전체 옵션</option>{result?.efforts.map(m=><option key={m}>{m}</option>)}</select></label>
    </div>
    <p className="muted">PC 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone} / {busy?'조회 중':`${number(result?.eventCount??0)}개 기록`} / 마지막 수집: {result?.scannedAt?new Date(result.scannedAt).toLocaleString():'아직 수집 전'}</p>
    {error&&<p role="alert" className="error-copy">{error}</p>}
    {result&&<>
      {result.pendingFiles>0&&<p className="analysis-notice">{result.pendingFiles}개 파일을 추가로 읽고 있습니다. 자동 수집을 기다리거나 기록 가져오기를 다시 누르세요.</p>}
      {result.warnings.map(w=><p className="error-copy" key={w}>{w}</p>)}
      <div className="stat-grid">{[['총토큰',number(result.total.total)],['입력',number(result.total.input)],['캐시 입력',number(result.total.cached)],['출력',number(result.total.output)],['추론',number(result.total.reasoning)],['주간 소모 추정',percent(result.total.weeklyEstimate)]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="analysis-notice"><b>주간 소모율은 추정값입니다.</b> 계정 하나를 선택하면 같은 초기화 주기의 15분 이내 관측 구간에서 증가한 한도 사용률을 로컬 총토큰 비율로 배분합니다. 모델별 공식 소모율이 아니며 다른 기기 사용도 포함될 수 있습니다. 값이 없는 구간은 0으로 처리하지 않습니다. 여러 주가 포함되면 합계가 100%p를 넘을 수 있습니다.</p>
      <p className="muted">계정 미확인 기록 {number(result.unknownEvents)}개. 계정 귀속은 앱이 실행 중 관측한 로그인 구간에 기반한 추정입니다. 설치 이전 기록을 현재 계정으로 배정하지 않습니다.</p>
      <h3>시간에 따른 총토큰</h3>
      <div className="chart-scroll"><svg viewBox={`0 0 ${chartWidth} 210`} width={chartWidth} height="210" role="img" aria-label="기간별 총토큰 막대 그래프">
        <line x1="0" y1="175" x2={chartWidth} y2="175" stroke="#cabfac"/>
        {result.timeline.map((r,i)=>{const width=chartWidth/Math.max(1,result.timeline.length);const height=r.total/max*145;return <g key={r.key}><title>{r.key}: {number(r.total)} 토큰 / 주간 소모 추정 {percent(r.weeklyEstimate)}</title><rect x={i*width+4} y={175-height} width={Math.max(3,width-8)} height={Math.max(1,height)} rx="3" fill="#42643c"/>{(result.timeline.length<=24||i%Math.ceil(result.timeline.length/24)===0)&&<text x={i*width+width/2} y="196" textAnchor="middle" fontSize="10" fill="#66584c">{r.key.slice(5)}</text>}</g>;})}
        {!result.timeline.length&&<text x="30" y="80" fill="#66584c">아직 표시할 기록이 없습니다.</text>}
      </svg></div>
      <h3>모델과 리즈닝별 상세</h3><TokenTable rows={result.dimensions} first="모델 / 리즈닝"/>
      <details><summary>기간별 수치 보기</summary><TokenTable rows={result.timeline} first="기간"/></details>
      <h3>주간 한도와 크레딧 관측 이력</h3>
      <p className="muted">서버가 반환한 계정 전체 수치입니다. 최근 500개 관측을 표시하며, 아래 토큰 기록과 별도입니다.</p>
      <div className="table-scroll"><table><thead><tr><th>관측 시각</th><th>계정</th><th>주간 사용률</th><th>남은 크레딧</th><th>주간 초기화</th></tr></thead><tbody>{[...result.observations].reverse().map(o=><tr key={o.accountId+o.at}><td>{new Date(o.at).toLocaleString()}</td><td>{accounts.find(a=>a.id===o.accountId)?.label??o.accountId.slice(0,8)}</td><td>{o.weeklyUsed===null?'확인 불가':`${o.weeklyUsed.toFixed(2)}%`}</td><td>{o.credits===null?'확인 불가':number(o.credits)}</td><td>{o.resetAt?new Date(o.resetAt).toLocaleString():'확인 불가'}</td></tr>)}</tbody></table></div>
      <details><summary>개별 토큰 기록 ({number(result.eventCount)}개)</summary>
        <div className="table-scroll"><table><thead><tr><th>시각</th><th>모델</th><th>리즈닝</th><th>계정 (추정)</th><th>입력</th><th>캐시</th><th>출력</th><th>추론</th><th>총토큰</th></tr></thead><tbody>{result.events.map(e=><tr key={e.id} title={`세션 ${e.session}`}><td>{new Date(e.at).toLocaleString()}</td><td>{e.model}</td><td>{e.effort}</td><td>{e.accountId?(accounts.find(a=>a.id===e.accountId)?.label??e.accountId.slice(0,8)):'미확인'}</td><td>{number(e.input)}</td><td>{number(e.cached)}</td><td>{number(e.output)}</td><td>{number(e.reasoning)}</td><td>{number(e.total)}</td></tr>)}</tbody></table></div>
        <div className="toolbar"><button disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(result.eventCount/100))}</span><button disabled={(page+1)*100>=result.eventCount||busy} onClick={()=>setPage(p=>p+1)}>다음</button></div>
      </details>
    </>}
  </section>;
}
