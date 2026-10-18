import { useId, type ReactNode } from 'react';

export function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {
  return <label className={`sw-field${wide?' sw-wide':''}`}><span>{label}</span>{children}</label>;
}
export function TextField({label,value,onChange,area=false}:{label:string;value:string;onChange:(value:string)=>void;area?:boolean}) {
  const id=useId();
  return <div className="sw-field"><label htmlFor={id}>{label}</label>{area
    ? <textarea id={id} value={value} onChange={event=>onChange(event.target.value)} rows={3}/>
    : <input id={id} value={value} onChange={event=>onChange(event.target.value)}/>}</div>;
}
