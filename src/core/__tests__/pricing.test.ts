import { describe,it,expect } from 'vitest';
import { priceEvent,cacheHit } from '../analytics/pricing';
import { queryAnalytics } from '../analytics/query';
import { counts } from '../analytics/parser';
import type { UsageEvent,QuotaObservation } from '../../shared/features';
const at=(n:number)=>new Date(Date.UTC(2026,8,26,0,n)).toISOString();
const resetAt='2026-09-30T00:00:00.000Z';
const event=(patch:Partial<UsageEvent>={}):UsageEvent=>({id:'e',at:at(2),session:'s',turn:'t',model:'gpt-6-sol',provider:'openai',effort:'xhigh',accountId:'a',attribution:'observed-login',input:200_000,cached:150_000,cacheWrite:20_000,output:10_000,reasoning:5000,total:210_000,cacheKnown:true,cacheWriteKnown:true,...patch});
const query={start:at(0),end:at(10),bucket:'hour' as const,accountId:'a'};
const observations:QuotaObservation[]=[{at:at(0),accountId:'a',weeklyUsed:20,resetAt,credits:0},{at:at(5),accountId:'a',weeklyUsed:22,resetAt,credits:0}];
const spans=[{start:at(0),end:at(10),accountId:'a'}];
describe('cost and cache analytics',()=>{
  it('charges cache read and writes separately and never adds reasoning twice',()=>{
    expect(priceEvent(event())?.usd).toBeCloseTo(.24);
    expect(priceEvent(event())?.savings).toBeCloseTo(.26);
    expect(priceEvent(event({reasoning:0}))?.usd).toBeCloseTo(.24);
  });
  it('applies verified GPT-6 long-context rates and excludes unknown tariffs',()=>{
    expect(priceEvent(event({input:300_000,cached:200_000,cacheWrite:0,total:310_000}))?.usd).toBeCloseTo(.63);
    expect(priceEvent(event({model:'gpt-6-sol-free-auto'}))).toBeNull();
    expect(priceEvent(event({provider:'custom'}))).toBeNull();
    expect(priceEvent(event({model:'gpt-5.6-sol',input:300_000,total:310_000}))).toBeNull();
  });
  it('weights hit rate by input tokens and excludes missing cache counters',()=>{
    const result=queryAnalytics([event({input:10,cached:9,cacheWrite:0,output:0,total:10}),event({id:'b',input:990,cached:90,cacheWrite:0,output:0,total:990}),event({id:'c',input:500,cached:0,cacheKnown:false,cacheWrite:0,output:0,total:500})],[],[],query);
    expect(cacheHit(result.total.cost)).toBeCloseTo(9.9);
    expect(result.total.cost.cacheUnknownEvents).toBe(1);
    expect(result.total.cost.unpricedEvents).toBe(1);
    expect(cacheHit(queryAnalytics([],[],[],query).total.cost)).toBeNull();
  });
  it('uses only paired interval cost for the full weekly budget, independent of model filters',()=>{
    const events=[event(),event({id:'outside',at:at(8),model:'gpt-6-astra'})];
    const result=queryAnalytics(events,observations,spans,query);
    expect(result.weeklyBudget.limitUsd).toBeCloseTo(12);
    expect(result.weeklyBudget.usedUsd).toBeCloseTo(2.64);
    expect(result.weeklyBudget.remainingUsd).toBeCloseTo(9.36);
    expect(queryAnalytics(events,observations,spans,{...query,model:'gpt-6-astra'}).weeklyBudget).toEqual(result.weeklyBudget);
  });
  it('does not extrapolate across resets, monitoring gaps, unknown prices or different accounts',()=>{
    expect(queryAnalytics([event()],observations,[],query).weeklyBudget.limitUsd).toBeNull();
    expect(queryAnalytics([event({model:'unknown'})],observations,spans,query).weeklyBudget.limitUsd).toBeNull();
    expect(queryAnalytics([event()],observations,spans,{...query,accountId:''}).weeklyBudget.limitUsd).toBeNull();
    expect(queryAnalytics([event()],[...observations,{...observations[1],at:at(7),weeklyUsed:0}],spans,query).weeklyBudget.limitUsd).toBeNull();
    expect(queryAnalytics([event()],[observations[0],{...observations[1],weeklyUsed:20.5}],spans,query).weeklyBudget.limitUsd).toBeNull();
  });
  it('includes zero-delta cost until a rounded quota increase becomes visible',()=>{
    const obs=[observations[0],{...observations[0],at:at(3)},observations[1]];
    const result=queryAnalytics([event(),event({id:'next',at:at(4)})],obs,spans,query);
    expect(result.weeklyBudget.limitUsd).toBeCloseTo(24);
  });
  it('accepts nested cache usage and rejects impossible cache token counts',()=>{
    expect(counts({input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:60,cache_write_tokens:30}})).toMatchObject({input:100,cached:60,cacheWrite:30,total:120});
    expect(counts({input_tokens:100,output_tokens:20,total_tokens:120,cached_input_tokens:110})).toBeNull();
  });
});
