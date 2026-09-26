import { useId, useState, type ReactNode } from 'react';
export function Help({label,children}:{label:string;children:ReactNode}) {
  const id=useId(),[open,setOpen]=useState(false);
  return <span className="help" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
    <button type="button" className="help-button" aria-label={`${label} 도움말`} aria-describedby={open?id:undefined}
      onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>setOpen(true)} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>?</button>
    {open&&<span className="help-tooltip" role="tooltip" id={id}>{children}</span>}
  </span>;
}
export function Disclosure({title,children}:{title:string;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}</summary>{open&&children}</details>;
}
