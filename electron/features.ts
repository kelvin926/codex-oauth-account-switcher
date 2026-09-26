import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AnalyticsStore } from '../src/core/analytics/store.js';
import { analyticsCsv } from '../src/core/analytics/query.js';
import { FeatureStore, validateSettings } from '../src/core/featureStore.js';
import { ResetCreditService } from '../src/core/adapters/resetCredits.js';
import { quotaNotice } from '../src/core/quotaNotifications.js';
import { getUsageWindows } from '../src/core/usageWindows.js';
import { parseAuthBundle } from '../src/core/authBundle.js';
import type { AccountRecord, UsageSnapshot } from '../src/core/types.js';
import type { DashboardPayload } from '../src/shared/desktopApi.js';
import type { AnalyticsQuery, Diagnostic, FeatureSettings, FeatureState } from '../src/shared/features.js';
import { writeFileAtomic } from '../src/core/atomicFile.js';
import { LoginManager } from './login.js';
import { ForecastService, forecastLink } from '../src/core/forecast.js';
import { WindowsStartup } from './windowsStartup.js';

type Dependencies = {
  root: string; home: string;
  serialize<T>(operation:()=>Promise<T>):Promise<T>;
  dashboard():Promise<DashboardPayload>; refresh():Promise<DashboardPayload>;
  switchAccount(id:string):Promise<DashboardPayload>;
  token(id:string):Promise<string>;
  preference(id:string,input:{priority:number;excluded:boolean}):Promise<void>;
  capture(raw:string,label:string,expectedId?:string):Promise<void>;
  cli():Promise<string>; diagnose():Promise<Diagnostic[]>; recover():Promise<void>;
};
export class FeatureRuntime {
  readonly store:FeatureStore;
  readonly analytics:AnalyticsStore;
  readonly login:LoginManager;
  readonly forecast:ForecastService;
  private reset:ResetCreditService;
  private readonly startup = new WindowsStartup(app, process.execPath);
  private tray:Tray|null=null;
  private lastDashboard:DashboardPayload|null=null;
  private timer:ReturnType<typeof setInterval>|null=null;
  private tickPending=false;
  private disposed=false;
  private lastRefresh=Date.now();
  progress:string|null=null;
  constructor(private readonly deps:Dependencies){
    this.store=new FeatureStore(path.join(deps.root,'features.json'));
    this.forecast=new ForecastService(path.join(deps.root,'forecast.json'),()=>this.store.settings,notice=>{
      if(!Notification.isSupported())return;
      const notification=new Notification(notice);
      notification.on('click',()=>{this.show();BrowserWindow.getAllWindows()[0]?.webContents.send('forecast:show');});notification.show();
    });
    this.analytics=new AnalyticsStore(deps.root,deps.home);
    this.reset=new ResetCreditService(path.join(deps.root,'reset-operations.json'));
    this.login=new LoginManager(path.join(deps.root,'login-staging'),deps.home,
      (raw,label,id,isCurrent)=>deps.serialize(async()=>{if(!isCurrent())throw new Error('취소된 로그인입니다.');await deps.capture(raw,label,id);}),url=>shell.openExternal(url));
  }
  async initialize(){
    await this.store.load(); await this.analytics.load(); await this.forecast.load();
    for (const row of this.analytics.latestQuotaObservations()) if (!this.store.quotaStates[row.accountId]) {
      this.store.quotaStates[row.accountId] = {at:row.at,weeklyAt:row.at,used:row.weeklyUsed,reset:row.resetAt,low:row.weeklyUsed! >= 100-this.store.settings.lowRemaining};
    }
    if (process.platform === 'win32' && app.isPackaged) {
      try {
        this.store.settings.startAtLogin = this.startup.reconcile(this.store.startupConfigured,this.store.settings.startAtLogin);
        this.store.startupConfigured = true;
      } catch (error) {
        this.store.settings.startAtLogin = false;
        await this.store.record(null,'자동 시작',false,error instanceof Error?error.message:'등록 실패');
      }
      await this.store.save();
    } else this.store.settings.startAtLogin = false;
    this.configureTray(); this.register();
    this.timer=setInterval(()=>this.tick(),30_000);
    this.tick();
  }
  private configureStartup(enabled:boolean) {
    if (process.platform !== 'win32' || !app.isPackaged) {
      if (enabled) throw new Error('Windows 설치 버전에서 자동 시작을 사용할 수 있습니다.');
      return;
    }
    this.startup.set(enabled);
    this.store.startupConfigured = true;
  }
  state():FeatureState{return {settings:this.store.settings,operations:[...this.store.operations].reverse(),progress:this.progress,login:this.login.state};}
  show(){const window=BrowserWindow.getAllWindows()[0];if(window?.isMinimized())window.restore();window?.show();window?.focus();}
  private configureTray(){
    if(!this.store.settings.tray){this.tray?.destroy();this.tray=null;return;}
    if(this.tray)return;
    const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAgElEQVR4nO3W0Q2AMAgE0K5i4gzuv5lOUD3uoNTkSPpJeZLSOs7ruDvXMMCAaAISJQAm0gBKyACkgIJ4BTAbRnOmAKadTD4MiE6LNAXq16cDqoobAAEqi/+jAwa03AMru7DvWzDb5AsSzdn7fwBFsMVhAIuQDqECSZmCVcuAdsADOnXRcF2eDFUAAAAASUVORK5CYII=');
    this.tray=new Tray(icon);this.tray.setToolTip('Codex 계정 전환기');this.tray.on('click',()=>this.show());
    this.updateTray(null);
  }
  updateTray(dashboard:DashboardPayload|null){
    if(!this.tray)return;
    if(dashboard)this.lastDashboard=dashboard;
    dashboard=this.lastDashboard;
    const accounts=dashboard?.accounts??[];
    const active=accounts.find(a=>a.id===dashboard?.state.activeAccountId);
    this.tray.setToolTip(`Codex: ${active?.label??'로그인 확인 필요'}`.slice(0,127));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {label:'계정 전환기 열기',click:()=>this.show()},
      {label:this.progress??`현재 계정: ${active?.label??'확인 필요'}`,enabled:false},
      {type:'separator'},
      ...accounts.map(account=>{
        const windows=getUsageWindows(account.usage); const remaining=windows.length?Math.min(...windows.map(w=>w.remaining)):null;
        return {label:`${account.label.slice(0,45)}${remaining===null?'':` (${remaining.toFixed(0)}% 남음)`}`,enabled:!this.progress&&account.canSwitch!==false&&account.id!==active?.id,
          click:()=>{void this.traySwitch(account);}};
      }),
      {type:'separator'},
      {label:'전체 사용량 갱신',enabled:!this.progress,click:()=>{void this.deps.serialize(this.deps.refresh).then(d=>this.updateTray(d)).catch(()=>this.show());}},
      {label:'종료',click:()=>app.quit()}
    ]));
  }
  private async traySwitch(account:AccountRecord){
    const answer=await dialog.showMessageBox({type:'question',buttons:['취소','전환'],defaultId:0,cancelId:0,
      message:`${account.label} 계정으로 전환할까요?`,detail:'자동 재시작이 켜져 있으면 실행 중인 Codex가 종료되고 다시 열립니다. 작업을 마친 후 전환하세요.'});
    if(answer.response!==1)return;
    try{await this.deps.serialize(()=>this.deps.switchAccount(account.id));}catch(error){await dialog.showMessageBox({type:'error',message:error instanceof Error?error.message:'전환 실패'});}
  }
  private tick(){
    if(this.disposed)return;
    // Public information must not join the authentication/switch queue.
    void this.forecast.refresh();
    if(this.tickPending)return;this.tickPending=true;
    void this.deps.serialize(async()=>{
      if(this.disposed)return;
      let id:string|null=null;
      try{id=parseAuthBundle(await readFile(path.join(this.deps.home,'auth.json'),'utf8')).accountId;}catch{/* Unknown login is not assigned. */}
      this.analytics.pulse(id);
      const minutes=this.store.settings.refreshMinutes;
      const dashboard=minutes>0&&Date.now()-this.lastRefresh>=minutes*60_000
        ?await this.deps.refresh():await this.deps.dashboard();
      if(minutes>0&&Date.now()-this.lastRefresh>=minutes*60_000)this.lastRefresh=Date.now();
      this.updateTray(dashboard);
    }).then(() => { if(!this.disposed)void this.analytics.scan().catch(()=>{}); }).catch(()=>{/* Keep the last view. Explicit diagnostics exposes failures. */}).finally(()=>{this.tickPending=false;});
  }
  async observe(id:string,usage:UsageSnapshot){
    await this.analytics.observe(id,usage);
    const result = quotaNotice(this.store.quotaStates[id],usage,this.store.settings.lowRemaining);
    if (!result) return;
    this.store.quotaStates[id] = result.state;
    // Persist before delivering so the same observation is not replayed after restart.
    await this.store.save();
    if (!Notification.isSupported()) return;
    const label = this.lastDashboard?.accounts.find(a=>a.id===id)?.label ?? '계정 '+id.slice(0,8);
    let message:string|null = null;
    if (result.reset && this.store.settings.weeklyResetNotifications) message = `${label}: 주간 사용률이 ${result.before?.toFixed(1)}%에서 ${result.used?.toFixed(1)}%로 줄었습니다. 한도 복구를 감지했습니다.`;
    else if (result.low && this.store.settings.notifications) message = `${label}: 남은 사용량이 ${result.remaining.toFixed(0)}%입니다.`;
    if (message) { const notice=new Notification({title:result.reset?'Codex 주간 한도 복구':'Codex 잔여량 알림',body:message});notice.on('click',()=>this.show());notice.show(); }
  }

  async switchOperation(id:string,operation:()=>Promise<DashboardPayload>){
    this.progress='대상 인증 확인 중';
    try{const result=await operation();await this.store.record(id,'전환',true,'인증 교체와 실행 단계를 완료했습니다.');this.updateTray(result);return result;}
    catch(error){await this.store.record(id,this.progress??'전환',false,error instanceof Error?error.message:'전환 실패');throw error;}
    finally{this.progress=null;this.updateTray(null);}
  }
  private register(){
    const handle=(channel:string,callback:(...args:any[])=>Promise<any>)=>ipcMain.handle(channel,(_event,...args)=>this.deps.serialize(()=>callback(...args)));
    ipcMain.handle('features:get',()=>this.state()); // Must remain responsive while a switch is in progress.
    ipcMain.handle('forecast:get',(_event,refresh:boolean)=>refresh?this.forecast.refresh():this.forecast.state());
    ipcMain.handle('forecast:open',async(_event,value:unknown)=>{const url=forecastLink(value);if(!url)throw new Error('지원하지 않는 출처 링크입니다.');await shell.openExternal(url);});
    handle('features:settings',async(settings:FeatureSettings)=>{
      const next=validateSettings(settings);
      if(next.startAtLogin!==this.store.settings.startAtLogin)this.configureStartup(next.startAtLogin);
      if(next.lowRemaining!==this.store.settings.lowRemaining || (next.notifications&&!this.store.settings.notifications)) {
        for(const state of Object.values(this.store.quotaStates)) state.low=false;
      }
      this.store.settings=next;await this.store.save();this.configureTray();return this.state();
    });
    handle('features:preference',async(id:string,input:{priority:number;excluded:boolean})=>{
      if(!Number.isInteger(input?.priority)||input.priority< -2||input.priority>2||typeof input.excluded!=='boolean')throw new Error('계정 우선순위 값 오류');
      await this.deps.preference(id,input);
    });
    handle('features:reset-details',async(id:string)=>this.reset.inspect(await this.deps.token(id),id));
    handle('features:reset-consume',async(id:string)=>{
      const dashboard=await this.deps.dashboard();const account=dashboard.accounts.find(a=>a.id===id);
      if(!account)throw new Error('계정을 찾을 수 없습니다.');
      const answer=await dialog.showMessageBox({type:'warning',buttons:['취소','초기화권 1개 사용'],defaultId:0,cancelId:0,message:`${account.label}의 초기화권 1개를 사용할까요?`,detail:'사용하면 되돌릴 수 없습니다. 이 작업은 현재 로그인 계정을 전환하지 않습니다.'});
      if(answer.response!==1)return this.reset.inspect(await this.deps.token(id),id);
      const result=await this.reset.consume(await this.deps.token(id),id);
      await this.store.record(id,'초기화권',true,result.message??'서버 응답 수신');
      await this.deps.refresh();return result;
    });
    handle('features:login',async(label:string,expected?:string)=>{
      if(typeof label!=='string'||label.length>100)throw new Error('계정 이름은 100자 이내로 입력하세요.');
      return this.login.start(await this.deps.cli(),label,expected);
    });
    ipcMain.handle('features:login-cancel',()=>this.login.cancel()); // Invalidate queued completion immediately.
    handle('features:diagnose',()=>this.deps.diagnose());
    handle('features:recover',async()=>{
      const choice=await dialog.showMessageBox({type:'warning',buttons:['취소','이전 인증으로 복구'],defaultId:0,cancelId:0,message:'마지막 전환 직전의 인증으로 복구할까요?',detail:'실행 중인 Codex를 종료한 후 복구합니다. 이후 Codex를 다시 실행하세요.'});
      if(choice.response===1)await this.deps.recover();
    });
    handle('features:analytics',query=>this.analytics.query(query));
    ipcMain.handle('features:scan',()=>this.analytics.scan());
    handle('features:export',async(query:AnalyticsQuery)=>{
      const result=await this.analytics.query(query);const chosen=await dialog.showSaveDialog({title:'사용량 통계 내보내기',defaultPath:'codex-usage.csv',filters:[{name:'CSV',extensions:['csv']}]});
      if(chosen.canceled||!chosen.filePath)return null;
      await writeFileAtomic(chosen.filePath,analyticsCsv(result));return chosen.filePath;
    });
  }
  async dispose(){this.disposed=true;if(this.timer)clearInterval(this.timer);this.tray?.destroy();await this.login.cancel();await this.analytics.settle();await this.store.save();}
}
