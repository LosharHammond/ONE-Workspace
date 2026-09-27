'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api,useRoute,cx,ago} from './lib';
import {useApp,Btn,Icon,Markdown,Modal,Note,Chip,Skeleton,Menu,ErrorNote} from './kit';

// Floating, permission-aware AI assistant. Everything it knows comes from the server, which retrieves only
// records the signed-in person can open in the current workspace and cites them.
type Citation={n:number,type:string,title:string,link:string,used?:boolean};
type Msg={id?:string,role:'user'|'assistant',content:string,citations?:Citation[],feedback?:number,error?:boolean};
type AiAction={id:string,label:string,page:string,entity?:string,input?:string,json?:boolean,mutates?:string,description:string};
export type AiStatus={available:boolean,configured:boolean,source:'company'|'platform'|null,provider:string|null,model:string|null,workspace:string,used:number,limit:number,actions:AiAction[]};
let statusPromise:Promise<AiStatus>|null=null;
export function aiStatus(refresh=false){if(!statusPromise||refresh)statusPromise=api<AiStatus>('/api/ai?view=status').catch(e=>{statusPromise=null;throw e});return statusPromise}
const suggestions:Record<string,string[]>={
 home:['What needs my attention today?','Summarize my open tickets','Which approvals are waiting on me?'],
 tickets:['Summarize this ticket','What is the latest on this ticket?','Are there similar tickets?'],
 assets:['Summarize this asset’s history','Which assets have warranties expiring soon?','What maintenance is overdue?'],
 purchasing:['Summarize this requisition','Why is this approval taking long?','Which requisitions are pending?'],
 spaces:['Summarize this page','What does our leave policy say?','List the action items on this page'],
 people:['Who works in Finance?','Who is the head of IT?'],
};
async function* readSse(res:Response){const reader=res.body!.getReader();const d=new TextDecoder();let buf='';while(true){const {done,value}=await reader.read();if(done)break;buf+=d.decode(value,{stream:true});let i;while((i=buf.indexOf('\n\n'))>=0){const block=buf.slice(0,i);buf=buf.slice(i+2);const ev=/^event: (.+)$/m.exec(block)?.[1]||'message';const data=/^data: (.+)$/m.exec(block)?.[1];if(data)yield {event:ev,data:JSON.parse(data)}}}}

export function Assistant(){
 const {s,can}=useApp();const route=useRoute();
 const [open,setOpen]=useState(false),[status,setStatus]=useState<AiStatus|null>(null),[err,setErr]=useState('');
 const [msgs,setMsgs]=useState<Msg[]>([]),[conv,setConv]=useState<string|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[history,setHistory]=useState<{id:string,title:string,updatedAt:string}[]|null>(null);
 const abort=useRef<AbortController|null>(null);const input=useRef<HTMLTextAreaElement>(null);const end=useRef<HTMLDivElement>(null);
 const allowed=can('assistant','run_ai');
 useEffect(()=>{if(open&&!status)aiStatus().then(setStatus).catch(e=>setErr((e as Error).message))},[open,status]);
 useEffect(()=>{if(open)setTimeout(()=>input.current?.focus(),50)},[open]);
 useEffect(()=>{end.current?.scrollIntoView({block:'end'})},[msgs]);
 useEffect(()=>{const f=(e:KeyboardEvent)=>{if(e.key==='Escape'&&open){setOpen(false)}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='j'&&allowed){e.preventDefault();setOpen(o=>!o)}};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[open,allowed]);
 // A new workspace (switch or support session) starts a new conversation.
 useEffect(()=>{setMsgs([]);setConv(null);setHistory(null);setStatus(null)},[s.tenant.id]);
 const send=useCallback(async(q:string)=>{
  const question=q.trim();if(!question||busy)return;setText('');setBusy(true);
  setMsgs(m=>[...m,{role:'user',content:question},{role:'assistant',content:''}]);
  const ctrl=new AbortController();abort.current=ctrl;
  const patch=(f:(m:Msg)=>Msg)=>setMsgs(m=>{const c=[...m];c[c.length-1]=f(c[c.length-1]);return c});
  try{
   const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'chat',message:question,conversationId:conv,page:location.hash}),signal:ctrl.signal});
   if(!res.ok){const d=await res.json().catch(()=>({})) as {error?:string};throw new Error(d.error||'The assistant could not answer.')}
   for await(const {event,data} of readSse(res)){
    if(event==='meta')setConv(data.conversationId);
    if(event==='delta')patch(m=>({...m,content:m.content+data.text}));
    if(event==='done'){patch(m=>({...m,id:data.messageId,citations:data.citations}));setStatus(st=>st?{...st,used:st.used+1,provider:data.provider,model:data.model,source:data.source}:st)}
    if(event==='error')patch(m=>({...m,content:data.error,error:true}));
   }
  }catch(e){if((e as Error).name==='AbortError')patch(m=>({...m,content:m.content+'\n\n_Stopped._'}));else patch(m=>({...m,content:(e as Error).message,error:true}))}
  finally{setBusy(false);abort.current=null}
 },[busy,conv]);
 async function loadHistory(){try{const d=await api<{conversations:{id:string,title:string,updatedAt:string}[]}>('/api/ai');setHistory(d.conversations)}catch(e){setErr((e as Error).message)}}
 async function openConv(id:string){try{const d=await api<{messages:Msg[]}>(`/api/ai?conversation=${id}`);setMsgs(d.messages);setConv(id);setHistory(null)}catch(e){setErr((e as Error).message)}}
 async function feedback(i:number,v:number){const m=msgs[i];if(!m.id)return;setMsgs(x=>x.map((y,j)=>j===i?{...y,feedback:v}:y));await api('/api/ai',{action:'feedback',messageId:m.id,value:v}).catch(()=>{})}
 if(!allowed)return null;
 const ideas=suggestions[route.app]||suggestions.home;
 return <>
  {!open&&<button className="ai-fab" onClick={()=>setOpen(true)} aria-label="Open the AI assistant (Ctrl+J)" title="Ask AI (Ctrl+J)"><Icon name="Sparkles" size={20}/><span>Ask AI</span></button>}
  {open&&<section className="ai-panel" role="dialog" aria-label="AI assistant">
   <header className="ai-head">
    <div className="ai-title"><span className="ai-orb"><Icon name="Sparkles" size={16}/></span><div><b>Assistant</b><small title="The assistant only uses records you can open in this workspace.">Using <b>{s.tenant.name}</b> data{status?.model?` · ${status.provider} ${status.model}`:''}</small></div></div>
    <div className="ai-head-actions">
     <Btn size="sm" variant="ghost" icon="History" title="Conversations" onClick={()=>history?setHistory(null):loadHistory()}/>
     <Btn size="sm" variant="ghost" icon="Plus" title="New conversation" onClick={()=>{abort.current?.abort();setMsgs([]);setConv(null);setHistory(null)}}/>
     <Btn size="sm" variant="ghost" icon="Minus" title="Close (Esc)" onClick={()=>setOpen(false)}/>
    </div>
   </header>
   <div className="ai-body" aria-live="polite">
    {err&&<ErrorNote error={err}/>}
    {!status&&!err&&<Skeleton rows={3}/>}
    {status&&!status.configured&&<div className="ai-empty"><Icon name="Sparkles" size={26}/><h3>AI is not configured</h3><p className="muted">{s.user.role==='admin'?<>Connect an AI provider in <a href="#/admin/ai" onClick={()=>setOpen(false)}>AI settings</a>, or ask the Platform Owner to enable the platform default.</>:'Ask your administrator to connect an AI provider.'}</p></div>}
    {status?.configured&&history&&<div className="ai-history"><p className="rail-section">Recent conversations</p>{!history.length&&<p className="muted small">No saved conversations.</p>}{history.map(h=><div key={h.id} className="ai-history-row"><button className="link" onClick={()=>openConv(h.id)}>{h.title||'Conversation'}<small className="muted"> · {ago(h.updatedAt)}</small></button><Btn size="sm" variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{await api('/api/ai',{action:'delete-conversation',id:h.id});setHistory(history.filter(x=>x.id!==h.id));if(conv===h.id){setMsgs([]);setConv(null)}}}/></div>)}</div>}
    {status?.configured&&!history&&!msgs.length&&<div className="ai-welcome"><p>Ask about tickets, assets, purchasing, people, files and pages. Answers use only what <b>you</b> can open in {s.tenant.name}, with links to the sources.</p><div className="ai-suggest">{ideas.map(q=><button key={q} className="chip-btn" onClick={()=>send(q)}>{q}</button>)}</div><small className="muted">{status.used.toLocaleString()} of {status.limit.toLocaleString()} AI requests used this month · {status.source==='company'?'Company AI provider':'Platform default (Groq)'}</small></div>}
    {status?.configured&&!history&&msgs.map((m,i)=><div key={i} className={cx('ai-msg',m.role,m.error&&'error')}>
     {m.role==='assistant'?(m.content?<Markdown text={m.content}/>:<span className="ai-typing"><i/><i/><i/></span>):<p>{m.content}</p>}
     {!!m.citations?.length&&<div className="ai-cites">{m.citations.map(c=><a key={c.n} href={c.link} className="ai-cite" title={c.title} onClick={()=>{if(window.innerWidth<700)setOpen(false)}}><b>S{c.n}</b>{c.type} · {c.title}</a>)}</div>}
     {m.role==='assistant'&&m.id&&<div className="ai-feedback"><button aria-label="Helpful" className={cx(m.feedback===1&&'on')} onClick={()=>feedback(i,m.feedback===1?0:1)}><Icon name="ThumbsUp" size={14}/></button><button aria-label="Not helpful" className={cx(m.feedback===-1&&'on')} onClick={()=>feedback(i,m.feedback===-1?0:-1)}><Icon name="ThumbsDown" size={14}/></button></div>}
    </div>)}
    <div ref={end}/>
   </div>
   {status?.configured&&<form className="ai-input" onSubmit={e=>{e.preventDefault();send(text)}}>
    <textarea ref={input} rows={2} value={text} placeholder={`Ask about ${s.tenant.name}…`} aria-label="Message the assistant" onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(text)}}}/>
    {busy?<Btn icon="CircleX" onClick={()=>abort.current?.abort()} title="Stop">Stop</Btn>:<Btn type="submit" variant="primary" icon="Send" disabled={!text.trim()} title="Send (Enter)"/>}
   </form>}
  </section>}
 </>;
}

// AI actions on a page or record. Results are previews: suggestions that would change data are applied
// only through `onApply`, after the person confirms, using the page's normal API.
export function AiActions({entity,entityId,only,onApply,label='AI'}:{entity?:string,entityId?:string,only?:string[],onApply?:Record<string,(data:any)=>Promise<void>|void>,label?:string}){
 const {can,ask,toast}=useApp();const [st,setSt]=useState<AiStatus|null>(null);const [result,setResult]=useState<{action:AiAction,text?:string|null,suggestion?:{kind:string,data:any}|null,citations?:Citation[]}|null>(null);const [busy,setBusy]=useState<string|null>(null);
 useEffect(()=>{if(can('assistant','run_ai'))aiStatus().then(setSt).catch(()=>{})},[can]);
 if(!st?.configured)return null;
 const list=st.actions.filter(a=>(only?only.includes(a.id):true)&&(entity?a.entity===entity:!a.entity||!!only));
 if(!list.length)return null;
 async function run(a:AiAction){
  let input='';
  if(a.input){const v=await ask({title:a.label,confirm:'Run',input:{label:a.input,required:true,multiline:true}});if(v===false)return;input=v}
  setBusy(a.id);
  try{const r=await api<{text?:string|null,suggestion?:{kind:string,data:any}|null,citations?:Citation[]}>('/api/ai',{action:'run',id:a.id,entityId,input});setResult({action:a,...r})}
  catch(e){toast((e as Error).message,'error')}finally{setBusy(null)}
 }
 return <>
  <Menu trigger={o=><Btn size="sm" icon="Sparkles" busy={!!busy} onClick={o}>{label}</Btn>} items={list.map(a=>({label:a.label,icon:'Sparkles',onClick:()=>run(a)}))}/>
  {result&&<Modal open wide onClose={()=>setResult(null)} title={result.action.label} subtitle="AI output can be wrong. Nothing is saved unless you apply it." footer={<><div className="grow"/><Btn variant="ghost" onClick={()=>setResult(null)}>Close</Btn>{result.suggestion&&onApply?.[result.suggestion.kind]&&<Btn variant="primary" icon="Check" onClick={async()=>{if(await ask({title:'Apply this suggestion?',body:'It will be saved with your own permissions, exactly as if you made the change yourself.',confirm:'Apply'})===false)return;try{await onApply[result.suggestion!.kind](result.suggestion!.data);toast('Applied');setResult(null)}catch(e){toast((e as Error).message,'error')}}}>Apply</Btn>}</>}>
   {result.text&&<Markdown text={result.text}/>}
   {result.suggestion&&<SuggestionPreview kind={result.suggestion.kind} data={result.suggestion.data}/>}
   {!!result.citations?.filter(c=>c.used!==false).length&&<div className="ai-cites">{result.citations.map(c=><a key={c.n} className="ai-cite" href={c.link}><b>S{c.n}</b>{c.type} · {c.title}</a>)}</div>}
   {result.suggestion&&!onApply?.[result.suggestion.kind]&&<Note>Copy what you need; this suggestion can't be applied from here.</Note>}
  </Modal>}
 </>;
}
function SuggestionPreview({kind,data}:{kind:string,data:any}){
 if(kind==='ticket.update')return <div className="kv-preview"><p><b>Priority:</b> <Chip>{String(data.priority||'—')}</Chip> <b>Category:</b> {String(data.category||'—')}</p><p className="muted">{String(data.reason||'')}</p></div>;
 if(kind==='ticket.comment')return <div className="draft-preview"><Markdown text={String(data.reply||'')}/></div>;
 if(kind==='ticket.assign')return <div><p><b>Suggested assignee:</b> {String(data.name||'—')}{!data.assigneeId&&<Chip tone="amber">not a valid person</Chip>}</p><p className="muted">{String(data.reason||'')}</p></div>;
 if(kind==='purchase.create')return <div><h3>{String(data.title||'')}</h3><Markdown text={String(data.justification||'')}/><table className="plain"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit price</th></tr></thead><tbody>{(Array.isArray(data.lines)?data.lines:[]).map((l:any,i:number)=><tr key={i}><td>{String(l.description)}</td><td>{Number(l.qty)||0}</td><td>{String(l.unit||'')}</td><td>{Number(l.unitPrice)||0}</td></tr>)}</tbody></table></div>;
 if(kind==='page.create')return <div><h3>{String(data.title||'')}</h3><div className="draft-preview"><Markdown text={String(data.body||'')}/></div></div>;
 if(kind==='page-builder.draft')return <div><p><b>{String(data.sections?.length||0)} sections</b> · {(data.sections||[]).map((s:any)=>s.title||'Section').join(' · ')}</p><p className="muted small">Widgets: {(data.sections||[]).flatMap((s:any)=>(s.rows||[]).flatMap((r:any)=>r.columns.flatMap((c:any)=>c.widgets.map((w:any)=>w.title||w.type)))).join(', ')}</p></div>;
 if(Array.isArray(data?.duplicates))return data.duplicates.length?<ul>{data.duplicates.map((d:any)=><li key={d.id}><a href={d.link}>{d.title}</a> — {d.reason}</li>)}</ul>:<p>No likely duplicates among the tickets you can see.</p>;
 return <pre className="mono small">{JSON.stringify(data,null,2)}</pre>;
}
