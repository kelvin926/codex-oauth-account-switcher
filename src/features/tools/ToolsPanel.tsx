import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Diagnostic, type FeatureState, type FeatureSettings } from '../../shared/features';
export function ToolsPanel({demo,onChanged}:{demo:boolean;onChanged:()=>void}){
  const [state,setState]=useState<FeatureState>({settings:{...DEFAULT_SETTINGS},progress:null,operations:[],login:{status:'idle',message:''}});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[diagnostics,setDiagnostics]=useState<Diagnostic[]>([]);
  useEffect(()=>{if(demo)return;let active=true;const poll=()=>{void window.desktopApi.getFeatures().then(s=>{if(active)setState(s);}).catch(()=>{});};poll();const timer=setInterval(poll,2000);return()=>{active=false;clearInterval(timer);};},[demo]);
  async function save(patch:Partial<FeatureSettings>){setBusy(true);try{if(!demo)setState(await window.desktopApi.setFeatureSettings({...state.settings,...patch}));else setState({...state,settings:{...state.settings,...patch}});onChanged();}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="feature-panel"><h2>설정과 진단</h2><fieldset disabled={busy} className="settings-grid">
    <label><input type="checkbox" checked={state.settings.tray} onChange={e=>void save({tray:e.target.checked})}/> 창을 닫으면 트레이에 유지</label>
    <label><input type="checkbox" checked={state.settings.notifications} onChange={e=>void save({notifications:e.target.checked})}/> 잔여량 부족 및 한도 복구 알림</label>
    <label><input type="checkbox" checked={state.settings.forecastEnabled} onChange={e=>void save({forecastEnabled:e.target.checked})}/> Lunarwerx 소식 자동 갱신 (5분)</label>
    <label><input type="checkbox" checked={state.settings.forecastNotifications} onChange={e=>void save({forecastNotifications:e.target.checked})}/> 새 초기화 기록, 공지, 예상 지수 알림</label>
    <label>24시간 초기화 예상 알림 기준<select value={state.settings.forecastThreshold} onChange={e=>void save({forecastThreshold:Number(e.target.value)})}>{[50,60,70,80,90].map(n=><option value={n} key={n}>{n}% 이상으로 상승</option>)}</select></label>
    <label>사용량 자동 갱신<select value={state.settings.refreshMinutes} onChange={e=>void save({refreshMinutes:Number(e.target.value)})}>{[0,1,2,5,10,15].map(n=><option value={n} key={n}>{n?`${n}분`:'끔'}</option>)}</select></label>
    <label>잔여량 알림 기준<select value={state.settings.lowRemaining} onChange={e=>void save({lowRemaining:Number(e.target.value)})}>{[5,10,20,30].map(n=><option value={n} key={n}>{n}% 이하</option>)}</select></label>
    <label>추천 방식<select value={state.settings.strategy} onChange={e=>void save({strategy:e.target.value as FeatureSettings['strategy']})}><option value="remaining">잔여 용량 우선</option><option value="reset-first">초기화 임박 우선</option><option value="priority">지정 계정 우선</option></select></label>
  </fieldset><p className="muted">로컬 토큰 기록은 앱 실행 중 30초 간격으로 수집합니다. 서버 사용량 갱신을 끄면 주간 한도 추정과 알림은 수동 갱신 시에만 업데이트됩니다.</p>
    <div className="toolbar"><button className="secondary-button" disabled={busy||demo} onClick={async()=>{setBusy(true);try{setDiagnostics(await window.desktopApi.diagnose());}catch(e){setMessage(String(e));}finally{setBusy(false);}}}>설치와 인증 진단</button><button className="ghost-button" disabled={busy||demo} onClick={async()=>{setBusy(true);try{await window.desktopApi.recoverLastSwitch();setMessage('복구 요청을 처리했습니다. 현재 인증은 진단에서 확인하세요.');onChanged();}catch(e){setMessage(String(e));}finally{setBusy(false);}}}>마지막 전환 복구</button></div>
    {message&&<p role="status">{message}</p>}
    {diagnostics.length>0&&<ul className="diagnostics">{diagnostics.map((d,i)=><li key={i}><b>{d.ok?'정상':'확인 필요'}: {d.name}</b><span>{d.detail}</span></li>)}</ul>}
    <h3>최근 작업 기록</h3><div className="table-scroll"><table><thead><tr><th>시각</th><th>단계</th><th>결과</th><th>설명</th></tr></thead><tbody>{state.operations.map((op,i)=><tr key={i}><td>{new Date(op.at).toLocaleString()}</td><td>{op.stage}</td><td>{op.ok?'완료':'오류'}</td><td>{op.message}</td></tr>)}{!state.operations.length&&<tr><td colSpan={4}>아직 작업 기록이 없습니다.</td></tr>}</tbody></table></div>
  </section>;
}
