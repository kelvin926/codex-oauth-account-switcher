import { describe,expect,it } from 'vitest';
import { mkdtemp,mkdir,writeFile,appendFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createParserState,parseRolloutLine } from '../analytics/parser';
import { queryAnalytics,estimateWeekly,attributeEvents,analyticsCsv } from '../analytics/query';
import { AnalyticsStore } from '../analytics/store';
import type { UsageEvent,QuotaObservation } from '../../shared/features';
const at=(n:number)=>new Date(Date.UTC(2026,8,25,12,n)).toISOString();
const tokens=(total:number)=>({input_tokens:total-20,cached_input_tokens:10,output_tokens:20,reasoning_output_tokens:5,total_tokens:total});
const line=(type:string,payload:unknown,n=1)=>JSON.stringify({type,payload,timestamp:at(n)});
const event=(total:number,last:number,n=1)=>line('event_msg',{type:'token_count',info:{total_token_usage:tokens(total),last_token_usage:tokens(last)}},n);
function state(){const s=createParserState('file');parseRolloutLine(line('session_meta',{id:'thread',timestamp:at(0),model_provider:'openai',creator_account_id:'old-login'}),s);parseRolloutLine(line('turn_context',{turn_id:'turn',model:'model-a',effort:'xhigh'}),s);return s;}
function usage(n:number,total=100):UsageEvent{return {...parseRolloutLine(event(total,total,n),state())!,id:`event-${n}`};}
const spans=[{start:at(0),end:at(6),accountId:'a'}];
const query={start:at(0),end:at(10),bucket:'hour' as const};
const observations:QuotaObservation[]=[{at:at(0),accountId:'a',weeklyUsed:20,resetAt:'2026-09-30T00:00:00Z',credits:100},{at:at(5),accountId:'a',weeklyUsed:22,resetAt:'2026-09-30T00:00:00Z',credits:99}];
describe('local token analytics',()=>{
  it('uses last reported tokens without adding cached or reasoning twice, and never bills creator metadata',()=>{
    const e=parseRolloutLine(event(100,100),state())!;
    expect(e).toMatchObject({model:'model-a',effort:'xhigh',input:80,cached:10,output:20,reasoning:5,total:100,accountId:null});
  });
  it('ignores quota-only duplicate counters and resets; retains model changes',()=>{
    const s=state();expect(parseRolloutLine(event(100,100),s)).not.toBeNull();
    expect(parseRolloutLine(event(100,100,2),s)).toBeNull();
    parseRolloutLine(line('turn_context',{turn_id:'next',model:'model-b',effort:'low'},2),s);
    expect(parseRolloutLine(event(150,50,3),s)).toMatchObject({model:'model-b',effort:'low',total:50});
    expect(parseRolloutLine(event(90,30,4),s)).toBeNull();
    expect(s.skipped).toBe(1);
  });
  it('does not allocate missing cumulative usage or forked history to the current model',()=>{
    const s=state();parseRolloutLine(event(100,100),s);
    expect(parseRolloutLine(event(400,50,2),s)?.total).toBe(50);expect(s.skipped).toBe(1);
    const fork=state();fork.fork=true;fork.createdAt=at(3);
    expect(parseRolloutLine(event(100,100,1),fork)).toBeNull();
    expect(parseRolloutLine(event(150,50,4),fork)?.total).toBe(50);
  });
  it('keeps attribution unknown before monitoring and for routed providers',()=>{
    const spans=[{start:at(2),end:at(5),accountId:'a'}];
    expect(attributeEvents([usage(1),usage(3),{...usage(4),provider:'custom'}],spans).map(e=>e.accountId)).toEqual([null,'a',null]);
  });
  it('allocates only within matched quota windows, with filter-independent weights',()=>{
    const events:UsageEvent[]=[{...usage(1,100),accountId:'a',model:'gpt-6-sol',serviceTier:'standard'},{...usage(2,100),accountId:'a',model:'gpt-6-astra',serviceTier:'standard'}];
    expect(estimateWeekly(events,observations,[{start:at(1),end:at(6),accountId:'a'}]).size).toBe(0);
    const values=estimateWeekly(events,observations,spans);expect(values.get('event-1')).toBeCloseTo(1/3);expect(values.get('event-2')).toBeCloseTo(5/3);
    const result=queryAnalytics(events,observations,spans,{...query,accountId:'a',model:'gpt-6-sol'});
    expect(result.total.weeklyEstimate).toBeCloseTo(1/3);expect(result.total.total).toBe(100);
    expect(queryAnalytics(events,observations,spans,query).total.weeklyEstimate).toBeNull();
    expect(estimateWeekly(events,[observations[0],{...observations[1],weeklyUsed:1}],spans).size).toBe(0);
    expect(estimateWeekly(events,[observations[0],{...observations[1],resetAt:'2026-10-01T00:00:00Z'}],spans).size).toBe(0);
  });
  it('reads persisted tier snapshots, preserves max/ultra, and never infers speed from effort',()=>{
    const s=state();
    expect(parseRolloutLine(event(100,100),s)).toMatchObject({serviceTier:'unknown',effort:'xhigh'});
    parseRolloutLine(line('event_msg',{type:'thread_settings_applied',thread_id:'other',thread_settings:{model:'gpt-6-astra',model_provider_id:'openai',service_tier:'fast'}}),s);
    expect(s.nextTier).toBe('unknown');
    const setting=(speed?:string)=>line('event_msg',{type:'thread_settings_applied',thread_id:'thread',thread_settings:{model:'gpt-6-astra',model_provider_id:'openai',...(speed?{service_tier:speed}:{})}});
    parseRolloutLine(setting('fast'),s);
    expect(parseRolloutLine(event(150,50,2),s)?.serviceTier).toBe('unknown'); // In-flight tier cannot be recovered.
    parseRolloutLine(line('event_msg',{type:'task_started',turn_id:'two'}),s);
    parseRolloutLine(line('turn_context',{turn_id:'two',model:'gpt-6-astra',effort:'ultra'}),s);
    expect(parseRolloutLine(event(200,50,3),s)).toMatchObject({serviceTier:'fast',tierSource:'thread-default',effort:'ultra'});
    parseRolloutLine(setting(),s); // Complete snapshot omits None tier: Standard.
    parseRolloutLine(line('turn_context',{turn_id:'three',model:'gpt-6-sol',reasoning_effort:'max'}),s);
    expect(parseRolloutLine(event(250,50,4),s)).toMatchObject({serviceTier:'standard',tierSource:'thread-default',effort:'max'});
    parseRolloutLine(line('turn_context',{turn_id:'four',model:'gpt-6-sol',effort:'max',service_tier:'priority'}),s);
    expect(parseRolloutLine(event(300,50,5),s)?.serviceTier).toBe('fast');
  });
  it('reindexes old cursors for speed metadata without duplicating usage or losing quota history',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'analytics-migrate-'));const home=path.join(root,'home');
    try{
      await mkdir(path.join(home,'sessions'),{recursive:true});
      const file=path.join(home,'sessions','one.jsonl');
      await writeFile(file,[line('session_meta',{id:'thread',timestamp:at(0),model_provider:'openai'}),line('turn_context',{turn_id:'one',model:'gpt-6-sol',effort:'max',service_tier:'fast'}),event(100,100)].join('\n')+'\n');
      const store=new AnalyticsStore(path.join(root,'data'),home);await store.scan();
      const dbFile=path.join(root,'data','analytics.json');const db=JSON.parse(await readFile(dbFile,'utf8'));
      delete db.files[path.join('sessions','one.jsonl')].parserVersion;
      delete db.events[0].serviceTier;db.observations=observations;
      await writeFile(dbFile,JSON.stringify(db));
      const resumed=new AnalyticsStore(path.join(root,'data'),home);await resumed.scan();await resumed.scan();
      const result=await resumed.query(query);
      expect(result.eventCount).toBe(1);expect(result.events[0].serviceTier).toBe('fast');expect(result.observations).toEqual(observations);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('deduplicates mirrored files by event identity, preserves distinct threads, and uses exclusive end',()=>{
    const e=usage(1);const result=queryAnalytics([e,e,{...e,id:'other',session:'other'},usage(5)],[],[],{...query,end:at(5)});
    expect(result.eventCount).toBe(2);expect(result.total.total).toBe(200);expect(analyticsCsv(result)).toContain('모델 / 리즈닝');
  });
  it('incrementally resumes partial JSONL lines across restarts without retaining prompt text',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'analytics-test-'));const home=path.join(root,'home');
    try{
      await mkdir(path.join(home,'sessions'),{recursive:true});const file=path.join(home,'sessions','one.jsonl');
      await writeFile(file,line('session_meta',{id:'thread',timestamp:at(0),model_provider:'openai'})+'\n'+line('turn_context',{model:'model-a',effort:'high'})+'\n'+event(100,100)+'\n'+event(150,50,2).slice(0,30));
      const store=new AnalyticsStore(path.join(root,'data'),home);await store.scan();expect((await store.query(query)).total.total).toBe(100);
      await appendFile(file,event(150,50,2).slice(30)+'\n'+line('response_item',{text:'PRIVATE PROMPT CONTENT'})+'\n');
      const resumed=new AnalyticsStore(path.join(root,'data'),home);await resumed.scan();await resumed.scan();expect((await resumed.query(query)).total.total).toBe(150);
      const {readFile}=await import('node:fs/promises');expect(await readFile(path.join(root,'data','analytics.json'),'utf8')).not.toContain('PRIVATE PROMPT CONTENT');
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
