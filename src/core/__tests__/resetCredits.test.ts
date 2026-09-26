import { describe,it,expect,vi } from 'vitest';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseResetDetails,ResetCreditService } from '../adapters/resetCredits';
const details={available_count:3,credits:[{id:'one',expires_at:null,granted_at:'2026-09-01T00:00:00Z',status:'available'}]};
describe('reset credits',()=>{
 it('keeps the server count even when the list is capped and expiry is unknown',()=>{expect(parseResetDetails(details)).toMatchObject({available:3,credits:[{expiresAt:null}]});});
 it('persists intent before dispatch and blocks another spend after an ambiguous timeout, even after restart',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'reset-test-'));const file=path.join(root,'ledger.json');let posts=0;
  try{
   const request=vi.fn(async(_url:any,init:any)=>{if(init.method==='POST'){posts++;const saved=JSON.parse(await readFile(file,'utf8'));expect(saved.account.status).toBe('pending');throw new Error('timeout');}return new Response(JSON.stringify(details));}) as unknown as typeof fetch;
   await expect(new ResetCreditService(file,request).consume('TOKEN','account')).rejects.toThrow('확실하지');
   await expect(new ResetCreditService(file,request).consume('TOKEN','account')).rejects.toThrow('차단');expect(posts).toBe(1);
   expect(await readFile(file,'utf8')).not.toContain('TOKEN');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('does not retry spending when post-reset detail refresh fails',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'reset-test-'));let calls=0;
  try{const request=vi.fn(async()=>{calls++;if(calls===1)return new Response(JSON.stringify(details));if(calls===2)return new Response(JSON.stringify({code:'reset',windows_reset:1}));throw new Error('offline');}) as unknown as typeof fetch;
   const result=await new ResetCreditService(path.join(root,'ledger.json'),request).consume('token','account');expect(result.pending).toBe(false);expect(result.message).toContain('조회는 실패');expect(calls).toBe(3);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('fails closed on a damaged spend ledger',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'reset-test-'));const file=path.join(root,'ledger.json');
  try{await writeFile(file,'{');const request=vi.fn(async()=>new Response(JSON.stringify(details))) as unknown as typeof fetch;await expect(new ResetCreditService(file,request).consume('token','account')).rejects.toThrow('차단');expect(request).toHaveBeenCalledTimes(1);}finally{await rm(root,{recursive:true,force:true});}
 });
});
