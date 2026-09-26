import { describe,it,expect } from 'vitest';
import { priceEvent,cacheHit,pricingOptions } from '../analytics/pricing';
import { queryAnalytics, analyticsCsv } from '../analytics/query';
import { counts } from '../analytics/parser';
import type { UsageEvent,QuotaObservation } from '../../shared/features';
const at=(n:number)=>new Date(Date.UTC(2026,8,26,0,n)).toISOString();
const resetAt='2026-09-30T00:00:00.000Z';
const event=(patch:Partial<UsageEvent>={}):UsageEvent=>({id:'e',at:at(2),session:'s',turn:'t',model:'gpt-6-sol',provider:'openai',effort:'xhigh',serviceTier:'standard',accountId:'a',attribution:'observed-login',input:200_000,cached:150_000,cacheWrite:20_000,output:10_000,reasoning:5000,total:210_000,cacheKnown:true,cacheWriteKnown:true,...patch});
const query={start:at(0),end:at(10),bucket:'hour' as const,accountId:'a'};
const observations:QuotaObservation[]=[{at:at(0),accountId:'a',weeklyUsed:20,resetAt,credits:0},{at:at(5),accountId:'a',weeklyUsed:22,resetAt,credits:0}];
const spans=[{start:at(0),end:at(10),accountId:'a'}];
describe('cost and cache analytics',()=>{
  it('uses Codex credits without a cache-write surcharge or double-counting reasoning',()=>{
    expect(priceEvent(event())?.usd).toBeCloseTo(.23);
    expect(priceEvent(event())?.savings).toBeCloseTo(.27);
    expect(priceEvent(event({reasoning:0}))?.usd).toBeCloseTo(.23);
  });
  it('prices Fast at the Codex 2.5x credit rate, including cache discounts',()=>{
    const standard=priceEvent(event())!;
    const fast=priceEvent(event({serviceTier:'fast',effort:'ultra'}))!;
    expect(standard.credits).toBeCloseTo(5.75);
    expect(fast.credits).toBeCloseTo(14.375);
    expect(fast.usd).toBeCloseTo(.575);
    expect(fast.fastExtraUsd).toBeCloseTo(.345);
    expect(fast.savings).toBeCloseTo(.675);
    expect(priceEvent(event({effort:'max'}))?.credits).toBe(standard.credits);
    expect(priceEvent(event({cacheWrite:0,cacheWriteKnown:false}))?.credits).toBe(standard.credits);
    for(const model of ['gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5']) {
      expect(priceEvent(event({model,serviceTier:'fast'}))!.credits).toBeCloseTo(priceEvent(event({model}))!.credits*2.5);
    }
  });
  it('stacks Codex context and Fast rates and exempts Astra context at every effort',()=>{
    const short=event({input:272000,total:282000});
    const edge=event({input:272001,total:282001});
    expect(priceEvent(short)!.usd).toBeCloseTo(.374);
    expect(priceEvent(edge)!.usd).toBeCloseTo(.698004);
    const long=event({input:300000,cached:200000,cacheWrite:0,total:310000});
    const standard=priceEvent(long)!;
    const fast=priceEvent({...long,serviceTier:'fast'})!;
    expect(standard.usd).toBeCloseTo(.63);
    expect(fast.usd).toBeCloseTo(1.575);
    expect(fast.contextExtraUsd).toBeCloseTo(.29);
    expect(fast.fastExtraUsd).toBeCloseTo(.945);
    expect(fast.contextExtraUsd+fast.fastExtraUsd).toBeCloseTo(fast.usd-.34);
    for(const effort of ['low','medium','high','xhigh','max','ultra']){
      const astra=priceEvent({...long,model:'gpt-6-astra',serviceTier:'fast',effort})!;
      expect(astra.usd).toBeCloseTo(4.25);
      expect(astra.contextExtraUsd).toBe(0);
      expect(astra.contextExempt).toBe(true);
      expect(astra.fast).toBe(true);
      expect(astra.assumed).toBe(false);
    }
    expect(priceEvent({...long,model:'gpt-5.6-sol'})!.usd).toBeCloseTo(1.26);
    expect(priceEvent(event({model:'gpt-6-sol-free-auto'}))).toBeNull();
    expect(priceEvent(event({provider:'custom'}))).toBeNull();
  });
  it('keeps missing speed unknown unless explicitly assumed, and validates conversion inputs',()=>{
    expect(priceEvent(event({serviceTier:undefined}))).toBeNull();
    expect(priceEvent(event({serviceTier:'fast',tierSource:'thread-default'}))).toMatchObject({fast:true,assumed:true});
    expect(priceEvent(event({serviceTier:'unknown',effort:'ultra'}))).toBeNull();
    expect(priceEvent(event({serviceTier:'unknown'}),pricingOptions({unknownSpeed:'fast'}))).toMatchObject({fast:true,assumed:true});
    expect(priceEvent(event({serviceTier:'unsupported'}),pricingOptions({unknownSpeed:'fast'}))).toBeNull();
    expect(pricingOptions({creditUsd:Infinity,unknownSpeed:'bogus' as never})).toMatchObject({creditUsd:.04,unknownSpeed:'exclude'});
    expect(priceEvent(event(),pricingOptions({creditUsd:.08}))!.usd).toBeCloseTo(.46);
  });
  it('allocates observed weekly points by Codex credit cost, and keeps unknown intervals unallocated',()=>{
    const events=[event(),event({id:'fast',at:at(3),serviceTier:'fast',effort:'ultra'})];
    const result=queryAnalytics(events,observations,spans,query);
    expect(result.events.find(e=>e.id==='e')!.weeklyEstimate).toBeCloseTo(2/3.5);
    expect(result.events.find(e=>e.id==='fast')!.weeklyEstimate).toBeCloseTo(2*2.5/3.5);
    const fastOnly=queryAnalytics(events,observations,spans,{...query,serviceTier:'fast'});
    expect(fastOnly.weeklyBudget).toEqual(result.weeklyBudget);
    expect(fastOnly.eventCount).toBe(1);
    const missing=queryAnalytics([...events,event({id:'unknown',serviceTier:undefined})],observations,spans,query);
    expect(missing.total.weeklyEstimate).toBeNull();
    expect(missing.weeklyBudget.limitUsd).toBeNull();
    expect(analyticsCsv(result)).toContain('Fast 추가 USD');
    expect(analyticsCsv(result)).not.toContain('API 환산');
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
    expect(result.weeklyBudget.limitUsd).toBeCloseTo(11.5);
    expect(result.weeklyBudget.usedUsd).toBeCloseTo(2.53);
    expect(result.weeklyBudget.remainingUsd).toBeCloseTo(8.97);
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
    expect(result.weeklyBudget.limitUsd).toBeCloseTo(23);
  });
  it('accepts nested cache usage and rejects impossible cache token counts',()=>{
    expect(counts({input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:60,cache_write_tokens:30}})).toMatchObject({input:100,cached:60,cacheWrite:30,total:120});
    expect(counts({input_tokens:100,output_tokens:20,total_tokens:120,cached_input_tokens:110})).toBeNull();
  });
});
