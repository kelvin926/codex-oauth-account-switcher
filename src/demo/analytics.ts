import type { AnalyticsQuery, UsageEvent } from '../shared/features';
import { queryAnalytics } from '../core/analytics/query';
export function getDemoAnalytics(query:AnalyticsQuery){
  const now=Date.now();
  const events:UsageEvent[]=Array.from({length:36},(_,i)=>({
    id:`demo-${i}`,at:new Date(now-(36-i)*3600_000).toISOString(),session:`demo-session-${i}`,turn:String(i),
    model:i%2?'GPT-6 Sol':'GPT-6 Astra',effort:i%3?'xhigh':'medium',provider:'openai',accountId:null,attribution:'unknown',
    input:40000+i*500,cached:30000,cacheWrite:0,output:1000+i*20,reasoning:800+i*10,total:41000+i*520
  }));
  const result=queryAnalytics(events,[],[],query);
  return {...result,scannedAt:new Date().toISOString(),files:3};
}
