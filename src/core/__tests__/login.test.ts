import { describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const mocked=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mocked.spawn}));
import { LoginManager } from '../../../electron/login';
function child(){const c=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});mocked.spawn.mockReturnValue(c);return c;}
const emit=(c:ReturnType<typeof child>,msg:unknown)=>c.stdout.write(JSON.stringify(msg)+'\n');
describe('isolated login',()=>{
 it('uses isolated file auth, opens only the official device flow, and cleans cancellation',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'login-test-'));const c=child();const open=vi.fn().mockResolvedValue(undefined);const manager=new LoginManager(path.join(root,'staging'),root,vi.fn(),open);
  try{
   await manager.start('codex.exe','new');const options=mocked.spawn.mock.calls.at(-1)![2];expect(options.env.CODEX_HOME).not.toBe(root);
   emit(c,{id:1,result:{}});emit(c,{id:2,result:{verificationUrl:'https://auth.openai.com/codex/device',userCode:'TEST-1234'}});
   expect(manager.state.status).toBe('waiting');expect(open).toHaveBeenCalledWith('https://auth.openai.com/codex/device');
   await manager.cancel();expect(c.kill).toHaveBeenCalled();expect(manager.state.status).toBe('idle');
  }finally{await manager.cancel();await rm(root,{recursive:true,force:true});}
 });
 it('invalidates a queued completion after cancellation instead of importing stale credentials',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'login-test-'));const c=child();let proceed:()=>void=()=>{};let saved=false;
  const complete=vi.fn(async(_raw:string,_label:string,_id:string|undefined,current:()=>boolean)=>{await new Promise<void>(r=>{proceed=r;});if(current())saved=true;});
  const manager=new LoginManager(path.join(root,'staging'),root,complete,vi.fn());
  try{
   await manager.start('codex.exe','new');const folder=mocked.spawn.mock.calls.at(-1)![2].env.CODEX_HOME;
   await writeFile(path.join(folder,'auth.json'),'AUTH-DATA');emit(c,{method:'account/login/completed',params:{success:true}});
   await vi.waitFor(()=>expect(complete).toHaveBeenCalled());await manager.cancel();proceed();await new Promise(r=>setTimeout(r,0));expect(saved).toBe(false);expect(manager.state.status).toBe('idle');
  }finally{await manager.cancel();await rm(root,{recursive:true,force:true});}
 });
});
