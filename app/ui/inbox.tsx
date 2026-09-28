'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {api,useApi,ago,cx,dateOnly,pref,setPref} from './lib';
import {useApp,Btn,Chip,Header,Field,ErrorNote,Skeleton,Empty,Icon,Modal,Card,PersonSelect,TagPicker,Note} from './kit';

// Universal Work Inbox. Items are projections of work in other modules; every action below is carried out by
// the source module with your own permissions, after checking that the item has not changed since you opened it.
type Item={id:string,sourceModule:string,sourceType:string,sourceId:string,url:string,version:string,type:string,title:string,description:string,priority:string,score:number,evidence:string[],businessImpact:string,amount:number|null,currency:string,status:string,dueAt:string|null,slaAt:string|null,overdue:boolean,slaBreached:boolean,assignerId:string|null,actions:string[],department:string,projectId:string|null,read:boolean,snoozedUntil:string|null,delegatedFrom:string|null,escalatedFrom:string|null,escalationLevel:number,completedAt:string|null,completion:Record<string,unknown>,createdAt:string,recipientId?:string};
type Counts={all:number,unread:number,approvals:number,tasks:number,mentions:number,messages:number,alerts:number,overdue:number,delegated:number,snoozed:number};
type List={total:number,page:number,size:number,items:Item[],counts:Counts};
type Ai={mode:string,summary:string,ranking:{id:string,rank:number,title:string,reason:string,evidence:string[],url:string}[],groups:{title:string,ids:string[]}[],blocked:{id:string,reason:string}[],nextActions:{id:string,action:string}[],note:string};
export const inboxViews=[{id:'attention',label:'My attention',icon:'Sparkles'},{id:'all',label:'All open',icon:'Inbox'},{id:'approvals',label:'Waiting for my approval',icon:'Stamp'},{id:'tasks',label:'Assigned to me',icon:'ListTodo'},{id:'mentions',label:'Mentions',icon:'AtSign'},{id:'messages',label:'Messages',icon:'MessageSquare'},{id:'alerts',label:'Alerts',icon:'BellRing'},{id:'overdue',label:'Overdue',icon:'AlarmClock',section:'Timing'},{id:'today',label:'Due today',icon:'CalendarCheck',section:'Timing'},{id:'week',label:'Due this week',icon:'CalendarRange',section:'Timing'},{id:'high',label:'High impact',icon:'Flame',section:'Impact'},{id:'financial',label:'Financial',icon:'Banknote',section:'Impact'},{id:'delegated',label:'Delegated to me',icon:'UserCheck',section:'Delegation'},{id:'delegated-by-me',label:'Delegated by me',icon:'Forward',section:'Delegation'},{id:'delegations',label:'Delegation & absence',icon:'CalendarOff',section:'Delegation'},{id:'snoozed',label:'Snoozed',icon:'Clock',section:'Later'},{id:'completed',label:'Completed',icon:'CircleCheck',section:'Later'},{id:'department',label:'Department inbox',icon:'Building2',section:'Teams'},{id:'team',label:'My team',icon:'Users',section:'Teams'}];
const TYPE_LABEL:Record<string,string>={approval:'Approval',ai_approval:'AI action',connector_action:'External action',task:'Task',milestone:'Milestone',ticket:'Ticket',maintenance:'Maintenance',mention:'Mention',message:'Message',alert:'Alert',exception:'Exception',acknowledgement:'Acknowledge',receipt:'Goods receipt',review:'Review',check_in:'Check-in',contract:'Contract',assignment:'Assignment',lifecycle_stage:'Request stage',risk:'Risk',issue:'Issue',question:'Question',ai_suggestion:'AI suggestion'};
const PRIO_TONE:Record<string,string>={critical:'red',high:'orange',normal:'gray',low:'gray'};
const COLUMNS=[['type','Type'],['module','Module'],['due','Due'],['amount','Amount'],['score','Impact'],['from','From']] as const;
const ACTION_LABEL:Record<string,[string,string]>={approve:['Approve','Check'],reject:['Reject','X'],request_changes:['Request changes','Undo2'],complete:['Complete','CircleCheck'],complete_stage:['Complete stage','CircleCheck'],acknowledge:['Acknowledge','ThumbsUp'],assign:['Assign','UserPlus'],reassign:['Reassign','UserCog'],delegate:['Delegate','Forward'],escalate:['Escalate','TrendingUp'],comment:['Comment','MessageSquare'],reply:['Reply','Reply'],follow_up:['Follow-up task','ListPlus'],retry:['Retry','RotateCcw'],check_in:['Check in','Gauge']};

export default function Inbox({parts=[]}:{parts?:string[]}){
 const view=parts[0]||'attention';
 if(view==='delegations')return <Delegations/>;
 if(view==='department'||view==='team')return <TeamInbox kind={view}/>;
 return <InboxList view={view} openId={parts[1]}/>;
}
function InboxList({view,openId}:{view:string,openId?:string}){
 const {toast,person,refresh}=useApp();
 const [q,setQ]=useState('');const [type,setType]=useState('');const [module,setModule]=useState('');const [priority,setPriority]=useState('');const [sort,setSort]=useState<string>(()=>pref('inboxSort','rules'));const [group,setGroup]=useState<string>(()=>pref('inboxGroup','none'));
 const [cols,setCols]=useState<string[]>(()=>pref('inboxCols',['type','module','due','amount','score']));const [page,setPage]=useState(1);
 const url=`/api/inbox?view=${view}&q=${encodeURIComponent(q)}&type=${type}&module=${module}&priority=${priority}&sort=${sort==='ai'?'rules':sort}&page=${page}&size=50`;
 const {data,error,reload}=useApi<List>(url);
 const [sel,setSel]=useState<Set<string>>(new Set());const [cursor,setCursor]=useState(0);const [open,setOpen]=useState<string|null>(openId||null);const [ai,setAi]=useState<Ai|null>(null);const [aiBusy,setAiBusy]=useState(false);
 useEffect(()=>{setPref('inboxSort',sort);setPref('inboxGroup',group);setPref('inboxCols',cols)},[sort,group,cols]);
 // Changing the filters clears the selection and the keyboard cursor (adjusted during render, not in an effect).
 const filterKey=[view,q,type,module,priority,sort].join('|');const [lastFilter,setLastFilter]=useState(filterKey);
 if(filterKey!==lastFilter){setLastFilter(filterKey);setSel(new Set());setCursor(0)}
 const aiOrder=useMemo(()=>new Map((ai?.ranking||[]).map(r=>[r.id,r])),[ai]);
 const items=useMemo(()=>{const l=[...(data?.items||[])];if(sort==='ai'&&ai)l.sort((a,b)=>(aiOrder.get(a.id)?.rank??999)-(aiOrder.get(b.id)?.rank??999));return l},[data,sort,ai,aiOrder]);
 const groups=useMemo(()=>{if(group==='none')return [{key:'',items}];const k=(i:Item)=>group==='module'?i.sourceModule:group==='type'?TYPE_LABEL[i.type]||i.type:group==='priority'?i.priority:i.overdue?'Overdue':!i.dueAt?'No due date':i.dueAt.slice(0,10)===new Date().toISOString().slice(0,10)?'Due today':'Later';const m=new Map<string,Item[]>();for(const i of items)m.set(k(i),[...(m.get(k(i))||[]),i]);return [...m.entries()].map(([key,items])=>({key,items}))},[items,group]);
 const flat=groups.flatMap(g=>g.items);
 const bulk=async(action:string,extra:Record<string,unknown>={})=>{try{const r=await api<{count:number}>('/api/inbox',{action,ids:[...sel],...extra});toast(`${r.count} item${r.count===1?'':'s'} updated`);setSel(new Set());reload();refresh()}catch(e){toast((e as Error).message,'error')}};
 const runAi=async()=>{setAiBusy(true);try{setAi(await api<Ai>('/api/inbox',{action:'ai-prioritize'}));setSort('ai')}catch(e){toast((e as Error).message,'error')}finally{setAiBusy(false)}};
 // Keyboard: j/k move, Enter opens, x selects, e completes, u toggles read, s snoozes a day, / searches.
 const listRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{const f=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(/INPUT|TEXTAREA|SELECT/.test(t.tagName)||open)return;const cur=flat[cursor];
  if(e.key==='j'){setCursor(c=>Math.min(flat.length-1,c+1));e.preventDefault()}else if(e.key==='k'){setCursor(c=>Math.max(0,c-1));e.preventDefault()}
  else if(e.key==='Enter'&&cur){setOpen(cur.id)}else if(e.key==='x'&&cur){setSel(s=>{const n=new Set(s);if(n.has(cur.id))n.delete(cur.id);else n.add(cur.id);return n})}
  else if(e.key==='u'&&cur){api('/api/inbox',{action:cur.read?'unread':'read',ids:[cur.id]}).then(reload)}else if(e.key==='s'&&cur){api('/api/inbox',{action:'snooze',ids:[cur.id],until:new Date(Date.now()+86400000).toISOString()}).then(()=>{toast('Snoozed until tomorrow');reload()})}
  else if(e.key==='e'&&cur&&cur.actions.includes('complete')){api('/api/inbox',{action:'complete',id:cur.id,version:cur.version}).then(()=>{toast('Completed');reload();refresh()}).catch(err=>toast((err as Error).message,'error'))}
  else if(e.key==='/'){e.preventDefault();(document.getElementById('inbox-search') as HTMLInputElement|null)?.focus()}};
  window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[flat,cursor,open,reload,refresh,toast]);
 useEffect(()=>{listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({block:'nearest'})},[cursor]);
 const label=inboxViews.find(v=>v.id===view)?.label||'Inbox';const c=data?.counts;
 const info=['alert','mention','message','assignment','notification','exception','contract','review','receipt','check_in'];
 return <div className="page inbox-page"><Header icon="Inbox" tone="violet" title={label} subtitle={c?`${c.all} open · ${c.approvals} approvals · ${c.overdue} overdue · ${c.unread} unread`:'Everything waiting for you across the workspace.'} actions={<Btn icon="Sparkles" busy={aiBusy} onClick={runAi}>AI prioritise</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {ai&&<Card title="AI prioritisation" actions={<Btn size="sm" variant="ghost" icon="X" title="Hide" onClick={()=>{setAi(null);if(sort==='ai')setSort('rules')}}/>}><p>{ai.summary}</p><Note>{ai.note}</Note>
   {ai.groups.length>0&&<p className="small"><b>Related items:</b> {ai.groups.map(g=>`${g.title} (${g.ids.length})`).join(' · ')}</p>}
   {ai.blocked.length>0&&<p className="small"><b>Blocked:</b> {ai.blocked.map(b=>`${flat.find(i=>i.id===b.id)?.title||''} — ${b.reason}`).join('; ')}</p>}
   <ol className="ai-rank">{ai.ranking.slice(0,7).map(r=><li key={r.id}><button className="link" onClick={()=>setOpen(r.id)}><b>{r.title}</b></button><small>{r.reason}</small><details><summary className="small muted">Evidence</summary><ul className="small">{r.evidence.map((e,i)=><li key={i}>{e}</li>)}</ul></details>{ai.nextActions.find(n=>n.id===r.id)&&<small className="muted">Suggested next step: {ai.nextActions.find(n=>n.id===r.id)!.action}</small>}</li>)}</ol></Card>}
  <div className="toolbar inbox-toolbar"><input id="inbox-search" type="search" placeholder="Search (/)…" value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} aria-label="Search the inbox"/>
   <select aria-label="Type" value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   <select aria-label="Module" value={module} onChange={e=>setModule(e.target.value)}><option value="">All modules</option>{['purchasing','projects','tasks','tickets','maintenance','lifecycle','strategy','knowledge','studio','agents','connectors','inventory','spaces','notifications','business'].map(m=><option key={m}>{m}</option>)}</select>
   <select aria-label="Priority" value={priority} onChange={e=>setPriority(e.target.value)}><option value="">Any priority</option>{['critical','high','normal','low'].map(p=><option key={p}>{p}</option>)}</select>
   <select aria-label="Order" value={sort} onChange={e=>{if(e.target.value==='ai'&&!ai)runAi();else setSort(e.target.value)}}><option value="rules">Rule-based ordering</option><option value="due">Due date</option><option value="priority">Priority</option><option value="ai">AI-recommended</option><option value="newest">Newest</option><option value="amount">Financial impact</option></select>
   <select aria-label="Group by" value={group} onChange={e=>setGroup(e.target.value)}><option value="none">No grouping</option><option value="module">Group by module</option><option value="type">Group by type</option><option value="priority">Group by priority</option><option value="due">Group by due date</option></select>
   <details className="cols-menu"><summary className="btn btn-sm"><Icon name="Columns3" size={14}/>Columns</summary><div className="cols-pop">{COLUMNS.map(([k,l])=><label key={k} className="check"><input type="checkbox" checked={cols.includes(k)} onChange={e=>setCols(e.target.checked?[...cols,k]:cols.filter(x=>x!==k))}/>{l}</label>)}</div></details>
  </div>
  {sel.size>0&&<div className="bulk-bar"><b>{sel.size} selected</b><Btn size="sm" onClick={()=>bulk('read')}>Mark read</Btn><Btn size="sm" onClick={()=>bulk('unread')}>Mark unread</Btn><Btn size="sm" onClick={()=>bulk('snooze',{until:new Date(Date.now()+86400000).toISOString()})}>Snooze 1 day</Btn>{view==='snoozed'&&<Btn size="sm" onClick={()=>bulk('unsnooze')}>Unsnooze</Btn>}{[...sel].every(id=>info.includes(flat.find(i=>i.id===id)?.type||''))&&<Btn size="sm" onClick={()=>bulk('dismiss')}>Dismiss</Btn>}<Btn size="sm" variant="ghost" onClick={()=>setSel(new Set())}>Clear</Btn><small className="muted">Approvals and tasks are acted on one at a time.</small></div>}
  {!data?<Skeleton rows={8}/>:!flat.length?<Empty icon="CircleCheck" title="Nothing here">You are all caught up in this view.</Empty>:
   <div className="inbox-table" ref={listRef} role="grid" aria-label={label}>
    {groups.map(g=><div key={g.key}>{g.key&&<p className="rail-section">{g.key} <span className="muted">({g.items.length})</span></p>}
     {g.items.map(i=>{const idx=flat.indexOf(i);return <div key={i.id} data-row={idx} role="row" aria-selected={idx===cursor} className={cx('inbox-row',!i.read&&'unread',idx===cursor&&'cursor')} onClick={()=>{setCursor(idx);setOpen(i.id)}}>
      <input type="checkbox" aria-label="Select" checked={sel.has(i.id)} onClick={e=>e.stopPropagation()} onChange={e=>setSel(s=>{const n=new Set(s);if(e.target.checked)n.add(i.id);else n.delete(i.id);return n})}/>
      <span className={cx('prio-dot',`tone-${PRIO_TONE[i.priority]||'gray'}`)} title={`${i.priority} priority`}/>
      <div className="inbox-main"><span className="inbox-title">{i.title}</span><small className="muted">{i.description}{i.delegatedFrom?` · on behalf of ${person(i.delegatedFrom)?.name||'a colleague'}`:''}{i.escalatedFrom?' · escalated':''}{sort==='ai'&&aiOrder.get(i.id)?` · ${aiOrder.get(i.id)!.reason}`:''}</small></div>
      {cols.includes('type')&&<Chip tone="gray">{TYPE_LABEL[i.type]||i.type}</Chip>}
      {cols.includes('module')&&<small className="muted col-module">{i.sourceModule}</small>}
      {cols.includes('due')&&<small className={cx('col-due',i.overdue&&'overdue')}>{i.dueAt?(i.overdue?'Overdue · ':'')+dateOnly(i.dueAt):view==='completed'&&i.completedAt?`Done ${ago(i.completedAt)}`:'—'}{i.slaBreached&&<Chip tone="red">SLA</Chip>}</small>}
      {cols.includes('amount')&&<small className="col-amount">{i.amount?`${i.currency} ${Math.round(i.amount).toLocaleString()}`:''}</small>}
      {cols.includes('score')&&<small className="col-score" title={i.evidence.join('\n')}>{i.score}</small>}
      {cols.includes('from')&&<small className="muted">{i.assignerId?person(i.assignerId)?.name||'':''}</small>}
     </div>})}</div>)}
    {data.total>data.size&&<div className="row-gap pager"><Btn size="sm" disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</Btn><span className="muted small">Page {page} of {Math.ceil(data.total/data.size)}</span><Btn size="sm" disabled={page*data.size>=data.total} onClick={()=>setPage(page+1)}>Next</Btn></div>}
    <p className="muted small kbd-hint">Keys: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>Enter</kbd> open · <kbd>x</kbd> select · <kbd>e</kbd> complete · <kbd>u</kbd> read/unread · <kbd>s</kbd> snooze · <kbd>/</kbd> search</p>
   </div>}
  {open&&<ItemPanel id={open} onClose={()=>setOpen(null)} onDone={()=>{setOpen(null);reload();refresh()}}/>}
 </div>;
}
function ItemPanel({id,onClose,onDone}:{id:string,onClose:()=>void,onDone:()=>void}){
 const {toast,person}=useApp();const {data,error}=useApi<{item:Item,history:{action:string,actorId:string,createdAt:string}[],currentVersion:string}>(`/api/inbox?id=${id}`);
 const [form,setForm]=useState<string|null>(null);const [comment,setComment]=useState('');const [who,setWho]=useState<string|null>(null);const [when,setWhen]=useState('');const [busy,setBusy]=useState(false);const [title,setTitle]=useState('');
 if(error)return <Modal open onClose={onClose} title="Inbox item"><ErrorNote error={error}/></Modal>;
 if(!data)return <Modal open onClose={onClose} title="Loading…"><Skeleton rows={4}/></Modal>;
 const i=data.item;const stale=i.version&&data.currentVersion&&i.version!==data.currentVersion;
 const act=async(action:string,extra:Record<string,unknown>={})=>{setBusy(true);try{await api('/api/inbox',{action,id:i.id,version:data.currentVersion,comment,...extra});toast('Done');onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}};
 const personal=async(action:string,extra:Record<string,unknown>={})=>{try{await api('/api/inbox',{action,ids:[i.id],...extra});toast('Updated');onDone()}catch(e){toast((e as Error).message,'error')}};
 const needsComment=['reject','request_changes','comment','reply','escalate'].includes(form||'');
 return <Modal open wide onClose={onClose} title={i.title} subtitle={`${TYPE_LABEL[i.type]||i.type} · ${i.sourceModule}${i.dueAt?` · due ${dateOnly(i.dueAt)}`:''}`}>
  {stale&&<Note tone="warn">The source changed after this item was produced. It will refresh; review the source before acting.</Note>}
  <p>{i.description}</p>
  <div className="row-gap wrap"><Chip tone={PRIO_TONE[i.priority]||'gray'}>{i.priority}</Chip>{i.amount?<Chip tone="gray">{i.currency} {Math.round(i.amount).toLocaleString()}</Chip>:null}{i.businessImpact&&<Chip tone="violet">{i.businessImpact}</Chip>}{i.delegatedFrom&&<Chip tone="amber">On behalf of {person(i.delegatedFrom)?.name||'a colleague'}</Chip>}{i.slaBreached&&<Chip tone="red">SLA breached</Chip>}</div>
  <details className="small"><summary>Why it is ranked here (impact {i.score})</summary><ul>{i.evidence.map((e,n)=><li key={n}>{e}</li>)}</ul></details>
  <div className="row-gap wrap inbox-actions">{i.actions.filter(a=>ACTION_LABEL[a]).map(a=><Btn key={a} size="sm" variant={a==='approve'||a==='complete'?'primary':'default'} icon={ACTION_LABEL[a][1]} busy={busy&&form===a} onClick={()=>{if(['approve','complete','acknowledge','complete_stage','retry'].includes(a)&&!['approve'].includes(form||'x'))setForm(a);else setForm(a)}}>{ACTION_LABEL[a][0]}</Btn>)}
   {i.url&&<Btn size="sm" icon="ExternalLink" onClick={()=>{location.hash=i.url}}>Open source</Btn>}
   {i.actions.includes('check_in')&&<Btn size="sm" icon="Gauge" onClick={()=>{location.hash=i.url}}>Check in</Btn>}</div>
  {form&&<Card title={ACTION_LABEL[form]?.[0]||form}>
   {['assign','reassign','delegate'].includes(form)&&<Field label={form==='delegate'?'Delegate to':'Assign to'}><PersonSelect value={who} onChange={setWho}/></Field>}
   {form==='delegate'&&<Field label="Until"><input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></Field>}
   {form==='follow_up'&&<><Field label="Task title"><input value={title} placeholder={`Follow up: ${i.title}`} onChange={e=>setTitle(e.target.value)}/></Field><Field label="Due"><input type="date" value={when} onChange={e=>setWhen(e.target.value)}/></Field></>}
   <Field label={needsComment?'Comment (required)':'Comment (optional)'}><textarea rows={3} value={comment} onChange={e=>setComment(e.target.value)}/></Field>
   {['reply','comment'].includes(form)&&<Btn size="sm" variant="ghost" icon="Sparkles" onClick={async()=>{try{const r=await api<{draft:string}>('/api/inbox',{action:'ai-draft',id:i.id});setComment(r.draft);toast('AI draft added — review before sending')}catch(e){toast((e as Error).message,'error')}}}>Draft with AI</Btn>}
   <div className="row-gap"><Btn variant="primary" busy={busy} disabled={(needsComment&&!comment.trim())||(['assign','reassign','delegate'].includes(form)&&!who)} onClick={()=>act(form,{assigneeId:who,delegateId:who,endsAt:when?new Date(when).toISOString():undefined,title:title||undefined,dueDate:form==='follow_up'?when||undefined:undefined})}>Confirm</Btn><Btn variant="ghost" onClick={()=>setForm(null)}>Cancel</Btn></div>
  </Card>}
  <div className="row-gap wrap"><span className="muted small">Later:</span>{[['1 hour',3600],['Tomorrow',86400],['Next week',604800]].map(([l,s])=><Btn key={String(l)} size="sm" variant="ghost" icon="Clock" onClick={()=>personal('snooze',{until:new Date(Date.now()+Number(s)*1000).toISOString()})}>{l}</Btn>)}
   <input type="datetime-local" aria-label="Remind me at" onChange={e=>{if(e.target.value)personal('remind',{until:new Date(e.target.value).toISOString()})}}/>
   <Btn size="sm" variant="ghost" onClick={()=>personal('unread')}>Mark unread</Btn>{['alert','mention','message','assignment','exception','contract','review','receipt','check_in'].includes(i.type)&&<Btn size="sm" variant="ghost" onClick={()=>personal('dismiss')}>Dismiss</Btn>}</div>
  {data.history.length>0&&<details className="small"><summary>Activity</summary><ul>{data.history.map((h,n)=><li key={n}>{h.action.replace(/_/g,' ')} · {person(h.actorId)?.name||''} · {ago(h.createdAt)}</li>)}</ul></details>}
 </Modal>;
}
function Delegations(){
 const {toast,person,s}=useApp();const {data,error,reload}=useApi<{delegations:{id:string,delegatorId:string,delegateId:string,modules:string[],itemTypes:string[],source:{type:string,id:string}|null,startsAt:string,endsAt:string,reason:string,outOfOffice:boolean,status:string,active:boolean}[],policy:{allowDelegation:boolean,maxDays:number,nonDelegableTypes:string[],nonDelegableAbove:number|null}}>('/api/inbox?view=delegations');
 const [v,setV]=useState(()=>({delegateId:null as string|null,delegatorId:null as string|null,modules:[] as string[],itemTypes:[] as string[],startsAt:new Date().toISOString().slice(0,16),endsAt:new Date(Date.now()+7*86400000).toISOString().slice(0,16),reason:'',outOfOffice:true}));const [busy,setBusy]=useState(false);
 const save=async()=>{setBusy(true);try{await api('/api/inbox',{action:'delegation-create',...v,startsAt:new Date(v.startsAt).toISOString(),endsAt:new Date(v.endsAt).toISOString(),delegatorId:v.delegatorId||undefined});toast('Delegation saved');reload()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}};
 return <div className="page"><Header icon="CalendarOff" tone="violet" title="Delegation & absence" subtitle="Let a colleague act on your approvals and work while you are away. Every action they take is recorded as on your behalf."/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&!data.policy.allowDelegation&&<Note tone="warn">Your company has switched delegation off.</Note>}
  {data&&<Note>Policy: up to {data.policy.maxDays} days{data.policy.nonDelegableAbove!=null?`; approvals above ${data.policy.nonDelegableAbove.toLocaleString()} cannot be delegated`:''}{data.policy.nonDelegableTypes.length?`; never delegable: ${data.policy.nonDelegableTypes.join(', ')}`:''}. Delegates need the same approval permission; chains and circular delegation are refused.</Note>}
  <Card title="New delegation"><div className="form-grid">
   {s.user.role==='admin'&&<Field label="Covering for (administrators only)"><PersonSelect value={v.delegatorId} onChange={x=>setV({...v,delegatorId:x})} placeholder="Me"/></Field>}
   <Field label="Delegate"><PersonSelect value={v.delegateId} onChange={x=>setV({...v,delegateId:x})}/></Field>
   <Field label="From"><input type="datetime-local" value={v.startsAt} onChange={e=>setV({...v,startsAt:e.target.value})}/></Field><Field label="Until"><input type="datetime-local" value={v.endsAt} onChange={e=>setV({...v,endsAt:e.target.value})}/></Field>
   <Field label="Modules" hint="Empty = all modules"><TagPicker values={v.modules} options={['purchasing','procurement','lifecycle','studio','projects','tasks','tickets','strategy','knowledge']} onChange={x=>setV({...v,modules:x})} placeholder="All modules"/></Field>
   <Field label="Item types" hint="Empty = all"><TagPicker values={v.itemTypes} options={['approval','task','ticket','review','maintenance','lifecycle_stage']} onChange={x=>setV({...v,itemTypes:x})} placeholder="All types"/></Field>
   <Field label="Reason" wide><input value={v.reason} onChange={e=>setV({...v,reason:e.target.value})} placeholder="e.g. Annual leave"/></Field>
   <label className="check"><input type="checkbox" checked={v.outOfOffice} onChange={e=>setV({...v,outOfOffice:e.target.checked})}/>Out of office</label>
  </div><Btn variant="primary" busy={busy} disabled={!v.delegateId} onClick={save}>Save delegation</Btn></Card>
  {!data?<Skeleton/>:!data.delegations.length?<Empty icon="CalendarOff" title="No delegations"/>:<div className="lb-table"><table className="plain"><thead><tr><th>Covering for</th><th>Delegate</th><th>Scope</th><th>Period</th><th>Status</th><th/></tr></thead><tbody>{data.delegations.map(d=><tr key={d.id}><td>{person(d.delegatorId)?.name||d.delegatorId}</td><td>{person(d.delegateId)?.name||d.delegateId}</td><td className="small">{d.source?`One item (${d.source.type})`:[d.modules.join(', ')||'All modules',d.itemTypes.join(', ')||'all types'].join(' · ')}{d.reason&&<><br/><span className="muted">{d.reason}</span></>}</td><td className="small">{dateOnly(d.startsAt)} → {dateOnly(d.endsAt)}</td><td><Chip tone={d.active?'green':'gray'}>{d.active?'active':d.status}</Chip></td><td>{d.status==='active'&&<Btn size="sm" variant="ghost" onClick={async()=>{try{await api('/api/inbox',{action:'delegation-end',id:d.id});toast('Ended');reload()}catch(e){toast((e as Error).message,'error')}}}>End</Btn>}</td></tr>)}</tbody></table></div>}
 </div>;
}
function TeamInbox({kind}:{kind:string}){
 const {data,error}=useApi<{rows:{id:string,name:string,department:string,open:number,overdue:number,approvals:number,high:number}[]}>(`/api/inbox?view=${kind}`);
 return <div className="page"><Header icon={kind==='team'?'Users':'Building2'} tone="violet" title={kind==='team'?'My team’s inbox':'Department inbox'} subtitle="Open work waiting on each person (counts only; open a person’s items in their own inbox)."/><ErrorNote error={error}/>
  {!data?<Skeleton/>:!data.rows.length?<Empty icon="Users" title="No one to show"/>:<div className="lb-table"><table className="plain"><thead><tr><th>Person</th><th>Department</th><th>Open</th><th>Overdue</th><th>Approvals</th><th>High impact</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.id}><td><a href={`#/people/directory/${r.id}`}>{r.name}</a></td><td>{r.department}</td><td>{r.open}</td><td className={cx(r.overdue>0&&'overdue')}>{r.overdue}</td><td>{r.approvals}</td><td>{r.high}</td></tr>)}</tbody></table></div>}</div>;
}

// ── Administration: priority, SLA, escalation, digest, contributing modules, retention and delegation policy ──
const RULE_FORMS:Record<string,{label:string,fields:[string,string,string?][]}>={
 priority:{label:'Priority rule',fields:[['itemType','Item type (optional)'],['module','Module (optional)'],['minAmount','Minimum amount','number'],['boost','Score boost (e.g. 20 or -10)','number']]},
 sla:{label:'SLA rule',fields:[['itemType','Item type (optional)'],['module','Module (optional)'],['hours','Hours to act','number']]},
 escalation:{label:'Escalation rule',fields:[['itemType','Item type (optional)'],['module','Module (optional)'],['afterHours','Escalate after (hours past due/SLA)','number'],['to','Escalate to (department_head, manager or person:<id>)']]},
 digest:{label:'Digest schedule',fields:[['frequency','none or daily']]},
 modules:{label:'Contributing modules',fields:[['disabled','Modules to exclude (comma separated)']]},
 retention:{label:'Retention',fields:[['completedDays','Keep completed items (days)','number']]},
 delegation:{label:'Delegation policy',fields:[['allowDelegation','Allow delegation (true/false)'],['maxDays','Maximum days','number'],['nonDelegableTypes','Never delegable (comma separated, e.g. approval or purchasing:approval)'],['nonDelegableAbove','Approvals above this amount cannot be delegated','number'],['requireSameRole','Delegate must hold the same permission (true/false)']]},
 notification:{label:'Notification channels',fields:[['email','Email notifications (true/false)'],['inApp','In-app notifications (true/false)']]},
};
export function InboxRules(){
 const {toast}=useApp();const {data,error,reload}=useApi<{rules:{id:string,kind:string,name:string,config:Record<string,unknown>,enabled:boolean,updatedAt:string}[],platformDefaults:Record<string,unknown>}>('/api/inbox?view=rules');
 const [kind,setKind]=useState('priority');const [name,setName]=useState('');const [cfg,setCfg]=useState<Record<string,string>>({});
 const save=async()=>{const f=RULE_FORMS[kind];const config:Record<string,unknown>={};for(const [k,,t] of f.fields){const v=cfg[k];if(v===undefined||v==='')continue;config[k]=t==='number'?Number(v):['disabled','nonDelegableTypes'].includes(k)?v.split(',').map(x=>x.trim()).filter(Boolean):v==='true'?true:v==='false'?false:v}
  try{await api('/api/inbox',{action:'rule-save',kind,name:name||f.label,config});toast('Rule saved');setCfg({});setName('');reload()}catch(e){toast((e as Error).message,'error')}};
 return <div className="page"><Header icon="SlidersHorizontal" tone="gray" title="Inbox rules" subtitle="How work is prioritised, timed, escalated and summarised for everyone in your company." actions={<Btn icon="RefreshCw" onClick={async()=>{await api('/api/inbox',{action:'rebuild'});toast('Rebuild queued')}}>Rebuild inbox</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&Object.keys(data.platformDefaults).length>0&&<Note>Platform defaults apply where your company has no rule: {JSON.stringify(data.platformDefaults)}</Note>}
  <Card title="Add a rule"><div className="form-grid"><Field label="Rule type"><select value={kind} onChange={e=>{setKind(e.target.value);setCfg({})}}>{Object.entries(RULE_FORMS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></Field><Field label="Name"><input value={name} onChange={e=>setName(e.target.value)}/></Field>
   {RULE_FORMS[kind].fields.map(([k,l,t])=><Field key={k} label={l}><input type={t==='number'?'number':'text'} value={cfg[k]||''} onChange={e=>setCfg({...cfg,[k]:e.target.value})}/></Field>)}</div><Btn variant="primary" onClick={save}>Save rule</Btn></Card>
  {!data?<Skeleton/>:!data.rules.length?<Empty icon="SlidersHorizontal" title="No company rules yet">Default ordering uses priority, due dates, SLA, financial impact and escalation.</Empty>:<div className="lb-table"><table className="plain"><thead><tr><th>Type</th><th>Name</th><th>Settings</th><th>Updated</th><th/></tr></thead><tbody>{data.rules.map(r=><tr key={r.id}><td>{RULE_FORMS[r.kind]?.label||r.kind}</td><td>{r.name}</td><td className="small mono">{JSON.stringify(r.config)}</td><td className="muted small">{ago(r.updatedAt)}</td><td><Btn size="sm" variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{await api('/api/inbox',{action:'rule-delete',id:r.id});reload()}}/></td></tr>)}</tbody></table></div>}
 </div>;
}
export type {Counts};
export const useInboxCounts=()=>{const {data}=useApi<Counts>('/api/inbox?view=counts');return data};
