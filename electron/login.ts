import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LoginState } from '../src/shared/features.js';

export class LoginManager {
  state: LoginState = {status:'idle',message:''};
  private child: ChildProcessWithoutNullStreams | null = null;
  private folder: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  constructor(private readonly root: string, private readonly codexHome: string,
    private readonly complete: (raw: string,label: string,expectedId:string|undefined,isCurrent:()=>boolean)=>Promise<void>,
    private readonly openUrl: (url: string)=>Promise<void>) {}
  async cancel(): Promise<LoginState> {
    const generation=++this.generation;
    this.child?.kill(); this.child=null;
    if (this.timer) clearTimeout(this.timer); this.timer=null;
    const folder=this.folder; this.folder=null;
    if (folder) await rm(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    if(generation===this.generation)this.state={status:'idle',message:'로그인을 취소했습니다.'}; return this.state;
  }
  async start(executable: string,label: string,expectedId?:string): Promise<LoginState> {
    await this.cancel();
    const generation=this.generation;
    const folder=path.join(this.root,randomUUID()); this.folder=folder;
    await mkdir(folder,{recursive:true});
    // Preserve forced workspace/login requirements from the user's configuration.
    try { await copyFile(path.join(this.codexHome,'config.toml'),path.join(folder,'config.toml')); }
    catch(error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    this.state={status:'starting',message:'Codex 로그인 준비 중입니다.'};
    const child=spawn(executable,['-c','cli_auth_credentials_store="file"','app-server'],{
      env:{...process.env,CODEX_HOME:folder},windowsHide:true,stdio:['pipe','pipe','pipe']
    });
    this.child=child;
    const send=(id:number,method:string,params:unknown)=>child.stdin.write(JSON.stringify({id,method,params})+'\n');
    let buffer=''; let completed=false;
    const fail=(message:string)=>{
      if(generation!==this.generation || completed)return;
      completed=true;
      const cancelledGeneration=this.generation+1;
      void this.cancel().finally(()=>{ if(this.generation===cancelledGeneration)this.state={status:'error',message}; });
    };
    child.on('error',()=>fail('Codex CLI를 실행하지 못했습니다. 설치 경로를 진단해 주세요.'));
    child.on('exit',()=>{if(!completed)fail('로그인 프로그램이 종료됐습니다. 최신 Codex CLI인지 확인해 주세요.');});
    child.stdin.on('error',()=>fail('로그인 프로그램 연결이 끊겼습니다.'));
    child.stderr.on('data',()=>{/* Drain without logging authentication output. */});
    child.stdout.on('data',(data:Buffer)=>{
      buffer+=data.toString('utf8');
      if(buffer.length>2*1024*1024){fail('로그인 응답이 너무 큽니다.');return;}
      let newline:number;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline); buffer=buffer.slice(newline+1);
        let msg:any; try{msg=JSON.parse(line);}catch{continue;}
        if(generation!==this.generation || completed)continue;
        if(msg.error){fail('공식 로그인 요청을 처리하지 못했습니다. Codex CLI 업데이트 후 다시 시도해 주세요.');continue;}
        if(msg.id===1){
          child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
          send(2,'account/login/start',{type:'chatgptDeviceCode'});
        }
        if(msg.id===2){
          const result=msg.result;
          let url:URL; try{url=new URL(result.verificationUrl);}catch{fail('올바른 로그인 주소를 받지 못했습니다.');continue;}
          if(url.protocol!=='https:' || !['auth.openai.com','chatgpt.com'].includes(url.hostname) || typeof result.userCode!=='string'){fail('로그인 주소를 확인할 수 없습니다.');continue;}
          this.state={status:'waiting',message:'브라우저에서 코드를 입력해 로그인하세요.',url:url.toString(),code:result.userCode};
          void this.openUrl(url.toString()).catch(()=>{ /* The displayed URL remains available. */ });
        }
        if(msg.method==='account/login/completed'){
          if(msg.params?.success!==true){fail('로그인이 완료되지 않았습니다. 다시 시도해 주세요.');continue;}
          completed=true;
          void (async()=>{
            try {
              const raw=await readFile(path.join(folder,'auth.json'),'utf8');
              if(generation!==this.generation)return;
              await this.complete(raw,label,expectedId,()=>generation===this.generation);
              if(generation!==this.generation)return;
              const cancelledGeneration=this.generation+1;
              await this.cancel();
              if(this.generation!==cancelledGeneration)return;
              this.state={status:'complete',message:'로그인한 계정의 인증을 저장했습니다.'};
            }catch(error){
              if(generation!==this.generation)return;
              const cancelledGeneration=this.generation+1;
              await this.cancel(); if(this.generation!==cancelledGeneration)return; this.state={status:'error',message:error instanceof Error?error.message:'인증 저장 실패'};
            }
          })();
        }
      }
    });
    this.timer=setTimeout(()=>fail('로그인 시간이 만료됐습니다. 다시 시작해 주세요.'),10*60_000);
    send(1,'initialize',{clientInfo:{name:'codex_account_switcher',title:'Account Switcher',version:'0.4.0'}});
    return this.state;
  }
}
