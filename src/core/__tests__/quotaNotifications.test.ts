import { describe,it,expect } from 'vitest';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { quotaNotice } from '../quotaNotifications';
import { FeatureStore } from '../featureStore';
import type { UsageSnapshot } from '../types';
const at=(n:number)=>new Date(Date.UTC(2026,8,26,0,n)).toISOString();
const usage=(used:number|null,n=0):UsageSnapshot=>({fetchedAt:at(n),source:'fixture',primaryRemainingPercent:null,primaryResetAt:null,primaryWindowSeconds:null,secondaryRemainingPercent:used===null?null:100-used,secondaryResetAt:'2026-09-30T00:00:00Z',secondaryWindowSeconds:604800});
describe('weekly recovery notification',()=>{
  it('alerts at exactly 1% remaining, once until capacity recovers',()=>{
    const before=quotaNotice(undefined,usage(98.9),1)!;
    expect(before.low).toBe(false);
    const atLimit=quotaNotice(before.state,usage(99,1),1)!;
    expect(atLimit.low).toBe(true);
    expect(quotaNotice(atLimit.state,usage(99.5,2),1)?.low).toBe(false);
    const recovered=quotaNotice(atLimit.state,usage(98,3),1)!;
    expect(quotaNotice(recovered.state,usage(100,4),1)?.low).toBe(true);
  });
  it('detects an unexpected reset even when reset time stays the same and usage was not low',()=>{
    const before=quotaNotice(undefined,usage(40),20)!.state;
    const next=quotaNotice(before,usage(0,5),20)!;
    expect(next.reset).toBe(true);expect(next.low).toBe(false);
    expect(quotaNotice(next.state,usage(0,5),20)).toBeNull();
    expect(quotaNotice(next.state,usage(0,10),20)?.reset).toBe(false);
  });
  it('ignores rounding noise, stale observations and missing windows',()=>{
    const before=quotaNotice(undefined,usage(40),20)!.state;
    expect(quotaNotice(before,usage(39.9,5),20)?.reset).toBe(false);
    expect(quotaNotice(before,usage(0,-5),20)).toBeNull();
    expect(quotaNotice(before,usage(null,5),20)).toBeNull();
    const partial=quotaNotice(before,{...usage(null,5),primaryWindowSeconds:18000,primaryRemainingPercent:50},20)!.state;
    expect(partial.used).toBe(40);
    expect(quotaNotice(partial,usage(0,10),20)?.reset).toBe(true);
  });
  it('retains settings and notification baseline through an app restart',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'quota-state-'));
    try {
      const file=path.join(root,'features.json');
      await writeFile(file,JSON.stringify({settings:{refreshMinutes:10,tray:false},operations:[]}));
      const store=new FeatureStore(file);await store.load();
      expect(store.settings).toMatchObject({refreshMinutes:10,tray:false,startAtLogin:true,weeklyResetNotifications:true});
      store.quotaStates.a=quotaNotice(undefined,usage(40),20)!.state;
      store.settings.lowRemaining=1;
      store.startupConfigured=true;await store.save();
      const resumed=new FeatureStore(file);await resumed.load();
      expect(resumed.startupConfigured).toBe(true);
      expect(resumed.settings.lowRemaining).toBe(1);
      expect(quotaNotice(resumed.quotaStates.a,usage(0,5),20)?.reset).toBe(true);
    } finally {await rm(root,{recursive:true,force:true});}
  });
});
