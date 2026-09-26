import type { AnalyticsQuery, AnalyticsResult, AnalyticsRow, QuotaObservation, UsageEvent, WeeklyBudget } from '../../shared/features.js';
import { addCost, cacheHit, emptyCost, priceEvent } from './pricing.js';
import { emptyCounts } from './parser.js';
export type AccountSpan = { start: string; end: string; accountId: string };
export function attributeEvents(events: UsageEvent[], spans: AccountSpan[]): UsageEvent[] {
  const ordered = [...spans].sort((a,b)=>a.start.localeCompare(b.start));
  return events.map(event => {
    let low=0, high=ordered.length-1, found=-1;
    while (low<=high) { const mid=(low+high)>>1; if (ordered[mid].start<event.at) {found=mid;low=mid+1;} else high=mid-1; }
    const span=ordered[found];
    // A routed provider can use a different credential from the native login.
    return span && event.at<=span.end && event.provider === 'openai'
      ? { ...event, accountId: span.accountId, attribution: 'observed-login' as const } : event;
  });
}
type QuotaInterval = { before: QuotaObservation; after: QuotaObservation; events: UsageEvent[]; delta: number };
function quotaIntervals(events: UsageEvent[], observations: QuotaObservation[], spans: AccountSpan[]): QuotaInterval[] {
  const result: QuotaInterval[] = [];
  const previous = new Map<string, QuotaObservation>();
  const byAccount = new Map<string, UsageEvent[]>();
  for (const e of events) if (e.accountId) {
    let bucket = byAccount.get(e.accountId);
    if (!bucket) { bucket = []; byAccount.set(e.accountId, bucket); }
    bucket.push(e);
  }
  for (const bucket of byAccount.values()) bucket.sort((a,b)=>a.at.localeCompare(b.at));
  const positions = new Map<string, number>();
  for (const observation of [...observations].sort((a,b) => a.at.localeCompare(b.at))) {
    const before = previous.get(observation.accountId);
    previous.set(observation.accountId, observation);
    const rows = byAccount.get(observation.accountId) ?? [];
    let index = positions.get(observation.accountId) ?? 0;
    const eligible: UsageEvent[] = [];
    while (index < rows.length && rows[index].at <= observation.at) {
      if (before && rows[index].at > before.at) eligible.push(rows[index]);
      index++;
    }
    positions.set(observation.accountId,index);
    if (!before || before.weeklyUsed === null || observation.weeklyUsed === null || !before.resetAt || before.resetAt !== observation.resetAt) continue;
    const elapsed = Date.parse(observation.at) - Date.parse(before.at);
    if (elapsed <= 0 || elapsed > 15 * 60_000 || Date.parse(observation.resetAt!) <= Date.parse(observation.at)) continue;
    // Known monitoring gaps must not be charged to the few events observed after restart.
    const covered = spans.some(span=>span.accountId===observation.accountId && span.start<=before.at && span.end>=observation.at);
    if (!covered) continue;
    const delta = observation.weeklyUsed - before.weeklyUsed;
    if (delta < 0 || delta > 100) continue;
    const total = eligible.reduce((sum,e) => sum + e.total, 0);
    if (total === 0) continue;
    result.push({before,after:observation,events:eligible,delta});
  }
  return result;
}
export function estimateWeekly(events: UsageEvent[], observations: QuotaObservation[], spans: AccountSpan[] = []): Map<string, number> {
  return allocateWeekly(quotaIntervals(events,observations,spans));
}
function allocateWeekly(intervals: QuotaInterval[]) {
  const estimates = new Map<string, number>();
  for (const interval of intervals) {
    const total = interval.events.reduce((sum,e)=>sum+e.total,0);
    for (const event of interval.events) estimates.set(event.id,interval.delta*event.total/total);
  }
  return estimates;
}
function weeklyBudget(intervals: QuotaInterval[], observations: QuotaObservation[], query: AnalyticsQuery): WeeklyBudget {
  const empty: WeeklyBudget = { limitUsd:null,usedUsd:null,remainingUsd:null,usedPercent:null,observedPercent:0,intervals:0,at:null,resetAt:null };
  if (!query.accountId || query.accountId === 'unknown') return empty;
  const rows = observations.filter(o=>o.accountId===query.accountId && o.weeklyUsed!==null && o.resetAt && o.at<query.end).sort((a,b)=>a.at.localeCompare(b.at));
  const latest = rows.at(-1);
  if (!latest || latest.at<query.start || Date.parse(latest.resetAt!)<=Date.parse(latest.at)) return empty;
  // A sudden reset can retain resetAt. Do not calibrate against the preceding budget.
  let first = rows.length-1;
  while(first>0 && rows[first-1].resetAt===latest.resetAt && rows[first-1].weeklyUsed!<=rows[first].weeklyUsed!) first--;
  let cost = 0, points = 0, count = 0;
  for (const interval of intervals) {
    if (interval.after.accountId!==query.accountId || interval.after.resetAt!==latest.resetAt || interval.before.at<rows[first].at || interval.after.at>latest.at || interval.before.weeklyUsed!>=100) continue;
    const prices = interval.events.map(priceEvent);
    if (prices.some(p=>p===null)) continue;
    cost += prices.reduce((sum,p)=>sum+p!.usd,0); points += interval.delta; count++;
  }
  const limit = points>=1 && cost>0 ? cost/points*100 : null;
  return {limitUsd:limit,usedUsd:limit===null?null:limit*latest.weeklyUsed!/100,remainingUsd:limit===null?null:limit*(100-latest.weeklyUsed!)/100,
    usedPercent:latest.weeklyUsed,observedPercent:points,intervals:count,at:latest.at,resetAt:latest.resetAt};
}
export function bucketKey(at: string, bucket: AnalyticsQuery['bucket']): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (bucket === 'week') { date.setDate(date.getDate() - ((date.getDay()+6)%7)); date.setHours(0,0,0,0); }
  const day = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  if (bucket === 'hour') return `${day} ${pad(date.getHours())}:00`;
  if (bucket === 'month') return day.slice(0,7);
  return day;
}
export function queryAnalytics(events: UsageEvent[], observations: QuotaObservation[], spans: AccountSpan[], query: AnalyticsQuery): AnalyticsResult {
  const start = Date.parse(query.start), end = Date.parse(query.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !['hour','day','week','month'].includes(query.bucket)) throw new Error('조회 기간이 올바르지 않습니다.');
  const unique = [...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>a.at.localeCompare(b.at));
  const attributed = attributeEvents(unique, spans);
  const intervals = quotaIntervals(attributed, observations, spans);
  const estimates = allocateWeekly(intervals);
  const selected = attributed.filter(e => Date.parse(e.at) >= start && Date.parse(e.at) < end &&
    (!query.accountId || (query.accountId === 'unknown' ? !e.accountId : e.accountId === query.accountId)) &&
    (!query.model || e.model === query.model) && (!query.effort || e.effort === query.effort));
  const row = (key: string): AnalyticsRow => ({ ...emptyCounts(), key, count: 0, weeklyEstimate: null, cost: emptyCost() });
  const total = row('전체'); const timeline = new Map<string, AnalyticsRow>(); const dimensions = new Map<string, AnalyticsRow>();
  const add = (r: AnalyticsRow, e: UsageEvent, price: ReturnType<typeof priceEvent>) => {
    for (const k of Object.keys(emptyCounts()) as (keyof ReturnType<typeof emptyCounts>)[]) r[k] += e[k];
    r.count++; addCost(r.cost,e,price);
    const value = estimates.get(e.id);
    // Quota percentages from different accounts are not additive.
    if (value !== undefined && query.accountId && query.accountId !== 'unknown') r.weeklyEstimate = (r.weeklyEstimate ?? 0) + value;
  };
  for (const e of selected) {
    const key = bucketKey(e.at, query.bucket), dimension = `${e.model} / ${e.effort}`;
    if (!timeline.has(key)) timeline.set(key,row(key)); if (!dimensions.has(dimension)) dimensions.set(dimension,row(dimension));
    const price = priceEvent(e);
    add(total,e,price); add(timeline.get(key)!,e,price); add(dimensions.get(dimension)!,e,price);
  }
  const page = Math.max(0, Math.floor(query.page ?? 0));
  return {
    weeklyBudget:weeklyBudget(intervals,observations,query),
    total, timeline: [...timeline.values()], dimensions: [...dimensions.values()].sort((a,b)=>b.total-a.total),
    events: [...selected].reverse().slice(page*100,(page+1)*100).map(e=>({...e, weeklyEstimate: estimates.get(e.id) ?? null})),
    eventCount: selected.length, observations: observations.filter(o=>Date.parse(o.at)>=start&&Date.parse(o.at)<end&&(!query.accountId||o.accountId===query.accountId)).slice(-500),
    models: [...new Set(unique.map(e=>e.model))].sort(), efforts: [...new Set(unique.map(e=>e.effort))].sort(),
    scannedAt: null, files: 0, pendingFiles: 0, warnings: [], unknownEvents: selected.filter(e=>!e.accountId).length
  };
}
export function analyticsCsv(result: AnalyticsResult): string {
  const quote = (s: unknown) => `"${String(s).replace(/"/g,'""')}"`;
  // Prefix formula-like labels before spreadsheet import.
  const safe = (s: string) => /^[=+@-]/.test(s) ? `'${s}` : s;
  return '\ufeff' + [
    ['기간','입력(캐시 포함)','캐시 입력','캐시 쓰기','출력(추론 포함)','추론','총토큰','기록 수','주간 한도 소모 추정(%p)','API 환산 USD (추정)','캐시 절감 USD (추정)','캐시 적중률(%)','가격 확인 기록','미가격 기록','캐시 미확인 기록'],
    ...result.timeline.map(r=>[safe(r.key),r.input,r.cached,r.cacheWrite,r.output,r.reasoning,r.total,r.count,r.weeklyEstimate??'',r.cost.pricedEvents?r.cost.usd:'',r.cost.pricedEvents?r.cost.cacheSavingsUsd:'',cacheHit(r.cost)??'',r.cost.pricedEvents,r.cost.unpricedEvents,r.cost.cacheUnknownEvents]),
    [], ['모델 / 리즈닝','입력(캐시 포함)','캐시 입력','캐시 쓰기','출력(추론 포함)','추론','총토큰','기록 수','주간 한도 소모 추정(%p)','API 환산 USD (추정)','캐시 절감 USD (추정)','캐시 적중률(%)','가격 확인 기록','미가격 기록','캐시 미확인 기록'],
    ...result.dimensions.map(r=>[safe(r.key),r.input,r.cached,r.cacheWrite,r.output,r.reasoning,r.total,r.count,r.weeklyEstimate??'',r.cost.pricedEvents?r.cost.usd:'',r.cost.pricedEvents?r.cost.cacheSavingsUsd:'',cacheHit(r.cost)??'',r.cost.pricedEvents,r.cost.unpricedEvents,r.cost.cacheUnknownEvents]),
    [], ['계정 한도 100% 환산 USD (추정)',result.weeklyBudget.limitUsd??''],
    ['한도 중 사용 USD (추정)',result.weeklyBudget.usedUsd??''],
    ['한도 중 남은 USD (추정)',result.weeklyBudget.remainingUsd??''],
    ['가격 기준','2026-09-26 API Standard. 실제 구독 청구액 아님. 캐시 쓰기 누락은 0 가정. 미가격 기록 제외.'],
    [], ['참고','로컬에 관측된 기록만 집계. 계정 귀속과 주간 한도 배분은 추정. 외부 사용 포함 가능. 한도 추정은 관측 구간 일부만 포함.']
  ].map(row=>row.map(quote).join(',')).join('\r\n');
}
