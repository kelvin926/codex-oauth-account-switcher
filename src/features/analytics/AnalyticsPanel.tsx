import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord } from '../../core/types';
import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow } from '../../shared/features';
import { Help, Disclosure } from '../../shared/Help';
import { cacheHit, PRICING_DATE } from '../../core/analytics/pricing';
import { getDemoAnalytics } from '../../demo/analytics';

const number = (value:number)=>value.toLocaleString('ko-KR');
const percent = (value:number|null)=>value===null?'확인 불가':`${value.toFixed(3)}%p`;
function localInput(date:Date){const shifted=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return shifted.toISOString().slice(0,16);}
const money = (value:number|null) => value===null?'추정 준비 중':value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
const hit = (row:AnalyticsRow) => { const value=cacheHit(row.cost); return value===null?'미확인':`${value.toFixed(1)}%${row.cost.cacheUnknownEvents?' (일부)':''}`; };
const costText = (row:AnalyticsRow) => row.cost.pricedEvents?`${money(row.cost.usd)}${row.cost.unpricedEvents?' (일부)':''}`:row.count?'미확인':money(0);
function TokenTable({rows,first}:{rows:AnalyticsRow[];first:string}){
  return <div className="table-scroll"><table><thead><tr><th>{first}</th><th>총토큰</th><th>캐시 적중률</th><th>API 환산액</th><th>주간 소모 추정</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.key}><th>{r.key}</th><td>{number(r.total)}</td><td>{hit(r)}</td><td>{costText(r)}</td><td>{percent(r.weeklyEstimate)}</td></tr>)}
    {!rows.length&&<tr><td colSpan={5}>선택한 기간에 기록이 없습니다.</td></tr>}
  </tbody></table></div>;
}
export function AnalyticsPanel({accounts,demo}:{accounts:AccountRecord[];demo:boolean}){
  const [start,setStart]=useState(()=>localInput(new Date(Date.now()-7*86400_000)));
  const [end,setEnd]=useState(()=>localInput(new Date(Date.now()+60_000)));
  const [bucket,setBucket]=useState<AnalyticsQuery['bucket']>('day');
  const [accountId,setAccount]=useState(demo?(accounts[0]?.id??''):'');const [model,setModel]=useState('');const [effort,setEffort]=useState('');
  const [chartMetric,setChartMetric]=useState<'tokens'|'cost'>('tokens');
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
  const chartValue=(r:AnalyticsRow)=>chartMetric==='cost'?r.cost.usd:r.total;
  const max=Math.max(.001,...(result?.timeline.map(chartValue)??[]));
  const chartWidth=Math.max(800,(result?.timeline.length??0)*30);
  return <section className="feature-panel analytics-panel" aria-label="사용량 분석">
    <div className="panel-heading"><div><p className="eyebrow">로컬 Codex 사용 기록</p><h2>사용량 분석<Help label="집계 기준">이 PC의 로컬 기록만 포함합니다. 입력에는 캐시, 출력에는 추론 토큰이 포함됩니다. 다른 기기와 클라우드 작업은 누락될 수 있습니다. 계정 귀속은 앱 실행 중 관측한 로그인 기준입니다.</Help></h2></div><div className="toolbar">
      <button className="secondary-button" disabled={busy} onClick={async()=>{setBusy(true);try{if(!demo)await window.desktopApi.scanAnalytics();setRevision(x=>x+1);}catch(e){setError(String(e));}finally{setBusy(false);}}}>기록 가져오기</button>
      <button className="ghost-button" disabled={!query||busy||demo} onClick={async()=>{try{if(query)await window.desktopApi.exportAnalytics(query);}catch(e){setError(String(e));}}}>통계 CSV</button>
    </div></div>
    <div className="toolbar presets">{[[0,'오늘'],[7,'최근 7일'],[30,'최근 30일'],[90,'최근 90일']].map(([n,label])=><button key={label} className="ghost-button" onClick={()=>preset(Number(n))}>{label}</button>)}</div>
    <div className="analysis-filters">
      <label>집계 단위<select value={bucket} onChange={e=>setBucket(e.target.value as AnalyticsQuery['bucket'])}><option value="hour">시간별</option><option value="day">날짜별</option><option value="week">주별 (월요일 시작)</option><option value="month">월별</option></select></label>
      <label>계정<select value={accountId} onChange={e=>setAccount(e.target.value)}><option value="">전체 계정</option><option value="unknown">계정 미확인</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></label>
      <label>모델<select value={model} onChange={e=>setModel(e.target.value)}><option value="">전체 모델</option>{result?.models.map(m=><option key={m}>{m}</option>)}</select></label>
      <label>리즈닝<select value={effort} onChange={e=>setEffort(e.target.value)}><option value="">전체 옵션</option>{result?.efforts.map(m=><option key={m}>{m}</option>)}</select></label>
    </div>
    <Disclosure title="기간 직접 지정"><div className="analysis-filters">      <label>시작<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>종료 (미포함)<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
</div></Disclosure>
    <p className="compact-meta">PC 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone} / {busy?'조회 중':`${number(result?.eventCount??0)}개 기록`} / 마지막 수집: {result?.scannedAt?new Date(result.scannedAt).toLocaleString():'아직 수집 전'}</p>
    {error&&<p role="alert" className="error-copy">{error}</p>}
    {result&&<>
      {result.pendingFiles>0&&<p className="analysis-notice">{result.pendingFiles}개 파일을 추가로 읽고 있습니다. 자동 수집을 기다리거나 기록 가져오기를 다시 누르세요.</p>}
      {result.warnings.length>0&&<Disclosure title={`수집 안내 ${result.warnings.length}개`}>{result.warnings.map(w=><p className="error-copy" key={w}>{w}</p>)}</Disclosure>}
      <p className="compact-meta">로컬 기록 / API 환산 추정<Help label="비용 계산">{PRICING_DATE}에 확인한 API Standard 단가를 적용합니다. 실제 구독 청구액이 아닙니다. 캐시 읽기 할인과 기록된 캐시 쓰기 비용을 반영하며, 쓰기 기록이 없으면 0으로 가정합니다. Codex 크레딧 청구에는 캐시 쓰기 가산이 없습니다. Fast 모드, 도구, 지역 가산은 제외합니다. GPT-6은 272K 초과 할증을 반영합니다. 미가격 모델과 확인하지 못한 GPT-5.6 장문맥 단가는 제외합니다.</Help>
        {result.total.cost.unpricedEvents>0&&<span>가격 확인 {result.total.cost.pricedEvents}/{result.eventCount}건</span>}
      </p>
      <div className="stat-grid analytics-stats">
        <div><span>API 환산액 (추정)</span><strong>{costText(result.total)}</strong></div>
        <div><span>총토큰</span><strong title={number(result.total.total)}>{result.total.total.toLocaleString('ko-KR',{notation:'compact',maximumFractionDigits:1})}</strong></div>
        <div><span>캐시 적중률<Help label="캐시 적중률">캐시 읽기 토큰 합계 / 입력 토큰 합계입니다. 기록에 캐시 수치가 없는 요청은 비율에서 제외합니다. 요청 횟수 기준이 아닙니다.</Help></span><strong>{hit(result.total)}</strong></div>
        <div><span>캐시 순절감 (추정)<Help label="캐시 절감액">캐시가 없을 때의 입력 비용에서 실제 캐시 읽기와 쓰기 환산 비용을 뺀 값입니다. 캐시 쓰기가 많으면 음수가 될 수 있습니다. 단가를 확인한 기록만 계산합니다.</Help></span><strong>{result.total.cost.pricedEvents?money(result.total.cost.cacheSavingsUsd):'미확인'}</strong></div>
      </div>
      <div className="budget-heading"><h3>주간 한도 금액 추정</h3><Help label="주간 한도 추정">주간 소모율은 추정값입니다. 같은 계정과 초기화 주기의 15분 이내 연속 관측 구간에서 API 환산액 / 사용률 증가 × 100으로 계산합니다. 최소 1%p 관측이 필요하며 모델 필터와 독립적인 계정 전체 기준입니다. 다른 기기 사용과 누락 기록에 따라 오차가 납니다. 월 구독료나 공식 보장 한도 금액이 아닙니다.</Help></div>
      <div className="budget-strip"><div><span>한도 100% 환산</span><strong>{money(result.weeklyBudget.limitUsd)}</strong></div><div><span>한도 중 사용 {result.weeklyBudget.usedPercent===null?'':`(${result.weeklyBudget.usedPercent.toFixed(1)}%)`}</span><strong>{money(result.weeklyBudget.usedUsd)}</strong></div><div><span>남은 금액 환산</span><strong>{money(result.weeklyBudget.remainingUsd)}</strong></div></div>
      <p className="compact-meta">{!accountId||accountId==='unknown'?'계정을 선택하면 주간 한도 금액을 추정합니다.':`관측 ${result.weeklyBudget.observedPercent.toFixed(2)}%p / ${result.weeklyBudget.intervals}개 구간`}{result.weeklyBudget.at&&` / 기준 ${new Date(result.weeklyBudget.at).toLocaleString()}`}</p>
      <div className="panel-heading"><h3>기간별 사용량</h3><label>그래프<select aria-label="그래프 수치" value={chartMetric} onChange={e=>setChartMetric(e.target.value as 'tokens'|'cost')}><option value="tokens">토큰</option><option value="cost">API 환산액 (추정)</option></select></label></div>

      <div className="chart-scroll"><svg viewBox={`0 0 ${chartWidth} 210`} width={chartWidth} height="210" role="img" aria-label={chartMetric==='tokens'?'기간별 총토큰 막대 그래프':'기간별 API 환산액 막대 그래프'}>
        <line x1="0" y1="175" x2={chartWidth} y2="175" stroke="#cabfac"/>
        {result.timeline.map((r,i)=>{const width=chartWidth/Math.max(1,result.timeline.length);const height=chartValue(r)/max*145;return <g key={r.key}><title>{r.key}: {number(r.total)} 토큰 / {costText(r)} / 캐시 {hit(r)}</title><rect x={i*width+4} y={175-height} width={Math.max(3,width-8)} height={Math.max(1,height)} rx="3" fill="#42643c"/>{(result.timeline.length<=24||i%Math.ceil(result.timeline.length/24)===0)&&<text x={i*width+width/2} y="196" textAnchor="middle" fontSize="13" fill="#66584c">{r.key.slice(5)}</text>}</g>;})}
        {!result.timeline.length&&<text x="30" y="80" fill="#66584c">아직 표시할 기록이 없습니다.</text>}
      </svg></div>
      <h3>모델과 리즈닝별 상세<Help label="모델별 수치">주간 소모율은 관측된 사용률 증가를 로컬 총토큰 비율로 나눈 추정치입니다. 계정 하나를 선택해야 표시되며 관측하지 못한 구간은 제외됩니다. 상세 토큰과 캐시 쓰기는 CSV와 개별 기록에서 확인하세요.</Help></h3><TokenTable rows={result.dimensions} first="모델 / 리즈닝"/>
      <Disclosure title="기간별 수치 보기"><TokenTable rows={result.timeline} first="기간"/></Disclosure>
      <Disclosure title="주간 한도와 크레딧 관측 이력">
      <p className="muted">서버가 반환한 계정 전체 수치입니다. 최근 500개 관측을 표시하며, 아래 토큰 기록과 별도입니다.</p>
      <div className="table-scroll"><table><thead><tr><th>관측 시각</th><th>계정</th><th>주간 사용률</th><th>남은 크레딧</th><th>주간 초기화</th></tr></thead><tbody>{[...result.observations].reverse().map(o=><tr key={o.accountId+o.at}><td>{new Date(o.at).toLocaleString()}</td><td>{accounts.find(a=>a.id===o.accountId)?.label??o.accountId.slice(0,8)}</td><td>{o.weeklyUsed===null?'확인 불가':`${o.weeklyUsed.toFixed(2)}%`}</td><td>{o.credits===null?'확인 불가':number(o.credits)}</td><td>{o.resetAt?new Date(o.resetAt).toLocaleString():'확인 불가'}</td></tr>)}</tbody></table></div>
      </Disclosure>
      <Disclosure title={`개별 토큰 기록 (${number(result.eventCount)}개)`}>
        <div className="table-scroll"><table><thead><tr><th>시각</th><th>모델</th><th>리즈닝</th><th>계정 (추정)</th><th>입력</th><th>캐시</th><th>캐시 쓰기</th><th>출력</th><th>추론</th><th>총토큰</th></tr></thead><tbody>{result.events.map(e=><tr key={e.id} title={`세션 ${e.session}`}><td>{new Date(e.at).toLocaleString()}</td><td>{e.model}</td><td>{e.effort}</td><td>{e.accountId?(accounts.find(a=>a.id===e.accountId)?.label??e.accountId.slice(0,8)):'미확인'}</td><td>{number(e.input)}</td><td>{number(e.cached)}</td><td>{number(e.cacheWrite)}</td><td>{number(e.output)}</td><td>{number(e.reasoning)}</td><td>{number(e.total)}</td></tr>)}</tbody></table></div>
        <div className="toolbar"><button disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(result.eventCount/100))}</span><button disabled={(page+1)*100>=result.eventCount||busy} onClick={()=>setPage(p=>p+1)}>다음</button></div>
      </Disclosure>
    </>}
  </section>;
}
