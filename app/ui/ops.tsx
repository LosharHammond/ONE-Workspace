'use client';
import {useState} from 'react';
import {api,useApi,go,money,ago} from './lib';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,ErrorNote,Skeleton,Empty,KV,Note,type Col} from './kit';
import IT from '../it';
import Research from '../research';
import SourceDetail from '../source-detail';
import {statuses,descriptions,type Item} from '../data';

const meta:Record<string,[string,string,string]>={inventory:['Inventory','Package','Quantity'],receipts:['Goods receipts','Truck','Amount'],budgets:['Budgets','PiggyBank','Amount']};

export default function Operations({parts}:{parts:string[]}){
 const {s,can,refresh}=useApp();const view=parts[0]||['inventory','receipts','budgets','it','research'].find(p=>can(p))||'inventory';
 if(view==='it')return <div className="page"><Header icon="HardDrive" tone="slate" title="IT & CCTV storage" subtitle="Daily disk readings across your network video recorders."/><div className="legacy"><IT permissions={s.user.permissions.it}/></div></div>;
 if(view==='research')return <div className="page"><Header icon="FlaskConical" tone="indigo" title="Consumer research" subtitle="Interview and market-visit recordings with AI transcripts and research briefs."/><div className="legacy"><Research permissions={s.user.permissions.research} admin={s.user.role==='admin'} onAccessChanged={refresh}/></div></div>;
 return <Register module={view} openId={parts[1]}/>;
}

function Register({module,openId}:{module:string,openId?:string}){
 const {s,can,toast}=useApp();const {data,error,reload}=useApi<{records:Item[]}>('/api/workspace?module='+module);const [adding,setAdding]=useState(false);
 const [title,icon,amountLabel]=meta[module]||[module,'Circle','Amount'];
 const rows=data?.records||[];const open=rows.find(r=>r.id===openId);
 const cols:Col<Item>[]=[{key:'title',label:'Record',render:r=><div className="cell-title"><b>{r.title}</b><small>{r.reference||''}{r.sourceDataset?' · imported':''}</small></div>},{key:'department',label:'Department',width:160},{key:'status',label:'Status',width:140,render:r=><Chip>{r.status}</Chip>},{key:'owner',label:'Owner',width:170},{key:'amount',label:amountLabel,width:150,align:'right',render:r=>module==='inventory'?`${r.amount.toLocaleString()} ${r.unit||''}`:r.currency?`${r.amount.toLocaleString()} ${r.currency}`:money(r.amount,s.tenant.currency),value:r=>r.amount},{key:'details',label:'Details',hide:true},{key:'updated',label:'Updated',width:110,render:r=><span className="muted">{ago(r.updated)}</span>}];
 return <div className="page"><Header icon={icon} tone="slate" title={title} subtitle={descriptions[module]} actions={can(module,'create')&&statuses[module]&&<Btn variant="primary" icon="Plus" onClick={()=>setAdding(true)}>Add record</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id={'reg-'+module} rows={rows} cols={cols} exportName={module} onOpen={r=>go(`ops/${module}/${encodeURIComponent(r.id)}`)} empty={<Empty icon={icon} title="No records yet">Imported snapshots and records added here appear in this register.</Empty>}/>}
  {open&&<Inspector open onClose={()=>go(`ops/${module}`)} eyebrow={open.reference||open.id} title={open.title} subtitle={<Chip>{open.status}</Chip>}>
   <KV items={[['Department',open.department],['Owner',open.owner],[amountLabel,module==='inventory'?`${open.amount.toLocaleString()} ${open.unit||''}`:money(open.amount,open.currency||s.tenant.currency)],['Updated',ago(open.updated)],['Notes',open.details]]}/>
   {open.sourceId&&<Note>Imported snapshot from {open.sourceName}. Changes in the source system need a new import.</Note>}
   {open.sourceId&&can('company-data')&&<div className="legacy"><SourceDetail id={open.sourceId}/></div>}
  </Inspector>}
  {adding&&<AddRecord module={module} onClose={()=>setAdding(false)} onDone={()=>{setAdding(false);reload();toast('Record added')}}/>}
 </div>;
}
function AddRecord({module,onClose,onDone}:{module:string,onClose:()=>void,onDone:()=>void}){
 const {s,toast}=useApp();const [v,setV]=useState({title:'',department:s.user.department,owner:'',amount:'0',details:''});const [busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title="Add record" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{await api('/api/records',{module,...v,amount:Number(v.amount)});onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Add</Btn></>}><div className="form-grid"><Field label="Name" wide><input value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field><Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field><Field label="Owner / team"><input value={v.owner} onChange={e=>setV({...v,owner:e.target.value})}/></Field><Field label={module==='inventory'?'Quantity':'Amount'}><input type="number" min="0" step={module==='inventory'?1:0.01} value={v.amount} onChange={e=>setV({...v,amount:e.target.value})}/></Field><Field label="Notes" wide><textarea rows={3} value={v.details} onChange={e=>setV({...v,details:e.target.value})}/></Field></div></Modal>;
}
