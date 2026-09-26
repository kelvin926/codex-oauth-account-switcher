import type { AnalyticsQuery, UsageEvent } from '../shared/features';
import { priceEvent } from '../core/analytics/pricing';
import { queryAnalytics } from '../core/analytics/query';
export function getDemoAnalytics(query:AnalyticsQuery){
  const now=Date.now();
  const events:UsageEvent[]=Array.from({length:36},(_,i)=>({
    id:`demo-${i}`,at:new Date(now-(36-i)*3600_000).toISOString(),session:`demo-session-${i}`,turn:String(i),
    model:i%2?'GPT-6 Sol':'GPT-6 Astra',effort:i%3?'xhigh':'medium',provider:'openai',accountId:'demo-active',attribution:'observed-login',cacheKnown:true,cacheWriteKnown:true,
    input:40000+i*500,cached:30000,cacheWrite:0,output:1000+i*20,reasoning:800+i*10,total:41000+i*520
  }));
  const resetAt = new Date(now+72*3600_000).toISOString();
  // Synthetic but internally consistent $25 budget for screenshots only.
  let used = 30-events.reduce((sum,e)=>sum+priceEvent(e)!.usd,0)/25*100;
  const observations = events.flatMap(e=>{
    const before={at:new Date(Date.parse(e.at)-5*60_000).toISOString(),accountId:'demo-active',weeklyUsed:used,resetAt,credits:1234.56};
    used+=priceEvent(e)!.usd/25*100;
    return [before,{...before,at:new Date(Date.parse(e.at)+60_000).toISOString(),weeklyUsed:used}];
  });
  const spans=[{start:observations[0].at,end:observations.at(-1)!.at,accountId:'demo-active'}];
  const result=queryAnalytics(events,observations,spans,query);
  return {...result,scannedAt:new Date().toISOString(),files:3};
}
