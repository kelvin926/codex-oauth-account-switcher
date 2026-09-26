import { useState } from 'react';
import type { AccountRecord } from '../../../core/types';
import type { ResetDetails } from '../../../shared/features';
export function AccountExtras({account,demo,onChanged,onLogin}:{account:AccountRecord;demo:boolean;onChanged:()=>void;onLogin:()=>void}){
  const [details,setDetails]=useState<ResetDetails|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function run(action:()=>Promise<void>){if(demo){setMessage('데모에서는 실제 계정을 변경하지 않습니다.');return;}setBusy(true);setMessage('');try{await action();onChanged();}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <details className="account-extras"><summary>계정 설정과 초기화권</summary><fieldset disabled={busy}>
    <label>추천 우선순위<select value={account.priority??0} onChange={e=>void run(()=>window.desktopApi.setAccountPreference(account.id,{priority:Number(e.target.value),excluded:account.excluded??false}))}><option value={2}>가장 먼저</option><option value={1}>먼저</option><option value={0}>보통</option><option value={-1}>나중에</option><option value={-2}>예비 계정</option></select></label>
    <label className="checkbox-label"><input type="checkbox" checked={account.excluded??false} onChange={e=>void run(()=>window.desktopApi.setAccountPreference(account.id,{priority:account.priority??0,excluded:e.target.checked}))}/> 추천에서 제외</label>
    <p className="muted">우선순위는 설정의 ‘지정 계정 우선’ 방식에서 적용됩니다.</p>
    <div className="toolbar"><button className="ghost-button" onClick={onLogin}>이 계정 다시 로그인</button><button className="secondary-button" onClick={()=>void run(async()=>setDetails(await window.desktopApi.inspectResetCredits(account.id)))}>초기화권 상세 조회</button></div>
    {details&&<div className="reset-details"><p>사용 가능: <b>{details.available===null?'확인 불가':`${details.available}개`}</b></p>
      <p className="muted">상세 목록은 서버가 일부만 제공할 수 있습니다.</p>
      <ul>{details.credits.map(c=><li key={c.id}><b>{c.title??'초기화권'}</b><span>만료: {c.expiresAt?new Date(c.expiresAt).toLocaleString():'미제공'}</span><span>지급: {c.grantedAt?new Date(c.grantedAt).toLocaleString():'미제공'}</span></li>)}</ul>
      {details.message&&<p role="status">{details.message}</p>}
      <button className="danger-button" disabled={details.pending||!details.available} onClick={()=>void run(async()=>setDetails(await window.desktopApi.consumeResetCredit(account.id)))}>초기화권 1개 사용</button>
    </div>}
    {message&&<p role="status" className="error-copy">{message}</p>}
  </fieldset></details>;
}
