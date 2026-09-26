import { useEffect, useMemo, useState } from 'react';
import type { AccountRecord } from '../../core/types';
import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow } from '../../shared/features';
import { Help, Disclosure } from '../../shared/Help';
import { cacheHit, PRICING_DATE } from '../../core/analytics/pricing';
import { getDemoAnalytics } from '../../demo/analytics';

const number = (value:number)=>value.toLocaleString('ko-KR');
const percent = (value:number|null)=>value===null?'자료 부족':`${value.toFixed(3)}%p`;
const money = (value:number|null) => value===null?'자료 수집 중':value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:Math.abs(value)>0&&Math.abs(value)<.01?4:2});
const hit = (row:AnalyticsRow) => { const value=cacheHit(row.cost); return value===null?'자료 없음':`${value.toFixed(1)}%`; };
const costText = (row:AnalyticsRow) => row.cost.pricedEvents?money(row.cost.usd):row.count?'단가 미확인':money(0);
const effortNames:Record<string,string> = {none:'사용 안 함',minimal:'최소',low:'가볍게',medium:'보통',high:'깊게',xhigh:'매우 깊게',unknown:'정보 없음'};
const effortText = (value:string) => effortNames[value]?`${effortNames[value]} (${value})`:value;
function localInput(date:Date){const shifted=new Date(date.getTime()-date.getTimezoneOffset()*60_000);return shifted.toISOString().slice(0,16);}
function ModelLabel({value}:{value:string}){
  const index=value.lastIndexOf(' / ');
  return index<0?<>{value}</>:<><b>{value.slice(0,index)}</b><small className="model-effort">{effortText(value.slice(index+3))}</small></>;
}
function TokenTable({rows,first,models=false}:{rows:AnalyticsRow[];first:string;models?:boolean}){
  return <div className="table-scroll"><table><thead><tr><th>{first}</th><th>환산 금액</th><th>사용한 주간 한도</th><th>처리량 (토큰)</th><th>캐시 적중률</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.key}><th scope="row">{models?<ModelLabel value={r.key}/>:r.key}</th><td>{costText(r)}{r.cost.unpricedEvents>0&&<small className="cell-note">일부 기록 제외</small>}</td><td>{percent(r.weeklyEstimate)}</td><td>{number(r.total)}</td><td>{hit(r)}{r.cost.cacheUnknownEvents>0&&<small className="cell-note">확인된 기록만</small>}</td></tr>)}
    {!rows.length&&<tr><td colSpan={5}>선택한 기간에 기록이 없습니다.</td></tr>}
  </tbody></table></div>;
}
export function AnalyticsPanel({accounts,demo}:{accounts:AccountRecord[];demo:boolean}){
  const [start,setStart]=useState(()=>localInput(new Date(Date.now()-7*86400_000)));
  const [end,setEnd]=useState(()=>localInput(new Date(Date.now()+60_000)));
  const [bucket,setBucket]=useState<AnalyticsQuery['bucket']>('day');
  const [accountId,setAccount]=useState(demo||accounts.length===1?(accounts[0]?.id??''):'');
  const [model,setModel]=useState('');const [effort,setEffort]=useState('');
  const [chartMetric,setChartMetric]=useState<'tokens'|'cost'>('cost');
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
  const max=Math.max(1,...(result?.timeline.map(chartValue)??[]));
  const chartWidth=Math.max(800,(result?.timeline.length??0)*38+64);
  const selectedAccount=accounts.find(a=>a.id===accountId);
  const budget=result?.weeklyBudget;
  const hasAccount=!!accountId&&accountId!=='unknown';
  const cacheIncrease=(result?.total.cost.cacheSavingsUsd??0)<0;
  return <section className="feature-panel analytics-panel" aria-label="사용량 분석" aria-busy={busy}>
    <div className="panel-heading"><div><p className="eyebrow">내 Codex 사용 기록</p><h2>사용량 분석<Help label="집계 기준">이 PC에 남은 기록을 모아 보여줍니다. 다른 기기나 클라우드에서 사용한 양은 빠질 수 있습니다. 계정은 앱 실행 중 확인한 로그인으로 구분합니다.</Help></h2></div><div className="toolbar">
      <button className="secondary-button" disabled={busy} onClick={async()=>{setBusy(true);try{if(!demo)await window.desktopApi.scanAnalytics();setRevision(x=>x+1);}catch(e){setError(String(e));}finally{setBusy(false);}}}>기록 가져오기</button>
      <button className="ghost-button" disabled={!query||busy||demo} onClick={async()=>{try{if(query)await window.desktopApi.exportAnalytics(query);}catch(e){setError(String(e));}}}>CSV로 저장</button>
    </div></div>
    <div className="toolbar presets">{[[0,'오늘'],[7,'최근 7일'],[30,'최근 30일'],[90,'최근 90일']].map(([n,label])=><button key={label} className="ghost-button" onClick={()=>preset(Number(n))}>{label}</button>)}</div>
    <div className="analysis-filters">
      <label>계정<select value={accountId} onChange={e=>setAccount(e.target.value)}><option value="">전체 계정</option><option value="unknown">계정 미확인</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></label>
      <label>묶어 보기<select value={bucket} onChange={e=>setBucket(e.target.value as AnalyticsQuery['bucket'])}><option value="hour">시간별</option><option value="day">날짜별</option><option value="week">주별 (월요일 시작)</option><option value="month">월별</option></select></label>
      <label>모델<select value={model} onChange={e=>setModel(e.target.value)}><option value="">전체 모델</option>{result?.models.map(m=><option key={m}>{m}</option>)}</select></label>
      <label>생각 깊이<select value={effort} onChange={e=>setEffort(e.target.value)}><option value="">전체 깊이</option>{result?.efforts.map(m=><option value={m} key={m}>{effortText(m)}</option>)}</select></label>
    </div>
    <Disclosure title="날짜와 시간 직접 선택"><div className="analysis-filters">
      <label>시작<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label>종료 (이 시각 직전까지)<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
    </div></Disclosure>
    <p className="compact-meta analytics-range">{start.replace('T',' ')} ~ {end.replace('T',' ')}<span>{busy?'조회 중':`${number(result?.eventCount??0)}개 기록`}<Help label="수집 상태">PC 시간대: {Intl.DateTimeFormat().resolvedOptions().timeZone}. 마지막 수집: {result?.scannedAt?new Date(result.scannedAt).toLocaleString():'아직 수집 전'}. 계정을 확인하지 못한 기록은 {number(result?.unknownEvents??0)}개입니다.</Help></span></p>
    {error&&<p role="alert" className="error-copy">{error}</p>}
    {result&&<>
      {result.pendingFiles>0&&<p className="analysis-notice">{result.pendingFiles}개 파일을 더 읽고 있습니다. 잠시 후 기록 가져오기를 눌러 주세요.</p>}
      {result.warnings.length>0&&<Disclosure title={`수집 안내 ${result.warnings.length}개`}>{result.warnings.map(w=><p className="error-copy" key={w}>{w}</p>)}</Disclosure>}
      <div className="analytics-overview">
        <h3>조회 기간의 사용 요약</h3>
        <p className="section-caption">사용량을 API 요금으로 환산한 달러 금액입니다. 실제 청구 금액은 아닙니다.<Help label="비용 계산">API는 사용한 양만큼 비용을 내는 방식입니다. 구독으로 사용한 양도 이 단가에 대입해 비교합니다. 단가를 알 수 없는 기록은 제외합니다. 자세한 조건은 아래 계산 방식에서 볼 수 있습니다.</Help></p>
        {result.total.cost.unpricedEvents>0&&<p className="analysis-notice">전체 {number(result.eventCount)}개 중 단가를 확인한 {number(result.total.cost.pricedEvents)}개만 금액에 포함했습니다.</p>}
        <div className="stat-grid analytics-stats">
          <div><span>사용 금액 (추정)</span><strong>{costText(result.total)}</strong><small>선택한 기간과 필터의 합계</small></div>
          <div><span>처리한 글의 양<Help label="토큰">토큰은 AI가 글을 나누어 읽고 쓰는 작은 단위입니다. 보낸 내용, 다시 읽은 내용, 답변과 생각에 쓰인 양을 합칩니다. 글자 수와 일치하지 않습니다.</Help></span><strong title={`${number(result.total.total)} 토큰`}>{result.total.total.toLocaleString('ko-KR',{notation:'compact',maximumFractionDigits:1})}</strong><small>토큰: AI가 글을 처리하는 단위</small></div>
          <div><span>입력 재사용 비율<Help label="캐시 적중률">이미 읽은 내용을 다시 활용하는 것을 캐시라고 합니다. 60%라면 입력 100토큰 중 60토큰을 다시 쓴 것입니다. 이 부분에는 낮은 입력 단가가 적용됩니다. 캐시 수치가 있는 기록만 계산하며 요청 횟수의 비율은 아닙니다.</Help></span><strong>{hit(result.total)}</strong><small>캐시 적중률{result.total.cost.cacheUnknownEvents>0?' / 확인된 기록만':''}</small></div>
          <div><span>{cacheIncrease?'캐시로 늘어난 금액':'캐시로 아낀 금액'}<Help label="캐시 절감액">내용을 매번 새로 읽었을 때와 비교한 추정 금액입니다. 다시 읽기 할인에서 새로 저장하는 비용을 빼므로, 저장 비용이 더 크면 늘어난 금액으로 표시합니다.</Help></span><strong>{result.total.cost.pricedEvents?money(Math.abs(result.total.cost.cacheSavingsUsd)):'단가 미확인'}</strong><small>입력 재사용으로 달라진 비용 (추정)</small></div>
        </div>
      </div>
      <div className="weekly-budget">
        <div className="budget-heading"><h3>선택한 계정의 주간 한도</h3><Help label="주간 한도 추정">주간 소모율은 추정값입니다. 예를 들어 한도 10%를 쓰는 동안 환산 금액이 $2였다면, 100%는 약 $20로 추정합니다. 모델과 생각 깊이 필터와 관계없이 계정 전체를 계산합니다. 월 구독료나 공식 보장 금액은 아닙니다.</Help></div>
        {!hasAccount?<p className="section-caption">위에서 계정 하나를 선택하면 남은 한도와 예상 금액을 볼 수 있습니다.</p>:<>
          <p className="section-caption">{selectedAccount?.label??'선택한 계정'} 전체 기준 / {budget?.at?`${new Date(budget.at).toLocaleString()}에 확인`:'아직 주간 한도를 확인하지 못했습니다.'}</p>
          {budget?.usedPercent!==null&&budget?.usedPercent!==undefined&&<div className="budget-progress">
            <div><span>사용 {budget.usedPercent.toFixed(1)}%</span><strong>남음 {(100-budget.usedPercent).toFixed(1)}%</strong></div>
            <progress max={100} value={budget.usedPercent} aria-label="주간 한도 사용률"/>
          </div>}
          {budget?.limitUsd!==null&&budget?.limitUsd!==undefined?<div className="budget-strip">
            <div><span>사용한 한도를 금액으로</span><strong>{money(budget.usedUsd)}</strong></div>
            <div><span>남은 한도를 금액으로</span><strong>{money(budget.remainingUsd)}</strong></div>
            <div><span>주간 한도 100%를 금액으로</span><strong>{money(budget.limitUsd)}</strong></div>
          </div>:<p className="budget-empty">금액은 자료 수집 중입니다. 앱을 켜 둔 채 Codex를 사용하면, 한도가 줄어든 양과 사용 기록을 비교해 계산합니다.</p>}
          <p className="budget-footnote">금액은 추정치입니다. 조회 기간 안에서 마지막으로 확인한 주간 한도를 보여줍니다.</p>
        </>}
      </div>
      <div className="panel-heading"><h3>시간에 따른 사용량</h3><label className="chart-choice">그래프<select aria-label="그래프 수치" value={chartMetric} onChange={e=>setChartMetric(e.target.value as 'tokens'|'cost')}><option value="cost">금액 (달러, 추정)</option><option value="tokens">처리량 (토큰)</option></select></label></div>
      <div className="chart-scroll"><svg viewBox={`0 0 ${chartWidth} 220`} width={chartWidth} height="220" role="img" aria-label={chartMetric==='tokens'?'기간별 총토큰 막대 그래프':'기간별 환산 금액 막대 그래프'}>
        {[0,.5,1].map(ratio=><g key={ratio}><line x1="64" y1={175-ratio*140} x2={chartWidth} y2={175-ratio*140}/><text x="56" y={180-ratio*140} textAnchor="end" fontSize="13">{chartMetric==='cost'?money(max*ratio):(max*ratio).toLocaleString('ko-KR',{notation:'compact',maximumFractionDigits:1})}</text></g>)}
        {result.timeline.map((r,i)=>{const width=(chartWidth-64)/Math.max(1,result.timeline.length);const height=chartValue(r)/max*140;return <g key={r.key}><title>{r.key}: {costText(r)} / {number(r.total)} 토큰 / 캐시 적중률 {hit(r)}</title><rect x={64+i*width+6} y={175-height} width={Math.max(3,width-12)} height={Math.max(1,height)} rx="5" fill="#4284d6"/>{(result.timeline.length<=24||i%Math.ceil(result.timeline.length/24)===0)&&<text x={64+i*width+width/2} y="203" textAnchor="middle" fontSize="13">{r.key.slice(5)}</text>}</g>;})}
        {!result.timeline.length&&<text x="90" y="80">이 기간에는 사용 기록이 없습니다.</text>}
      </svg></div>
      <h3>모델별 사용 내역<Help label="모델별 수치">생각 깊이는 리즈닝 설정입니다. 주간 한도 5%p는 한도 100칸 중 5칸을 썼다는 뜻입니다. 관측된 한도 감소분을 토큰 양에 따라 나눈 추정치이며 관측하지 못한 구간은 빠집니다. 계정 하나를 선택해야 표시됩니다. 기간 중 초기화가 있었다면 합계가 100%p를 넘을 수 있습니다.</Help></h3>
      <TokenTable rows={result.dimensions} first="모델 / 생각 깊이" models/>
      <Disclosure title="기간별 숫자 자세히 보기"><TokenTable rows={result.timeline} first="기간"/></Disclosure>
      <Disclosure title="계산 방식과 용어">
        <dl className="analytics-glossary">
          <div><dt>토큰</dt><dd>AI가 글을 읽고 쓰는 단위입니다. 입력에는 캐시가, 출력에는 생각에 사용한 추론 토큰이 이미 포함되어 있습니다.</dd></div>
          <div><dt>캐시 적중률</dt><dd>다시 활용한 입력 토큰 ÷ 전체 입력 토큰입니다. 캐시 수치가 없는 기록은 비율에서 제외합니다.</dd></div>
          <div><dt>금액의 기준</dt><dd>{PRICING_DATE} API Standard 단가를 사용한 달러 추정치입니다. 캐시 읽기 할인과 기록된 쓰기 비용을 반영하며 쓰기 기록이 없으면 0으로 가정합니다. Codex 크레딧 청구에는 캐시 쓰기 가산이 없습니다. Fast 모드, 도구, 지역 가산은 제외합니다. GPT-6은 272K 초과 할증을 반영합니다. 미확인 모델과 GPT-5.6 장문맥 단가는 제외합니다.</dd></div>
          <div><dt>주간 한도의 금액</dt><dd>같은 계정과 초기화 주기에서 15분 이내로 연속 관측한 구간만 사용합니다. 한도 감소가 최소 1%p 쌓여야 계산합니다. 다른 기기의 사용이나 빠진 기록 때문에 실제와 차이가 날 수 있습니다. 현재 계산에 쓴 한도 감소는 {result.weeklyBudget.observedPercent.toFixed(2)}%p, 관측 구간은 {result.weeklyBudget.intervals}개입니다.</dd></div>
        </dl>
      </Disclosure>
      <Disclosure title="주간 한도와 크레딧 기록">
        <p className="muted">서버에서 확인한 계정 전체 수치입니다. 최근 500개 기록을 표시합니다.</p>
        <div className="table-scroll"><table><thead><tr><th>확인 시각</th><th>계정</th><th>주간 사용률</th><th>남은 크레딧</th><th>주간 초기화</th></tr></thead><tbody>{[...result.observations].reverse().map(o=><tr key={o.accountId+o.at}><td>{new Date(o.at).toLocaleString()}</td><td>{accounts.find(a=>a.id===o.accountId)?.label??o.accountId.slice(0,8)}</td><td>{o.weeklyUsed===null?'확인 불가':`${o.weeklyUsed.toFixed(2)}%`}</td><td>{o.credits===null?'확인 불가':number(o.credits)}</td><td>{o.resetAt?new Date(o.resetAt).toLocaleString():'확인 불가'}</td></tr>)}</tbody></table></div>
      </Disclosure>
      <Disclosure title={`개별 사용 기록 (${number(result.eventCount)}개)`}>
        <div className="table-scroll"><table><thead><tr><th>시각</th><th>모델</th><th>생각 깊이</th><th>계정 (추정)</th><th>입력</th><th>캐시</th><th>캐시 쓰기</th><th>출력</th><th>추론</th><th>총토큰</th></tr></thead><tbody>{result.events.map(e=><tr key={e.id} title={`세션 ${e.session}`}><td>{new Date(e.at).toLocaleString()}</td><td>{e.model}</td><td>{effortText(e.effort)}</td><td>{e.accountId?(accounts.find(a=>a.id===e.accountId)?.label??e.accountId.slice(0,8)):'미확인'}</td><td>{number(e.input)}</td><td>{number(e.cached)}</td><td>{number(e.cacheWrite)}</td><td>{number(e.output)}</td><td>{number(e.reasoning)}</td><td>{number(e.total)}</td></tr>)}</tbody></table></div>
        <div className="toolbar"><button disabled={page===0||busy} onClick={()=>setPage(p=>p-1)}>이전</button><span>{page+1} / {Math.max(1,Math.ceil(result.eventCount/100))}</span><button disabled={(page+1)*100>=result.eventCount||busy} onClick={()=>setPage(p=>p+1)}>다음</button></div>
      </Disclosure>
    </>}
  </section>;
}
