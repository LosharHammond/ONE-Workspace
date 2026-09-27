'use client';
import {useState} from 'react';
import {api,useApi,ago,cx,dateOnly} from './lib';
import {useApp,Btn,Chip,Header,ErrorNote,Skeleton,Empty,Icon,Tabs} from './kit';

// Universal Work Inbox: approvals from every module (purchasing, projects, tasks, Studio apps, AI agents,
// connector actions, publishing and installation requests), assigned tasks and unread updates. Inline
// decisions go through each owning module's API, which re-checks the viewer's permissions.
type Item={id:string,source:string,kind:string,title:string,detail:string,link:string,since:string,due?:string|null,risk?:string,actionable?:string};
type Data={approvals:Item[],tasks:{id:string,title:string,due:string|null,overdue:boolean,priority:string,status:string,fromAutomation:boolean,link:string}[],updates:{id:string,kind:string,title:string,body:string,link:string,at:string}[],counts:{approvals:number,tasks:number,overdue:number,updates:number}};
async function decide(i:Item,approve:boolean){
 const [prefix,id]=[i.id.slice(0,i.id.indexOf(':')),i.id.slice(i.id.indexOf(':')+1)];
 switch(prefix){
  case 'stu':return api('/api/studio/records',{action:'decide',approvalId:id,approve,comment:''});
  case 'ai':return api('/api/agents',{action:approve?'approve':'reject',approvalId:id});
  case 'con':return api('/api/connectors/fabric',{action:approve?'confirm-action':'reject-action',runId:id});
  case 'pub':return api('/api/studio',{action:approve?'approve-publish':'reject-publish',id});
  case 'ins':return api('/api/connectors/fabric',{action:'decide-install',id,approve});
 }
 throw new Error('Open the item to decide.');
}
const INLINE=['stu','ai','con','pub','ins'];
export default function Inbox({parts=[]}:{parts?:string[]}){
 const {toast,refresh}=useApp();const {data,error,reload}=useApi<Data>('/api/inbox');const [tab,setTab]=useState(parts[0]||'approvals');const [busy,setBusy]=useState('');const [src,setSrc]=useState('');
 const act=async(i:Item,approve:boolean)=>{setBusy(i.id);try{await decide(i,approve);toast(approve?'Approved':'Rejected');reload();refresh()}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}};
 const sources=[...new Set((data?.approvals||[]).map(a=>a.source.split(' · ')[0]))];
 const approvals=(data?.approvals||[]).filter(a=>!src||a.source.startsWith(src));
 return <div className="page"><Header icon="Inbox" tone="violet" title="Inbox" subtitle="Everything waiting for you across the workspace."/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton rows={8}/>:<>
   <Tabs value={tab} onChange={setTab} items={[{id:'approvals',label:'Approvals',count:data.counts.approvals},{id:'tasks',label:'My tasks',count:data.counts.tasks},{id:'updates',label:'Updates',count:data.counts.updates}]}/>
   {tab==='approvals'&&<>{sources.length>1&&<div className="row-gap wrap"><button className={cx('chip',!src?'chip-violet':'chip-gray')} onClick={()=>setSrc('')}>All</button>{sources.map(s=><button key={s} className={cx('chip',src===s?'chip-violet':'chip-gray')} onClick={()=>setSrc(s)}>{s}</button>)}</div>}
    {!approvals.length?<Empty icon="CircleCheck" title="Nothing waiting for your decision"/>:<ul className="inbox-list">{approvals.map(i=><li key={i.id} className="inbox-item"><div className="inbox-main"><div className="row-gap"><Chip tone="gray">{i.source}</Chip>{i.risk&&<Chip tone={i.risk==='high'?'red':i.risk==='medium'?'amber':'gray'}>{i.risk} risk</Chip>}{i.due&&<Chip tone={i.due<new Date().toISOString()?'red':'amber'}>due {dateOnly(i.due)}</Chip>}<small className="muted">{ago(i.since)}</small></div><a href={i.link} className="inbox-title">{i.title}</a><small className="muted">{i.detail}</small></div>
     <div className="row-gap">{INLINE.includes(i.id.slice(0,i.id.indexOf(':')))&&<><Btn size="sm" variant="primary" icon="Check" busy={busy===i.id} onClick={()=>act(i,true)}>Approve</Btn><Btn size="sm" icon="X" disabled={busy===i.id} onClick={()=>act(i,false)}>Reject</Btn></>}<Btn size="sm" variant="ghost" icon="ArrowRight" onClick={()=>{location.hash=i.link}}>Open</Btn></div></li>)}</ul>}</>}
   {tab==='tasks'&&(!data.tasks.length?<Empty icon="ListTodo" title="No open tasks assigned to you"/>:<ul className="inbox-list">{data.tasks.map(t=><li key={t.id} className="inbox-item"><div className="inbox-main"><a href={t.link} className="inbox-title">{t.title}</a><div className="row-gap"><Chip tone="gray">{t.status}</Chip><Chip tone={t.priority==='Critical'||t.priority==='High'?'orange':'gray'}>{t.priority}</Chip>{t.due&&<Chip tone={t.overdue?'red':'gray'}>{t.overdue?'overdue · ':''}{dateOnly(t.due)}</Chip>}{t.fromAutomation&&<Chip tone="violet"><Icon name="Zap" size={11}/> automation</Chip>}</div></div></li>)}</ul>)}
   {tab==='updates'&&(!data.updates.length?<Empty icon="Bell" title="You are all caught up"/>:<ul className="inbox-list">{data.updates.map(n=><li key={n.id} className="inbox-item"><div className="inbox-main"><a href={n.link||'#/inbox'} className="inbox-title">{n.title}</a>{n.body&&<small className="muted">{n.body}</small>}<small className="muted">{ago(n.at)}</small></div></li>)}</ul>)}
  </>}
 </div>;
}
