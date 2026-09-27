'use client';
import {useEffect,useState} from 'react';
import {api,useApi,go,ago,dateOnly,dateTime,bytes,cx,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Grid,Modal,Field,ErrorNote,Skeleton,Empty,Card,Icon,Note,Stat,Tabs,KV,TagPicker,Menu,type Col} from './kit';
import {modules as moduleCatalog} from '../modules';
import {PlatformIntegrations} from './integrations';

// Platform Console: only the Platform Owner reaches this app (the API refuses everyone else).
type TenantRow={id:string,slug:string,name:string,legalName:string,domains:string,status:string,plan:string,brandColor:string,currency:string,createdAt:string,members:number,assets:number,tickets:number,purchasing:number,lastActive:string|null};
export default function Platform({parts}:{parts:string[]}){
 if(parts[0]==='audit')return <PlatformAudit/>;
 if(parts[0]==='catalog')return <PlatformCatalog tab={parts[1]||'pages'}/>;
 if(parts[0]==='connectors')return <PlatformIntegrations parts={parts.slice(1)}/>;
 if(parts[0]==='workspaces'&&parts[1])return <WorkspaceDetail id={parts[1]} tab={parts[2]||'overview'}/>;
 return <Workspaces creating={parts[1]==='new'}/>;
}

function Workspaces({creating}:{creating?:boolean}){
 const {s}=useApp();const {data,error,reload}=useApi<{tenants:TenantRow[],homeTenant:string,activeSupport:{tenantId:string,tenantName:string,startedAt:string}|null}>('/api/platform');
 const [status,setStatus]=useState('live');const [support,setSupport]=useState<TenantRow|null>(null),[choice,setChoice]=useState<TenantRow|null>(null);
 const rows=(data?.tenants||[]).filter(t=>status==='all'||(status==='live'?t.status!=='archived':t.status===status));
 const cols:Col<TenantRow>[]=[
  {key:'name',label:'Company',render:t=><span className="who"><span className="tenant-mark" style={{background:t.brandColor}}>{t.name[0]}</span><span>{t.name}{t.id===data?.homeTenant&&<Chip tone="violet">Platform HQ</Chip>}<small>{t.slug} · {t.domains||'any email domain'}</small></span></span>},
  {key:'status',label:'Status',width:110,render:t=><Chip>{t.status[0].toUpperCase()+t.status.slice(1)}</Chip>},
  {key:'plan',label:'Plan',width:100},{key:'members',label:'People',width:80,align:'right'},{key:'assets',label:'Assets',width:80,align:'right'},{key:'tickets',label:'Tickets',width:80,align:'right'},{key:'purchasing',label:'PR/PO',width:80,align:'right'},
  {key:'lastActive',label:'Last active',width:120,render:t=><span className="muted">{ago(t.lastActive)}</span>},
  {key:'createdAt',label:'Created',width:110,render:t=>dateOnly(t.createdAt)},
  {key:'enter',label:'',width:130,sortable:false,render:t=>t.status!=='archived'&&<Btn size="sm" icon="LogIn" onClick={e=>{e.stopPropagation();goTo(t,data?.homeTenant,s.tenant.id,!!s.support,()=>setSupport(t))}}>{t.id===s.tenant.id?'Open':'Go to'}</Btn>},
 ];
 const live=(data?.tenants||[]).filter(t=>t.status!=='archived');
 return <div className="page">
  <Header icon="Globe" tone="red" title="Platform Console" subtitle="Company workspaces on One Workspace. Each company's data is isolated; entering a workspace starts an audited support session." actions={<Btn variant="primary" icon="Plus" onClick={()=>go('platform/workspaces/new')}>New company workspace</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data?.activeSupport&&<Note tone="warn">An earlier support session in {data.activeSupport.tenantName} is still open. It closes when you start another or sign out.</Note>}
  {data&&<div className="stats"><Stat label="Workspaces" value={live.length} icon="Building" tone="violet"/><Stat label="Active" value={live.filter(t=>t.status==='active').length} icon="CircleCheck" tone="green"/><Stat label="Suspended" value={live.filter(t=>t.status==='suspended').length} icon="PauseCircle" tone="amber"/><Stat label="People across workspaces" value={live.reduce((n,t)=>n+t.members,0)} icon="Users" tone="sky"/><Stat label="Open records" value={live.reduce((n,t)=>n+t.assets+t.tickets+t.purchasing,0).toLocaleString()} icon="Database" tone="teal" sub="Assets, tickets and PR/POs"/></div>}
  {!data?<Skeleton/>:<Grid id="platform-tenants" rows={rows} cols={cols} exportName="workspaces" onOpen={t=>setChoice(t)} toolbar={<select className="grid-select" value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="live">Active & suspended</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option><option value="all">All</option></select>}/>}
  {creating&&<CreateWorkspace onClose={()=>go('platform/workspaces')} onDone={()=>reload()}/>}
  {support&&<EnterWorkspace tenant={support} onClose={()=>setSupport(null)}/>}
  {choice&&<OpenWorkspace t={choice} current={choice.id===s.tenant.id} onClose={()=>setChoice(null)} onGo={()=>{const t=choice;setChoice(null);goTo(t,data?.homeTenant,s.tenant.id,!!s.support,()=>setSupport(t))}}/>}
 </div>;
}

// "Go to" a company: the workspace you are already in just opens; the owner's own HQ workspace ends any
// support session; any other company starts an audited support session (reason required).
async function goTo(t:{id:string},home:string|undefined,current:string,inSupport:boolean,startSupport:()=>void){
 if(t.id===current){location.hash='#/home';return}
 if(t.id===home){if(inSupport)await api('/api/platform',{action:'support-end'});location.hash='#/home';location.reload();return}
 startSupport();
}
function OpenWorkspace({t,current,onClose,onGo}:{t:TenantRow,current:boolean,onClose:()=>void,onGo:()=>void}){
 return <Modal open onClose={onClose} title={t.name} subtitle={`${t.slug} · ${t.status[0].toUpperCase()+t.status.slice(1)} · ${t.members} people`}>
  <div className="open-choices">
   <button className="open-choice primary" disabled={t.status==='archived'} onClick={onGo} autoFocus><Icon name="LogIn" size={20}/><span><b>{current?'Open this workspace':'Go to workspace'}</b><small>{t.status==='archived'?'Restore the workspace before entering it.':current?'You are already working in this company.':'Work inside the company with full Company Admin access to its modules, people, settings, roles and records. Recorded as a support session.'}</small></span><Icon name="ChevronRight" size={16}/></button>
   <button className="open-choice" onClick={()=>{onClose();go(`platform/workspaces/${t.id}`)}}><Icon name="Settings2" size={20}/><span><b>Manage from the Platform Console</b><small>Profile, administrators, modules, limits, security, audit activity and status.</small></span><Icon name="ChevronRight" size={16}/></button>
  </div>
 </Modal>;
}

// Starts an audited support session. The owner acts as themselves (never as another user).
function EnterWorkspace({tenant,onClose}:{tenant:{id:string,name:string,status:string},onClose:()=>void}){
 const {toast}=useApp();const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={`Enter ${tenant.name}`} subtitle="Support sessions are recorded: reason, start and end time, your IP and browser, and every page viewed or change made." footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="LogIn" busy={busy} disabled={reason.trim().length<5} onClick={async()=>{setBusy(true);try{await api('/api/platform',{action:'support-start',id:tenant.id,reason});location.hash='#/home';location.reload()}catch(e){toast((e as Error).message,'error');setBusy(false)}}}>Go to workspace</Btn></>}>
  {tenant.status==='suspended'&&<Note tone="warn">This workspace is suspended. Its members cannot sign in, but you can enter to support it.</Note>}
  <div className="reason-chips" role="group" aria-label="Common reasons">{['Configuration and setup support','Reviewing data at the company’s request','Investigating a reported problem','Routine platform check'].map(r=><button key={r} type="button" className={cx('chip-btn',reason===r&&'on')} onClick={()=>setReason(r)}>{r}</button>)}</div>
  <Field label="Reason for entering" hint="Shown in the workspace's activity log and the platform audit."><textarea autoFocus rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Admin asked for help configuring purchase approvals (ticket #42)"/></Field>
 </Modal>;
}

const defaultsList:[string,string][]=[['departments','Default departments (Administration, Finance, Procurement, IT, HR, Operations, Sales)'],['locations','Default locations (Head Office, Main Store)'],['roles','Role baselines (Company Admin, Department Head, Standard User, Technician, Approver, Purchasing User, Asset Manager, Storekeeper, Viewer)'],['workflows','Default requisition and purchase-order approval workflows'],['folders','Starter file folder (Policies & procedures)'],['welcome','Welcome announcement on the home page']];
function CreateWorkspace({onClose,onDone}:{onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();
 const [v,setV]=useState({name:'',legalName:'',slug:'',domains:'',adminName:'',adminEmail:'',currency:'GHS',timezone:'Africa/Accra',brandColor:'#6D5EF8',plan:'business'});
 const [defaults,setDefaults]=useState<Record<string,boolean>>(Object.fromEntries(defaultsList.map(([k])=>[k,true])));
 const [mods,setMods]=useState<string[]>(moduleCatalog.map(m=>m.id));
 const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[result,setResult]=useState<{slug:string,emailed:boolean,link?:string,note?:string,expiresAt?:string}|null>(null),[err,setErr]=useState('');
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV(x=>({...x,[k]:e.target.value}));
 async function create(){setBusy(true);setErr('');try{const r=await api<any>('/api/platform',{action:'create',...v,defaults,modules:mods});setResult(r);onDone();toast('Workspace created')}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 const ok0=v.name&&v.slug&&v.adminName&&/\S+@\S+\.\S+/.test(v.adminEmail);
 return <Modal open wide onClose={onClose} title="New company workspace" subtitle="Everything below is created in a single transaction: if any step fails, nothing is created." footer={result?<Btn variant="primary" onClick={onClose}>Done</Btn>:<>{step>0&&<Btn variant="ghost" onClick={()=>setStep(step-1)}>Back</Btn>}<div className="grow"/><Btn variant="ghost" onClick={onClose}>Cancel</Btn>{step<2?<Btn variant="primary" disabled={step===0&&!ok0} onClick={()=>setStep(step+1)}>Continue</Btn>:<Btn variant="primary" icon="Check" busy={busy} onClick={create}>Create workspace</Btn>}</>}>
  {result?<ActivationResult r={result} who={v.adminEmail} workspace={v.name}/>:<>
   <div className="stepper">{['Company & administrator','Modules','Starting defaults'].map((t,i)=><span key={t} className={cx(i===step&&'on',i<step&&'done')}><b>{i+1}</b>{t}</span>)}</div>
   {step===0&&<div className="form-grid">
    <Field label="Company name"><input autoFocus value={v.name} onChange={e=>setV(x=>({...x,name:e.target.value,slug:x.slug||e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)}))}/></Field>
    <Field label="Legal name" hint="Printed on purchase orders."><input value={v.legalName} onChange={f('legalName')}/></Field>
    <Field label="Workspace ID" hint="Lowercase letters, numbers and dashes. Must be unique."><input value={v.slug} onChange={f('slug')}/></Field>
    <Field label="Email domains" hint="Only these domains can be invited, e.g. acme.com"><input value={v.domains} onChange={f('domains')}/></Field>
    <Field label="Plan"><select value={v.plan} onChange={f('plan')}><option value="starter">Starter · 25 people · 2 GB</option><option value="business">Business · 250 people · 20 GB</option><option value="enterprise">Enterprise · 5,000 people · 200 GB</option></select></Field>
    <Field label="Brand colour"><div className="color-in"><input type="color" value={v.brandColor} onChange={f('brandColor')}/><input value={v.brandColor} onChange={f('brandColor')}/></div></Field>
    <Field label="Currency"><input value={v.currency} maxLength={8} onChange={f('currency')}/></Field>
    <Field label="Time zone"><input value={v.timezone} onChange={f('timezone')}/></Field>
    <Field label="First Company Admin — name"><input value={v.adminName} onChange={f('adminName')}/></Field>
    <Field label="First Company Admin — email" hint="They receive a one-time activation link. No password is set here."><input type="email" value={v.adminEmail} onChange={f('adminEmail')}/></Field>
   </div>}
   {step===1&&<div className="module-grid">{moduleCatalog.map(m=><label key={m.id} className={cx('module-card',mods.includes(m.id)&&'on')}><input type="checkbox" checked={mods.includes(m.id)} onChange={e=>setMods(e.target.checked?[...mods,m.id]:mods.filter(x=>x!==m.id))}/><div><b>{m.label}</b><small>{m.description}</small></div></label>)}<p className="muted small">Home, People, Admin and the activity log are always on.</p></div>}
   {step===2&&<div className="check-list">{defaultsList.map(([k,label])=><label key={k} className="check"><input type="checkbox" checked={defaults[k]} onChange={e=>setDefaults({...defaults,[k]:e.target.checked})}/>{label}</label>)}<Note>Numbering sequences (PR, PO, TKT, AST, WO), ticket categories, asset and inventory categories, purchasing statuses and default terms are always configured and can be changed later in Company settings.</Note></div>}
   {err&&<ErrorNote error={err}/>}
  </>}
 </Modal>;
}
function ActivationResult({r,who,workspace}:{r:{emailed:boolean,link?:string,note?:string,expiresAt?:string,emailError?:string},who:string,workspace:string}){
 const {toast}=useApp();
 if(r.note)return <Note tone="ok">{r.note}</Note>;
 if(r.emailed)return <Note tone="ok">An activation email was sent to <b>{who}</b>. The link expires {dateTime(r.expiresAt)}.</Note>;
 return <div className="activation"><Note tone="warn">Email delivery is not configured, so the one-time activation link is shown here <b>once</b>. Send it to {who} privately. It expires {dateTime(r.expiresAt)}.</Note>{r.emailError&&<ErrorNote error={r.emailError}/>}<div className="copy-link"><code>{r.link}</code><Btn size="sm" icon="Copy" onClick={()=>{navigator.clipboard.writeText(r.link||'');toast('Link copied')}}>Copy</Btn></div><p className="muted small">After activation they can sign in to {workspace}. The link stops working once used.</p></div>;
}

type Detail={pages?:string[],catalog?:CatalogPage[],packages?:PagePackage[],tenant:{id:string,slug:string,name:string,legal_name:string,domains:string,status:string,plan:string,brand_color:string,currency:string,timezone:string,created_at:string,settings:Record<string,unknown>},modules:string[],limits:{maxUsers:number,maxStorageMb:number,aiRequestsPerMonth?:number,maxConnectors?:number},usage:Record<string,number|string|null>,admins:{id:string,name:string,email:string,active:number,lastSeenAt:string|null,invitedAt:string|null,activated:number}[],activity:{id:string,action:string,actorName:string|null,createdAt:string,supportSessionId:string|null}[],support:{id:string,reason:string,startedAt:string,endedAt:string|null,ip:string,changes:number}[]};
function WorkspaceDetail({id,tab}:{id:string,tab:string}){
 const {s,toast,ask}=useApp();const {data,error,reload}=useApi<Detail>('/api/platform?id='+encodeURIComponent(id));const [enter,setEnter]=useState(false);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data)return <div className="page"><Skeleton rows={10}/></div>;
 const t=data.tenant;const home=t.id==='one-workspace';
 const act=async(body:Record<string,unknown>,msg:string)=>{try{const r=await api<any>('/api/platform',{id:t.id,...body});toast(msg);reload();return r}catch(e){toast((e as Error).message,'error')}};
 const tabs=[['overview','Overview'],['profile','Company profile'],['admins','Administrators'],['pages','Pages & modules'],['usage','Usage & limits'],['security','Security'],['audit','Audit activity'],['data','Data tools'],['danger','Danger zone']];
 return <div className="page">
  <div className="doc-top"><Btn variant="ghost" icon="ArrowLeft" onClick={()=>go('platform/workspaces')}>All workspaces</Btn></div>
  <Header icon="Building" tone="red" title={<>{t.name} <Chip>{t.status[0].toUpperCase()+t.status.slice(1)}</Chip></>} subtitle={`${t.slug} · ${t.plan} plan · created ${dateOnly(t.created_at)}`} actions={t.status!=='archived'&&<Btn variant="primary" icon="LogIn" onClick={()=>goTo(t,'one-workspace',s.tenant.id,!!s.support,()=>setEnter(true))}>{t.id===s.tenant.id?'Open workspace':'Go to workspace'}</Btn>}/>
  <Tabs value={tab} onChange={v=>go(`platform/workspaces/${t.id}/${v}`)} items={tabs.map(([id,label])=>({id,label}))}/>
  {tab==='overview'&&<><div className="stats"><Stat label="Active people" value={String(data.usage.members)} icon="Users" tone="sky" sub={`${data.usage.invited} awaiting activation · limit ${data.limits.maxUsers}`}/><Stat label="Open tickets" value={String(data.usage.openTickets)} icon="LifeBuoy" tone="orange" sub={`${data.usage.tickets} total`}/><Stat label="Assets" value={String(data.usage.assets)} icon="Boxes" tone="teal"/><Stat label="Purchasing documents" value={String(data.usage.purchasing)} icon="ShoppingBag" tone="green"/><Stat label="Storage" value={bytes(Number(data.usage.storageBytes))} icon="HardDrive" tone="amber" sub={`of ${(data.limits.maxStorageMb/1024).toLocaleString()} GB`}/></div>
   <div className="cards-3"><Card title="Health"><KV items={[['Status',t.status],['Last activity',ago(String(data.usage.lastActive||''))],['Administrators',`${data.admins.filter(a=>a.active&&a.activated).length} active, ${data.admins.filter(a=>a.active&&!a.activated).length} invited`],['Modules on',`${data.modules.length} of ${moduleCatalog.length}`],['Departments',String(data.usage.departments)],['Roles',String(data.usage.roles)]]}/></Card>
   <Card title="Recent activity" className="span2"><div className="mini-list">{data.activity.slice(0,8).map(a=><div key={a.id} className="mini-row"><Icon name={a.supportSessionId?'ShieldAlert':'History'} size={15}/><span>{a.action}<small>{a.actorName||'System'} · {ago(a.createdAt)}</small></span></div>)}{!data.activity.length&&<p className="muted small">No activity yet.</p>}</div></Card></div></>}
  {tab==='profile'&&<ProfileForm d={data} onSave={b=>act({action:'update',...b},'Company profile saved')}/>}
  {tab==='admins'&&<AdminsTab d={data} act={act}/>}
  {(tab==='pages'||tab==='modules')&&<PagesTab d={data} act={act}/>}
  {tab==='usage'&&<LimitsTab d={data} onSave={l=>act({action:'limits',...l},'Limits saved')}/>}
  {tab==='security'&&<Card title="Support sessions">{!data.support.length?<p className="muted">No one has entered this workspace from the Platform Console.</p>:<table className="plain"><thead><tr><th>Started</th><th>Ended</th><th>Reason</th><th>IP</th><th>Changes</th></tr></thead><tbody>{data.support.map(x=><tr key={x.id}><td>{dateTime(x.startedAt)}</td><td>{x.endedAt?dateTime(x.endedAt):<Chip tone="amber">Open</Chip>}</td><td>{x.reason}</td><td className="mono">{x.ip||'—'}</td><td>{x.changes}</td></tr>)}</tbody></table>}<Note>Company administrators see support sessions in their own activity log. Only the Platform Owner can start one.</Note></Card>}
  {tab==='audit'&&<Card title="Workspace activity (latest 60)"><table className="plain"><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>{data.activity.map(a=><tr key={a.id}><td className="muted">{dateTime(a.createdAt)}</td><td>{a.actorName||'System'}{a.supportSessionId&&<Chip tone="red">Platform support</Chip>}</td><td>{a.action}</td></tr>)}</tbody></table></Card>}
  {tab==='data'&&<Card title="Data tools"><p className="muted">Exports contain only this workspace's metadata and totals. To work with the company's records, enter the workspace; exports there are scoped to it.</p><div className="row-gap"><Btn icon="Download" onClick={()=>downloadCsv(`${t.slug}-usage`,[['Metric','Value'],...Object.entries(data.usage).map(([k,v])=>[k,v??''])])}>Export usage</Btn><Btn icon="Download" onClick={()=>downloadCsv(`${t.slug}-activity`,[['When','Who','Action','Support session'],...data.activity.map(a=>[a.createdAt,a.actorName||'System',a.action,a.supportSessionId||''])])}>Export activity</Btn></div></Card>}
  {tab==='danger'&&<Card title="Danger zone">{home?<Note>The Platform HQ workspace cannot be suspended or archived.</Note>:<div className="danger-list">
   {t.status==='active'&&<div><div><b>Suspend workspace</b><small>Members are signed out and cannot sign in. Data is kept. You can still enter to help.</small></div><Btn variant="danger" onClick={async()=>{if(await ask({title:`Suspend ${t.name}?`,confirm:'Suspend',danger:true})!==false)act({action:'status',status:'suspended'},'Workspace suspended')}}>Suspend</Btn></div>}
   {t.status!=='active'&&<div><div><b>Reactivate workspace</b><small>Members can sign in again.</small></div><Btn onClick={()=>act({action:'status',status:'active'},'Workspace reactivated')}>Reactivate</Btn></div>}
   {t.status!=='archived'&&<div><div><b>Archive workspace</b><small>Closes it permanently for members and support sessions. Data is retained and can be restored by reactivating.</small></div><Btn variant="danger" onClick={async()=>{const v=await ask({title:`Archive ${t.name}?`,body:<>Type the workspace ID <b>{t.slug}</b> to confirm.</>,confirm:'Archive',danger:true,input:{label:'Workspace ID',required:true}});if(v!==false)act({action:'status',status:'archived',confirm:v},'Workspace archived')}}>Archive</Btn></div>}
  </div>}</Card>}
  {enter&&<EnterWorkspace tenant={t} onClose={()=>setEnter(false)}/>}
 </div>;
}
function ProfileForm({d,onSave}:{d:Detail,onSave:(b:Record<string,unknown>)=>void}){const t=d.tenant;const [v,setV]=useState({name:t.name,legalName:t.legal_name,domains:t.domains,brandColor:t.brand_color,currency:t.currency,timezone:t.timezone,plan:t.plan});const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});return <Card title="Company profile"><div className="form-grid"><Field label="Company name"><input value={v.name} onChange={f('name')}/></Field><Field label="Legal name"><input value={v.legalName} onChange={f('legalName')}/></Field><Field label="Email domains" wide hint="Comma separated. Leave empty to allow any domain."><input value={v.domains} onChange={f('domains')}/></Field><Field label="Brand colour"><div className="color-in"><input type="color" value={v.brandColor} onChange={f('brandColor')}/><input value={v.brandColor} onChange={f('brandColor')}/></div></Field><Field label="Plan"><select value={v.plan} onChange={f('plan')}><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option></select></Field><Field label="Currency"><input value={v.currency} onChange={f('currency')}/></Field><Field label="Time zone"><input value={v.timezone} onChange={f('timezone')}/></Field><div className="form-actions"><Btn variant="primary" onClick={()=>onSave(v)}>Save profile</Btn></div></div></Card>}
function AdminsTab({d,act}:{d:Detail,act:(b:Record<string,unknown>,m:string)=>Promise<any>}){
 const {ask}=useApp();const [v,setV]=useState({name:'',email:''});const [result,setResult]=useState<any>(null);
 return <><Card title="Company administrators">{!d.admins.length?<Empty icon="UserCog" title="No administrators"/>:<table className="plain"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Last active</th><th/></tr></thead><tbody>{d.admins.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.email}</td><td><Chip>{!a.active?'Disabled':a.activated?'Active':'Invited'}</Chip></td><td className="muted">{ago(a.lastSeenAt)}</td><td className="row-gap">{a.active?<Btn size="sm" variant="ghost" icon={a.activated?'KeyRound':'Send'} onClick={async()=>setResult(await act(a.activated?{action:'reset-admin',memberId:a.id}:{action:'invite-admin',name:a.name,email:a.email},a.activated?'Password-reset link created':'Invitation re-sent'))}>{a.activated?'Send reset link':'Resend invitation'}</Btn>:null}<Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[a.active?{label:'Disable',icon:'Ban',danger:true,onClick:async()=>{if(await ask({title:`Disable ${a.name}?`,body:'They are signed out and cannot sign in to this workspace.',confirm:'Disable',danger:true})!==false)act({action:'admin-disable',memberId:a.id},'Administrator disabled')}}:{label:'Reactivate',icon:'UserCheck',onClick:()=>act({action:'admin-enable',memberId:a.id},'Administrator reactivated')},{label:'Remove admin rights',icon:'UserCog',danger:true,onClick:async()=>{if(await ask({title:`Remove ${a.name} as administrator?`,body:'They stay in the company as a Standard User.',confirm:'Remove',danger:true})!==false)act({action:'admin-remove',memberId:a.id},'Administrator removed')}}]}/></td></tr>)}</tbody></table>}</Card>
  <Card title="Invite another Company Admin"><div className="form-grid"><Field label="Name"><input value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Email"><input type="email" value={v.email} onChange={e=>setV({...v,email:e.target.value})}/></Field><div className="form-actions"><Btn variant="primary" icon="Send" disabled={!v.name||!v.email} onClick={async()=>{const r=await act({action:'invite-admin',...v},'Administrator invited');if(r){setResult(r);setV({name:'',email:''})}}}>Send invitation</Btn></div></div><Note>You never see or set passwords. Administrators choose their own through a one-time link.</Note></Card>
  {result&&<Modal open onClose={()=>setResult(null)} title="Link created" footer={<Btn variant="primary" onClick={()=>setResult(null)}>Done</Btn>}><ActivationResult r={result} who="the administrator" workspace={d.tenant.name}/></Modal>}</>;
}
function LimitsTab({d,onSave}:{d:Detail,onSave:(l:Detail['limits'])=>void}){const [l,setL]=useState(d.limits);return <Card title="Usage & limits"><div className="form-grid"><Field label="Maximum active people" hint={`Currently ${d.usage.members} active.`}><input type="number" min={1} value={l.maxUsers} onChange={e=>setL({...l,maxUsers:Number(e.target.value)})}/></Field><Field label="Storage limit (MB)" hint={`Currently ${bytes(Number(d.usage.storageBytes))} used.`}><input type="number" min={10} value={l.maxStorageMb} onChange={e=>setL({...l,maxStorageMb:Number(e.target.value)})}/></Field><Field label="AI requests per month" hint="Assistant and AI actions for the whole company."><input type="number" min={0} value={l.aiRequestsPerMonth??0} onChange={e=>setL({...l,aiRequestsPerMonth:Number(e.target.value)})}/></Field><Field label="Connectors"><input type="number" min={0} value={l.maxConnectors??0} onChange={e=>setL({...l,maxConnectors:Number(e.target.value)})}/></Field><div className="form-actions"><Btn variant="primary" onClick={()=>onSave(l)}>Save limits</Btn></div></div><KV items={Object.entries(d.usage).filter(([k])=>!['lastActive'].includes(k)).map(([k,v])=>[k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()),k==='storageBytes'?bytes(Number(v)):String(v)])}/></Card>}

function PlatformAudit(){
 const {data,error,reload}=useApi<{events:{id:string,action:string,method:string,path:string,ip:string,created_at:string,actorEmail:string,tenantName:string|null,support_session_id:string|null,detail_json:string|null}[]}>('/api/platform?view=audit');
 const cols:Col<any>[]=[{key:'created_at',label:'When',width:150,render:e=>dateTime(e.created_at)},{key:'action',label:'Action',width:200,render:e=><span className="mono">{e.action}</span>},{key:'tenantName',label:'Workspace',width:170},{key:'path',label:'Request',render:e=><span className="mono small">{e.method} {e.path}</span>},{key:'actorEmail',label:'Actor',width:200},{key:'ip',label:'IP',width:120,hide:true},{key:'detail_json',label:'Detail',hide:true}];
 return <div className="page"><Header icon="ScrollText" tone="red" title="Platform audit" subtitle="Every Platform Console action and every request made inside a company during a support session."/><ErrorNote error={error} onRetry={reload}/>{!data?<Skeleton/>:<Grid id="platform-audit" rows={data.events} cols={cols} exportName="platform-audit" dense empty={<Empty icon="ScrollText" title="No platform activity yet"/>}/>}</div>;
}

// ── Page entitlements (per workspace) and the page catalog ────────────────
type CatalogPage={id:string,name:string,description:string,icon:string,route:string,module:string,actions:string[],plan:string,status:string,kind:string,dependsOn:string[],connectors:string[],flags:string[],version:string,modifiedAt?:string|null};
type PagePackage={id:string,name:string,description:string,pages:string[]};
const appOfModule:Record<string,string>={core:'Home & Admin',people:'People',tickets:'Tickets',assets:'Assets',maintenance:'Maintenance',inventory:'Inventory',purchasing:'Purchasing',spaces:'Spaces',files:'Files',reports:'Reports',operations:'Operations',data:'Admin › Data hub',ai:'AI assistant',integrations:'Admin › Connectors',builder:'Pages'};
const planTone=(p:string)=>p==='enterprise'?'violet':p==='business'?'blue':'gray';
function PagesTab({d,act}:{d:Detail,act:(b:Record<string,unknown>,m:string)=>Promise<any>}){
 const {ask}=useApp();
 const catalog=(d.catalog||[]).filter(p=>p.kind==='company');const byId=new Map(catalog.map(p=>[p.id,p]));
 const [pages,setPages]=useState<string[]>(d.pages||[]);const [above,setAbove]=useState(false);
 useEffect(()=>setPages(d.pages||[]),[d.pages]);
 const mods=[...new Set(catalog.map(p=>p.module))];
 const rank:Record<string,number>={starter:0,business:1,enterprise:2};
 const toggle=(id:string,on:boolean)=>{if(on){const add=new Set([...pages,id]);let grew=true;while(grew){grew=false;for(const p of [...add])for(const x of byId.get(p)?.dependsOn||[])if(!add.has(x)){add.add(x);grew=true}}setPages([...add])}else setPages(pages.filter(p=>p!==id&&!(byId.get(p)?.dependsOn||[]).includes(id)))};
 const changed=[...pages].sort().join()!==[...(d.pages||[])].sort().join();
 const apps=[...new Set(['Home & Admin',...pages.map(p=>appOfModule[byId.get(p)?.module||'']).filter(Boolean)])];
 return <div className="split-2">
  <Card title="Pages this company receives" actions={<Btn variant="primary" disabled={!changed} onClick={async()=>{const removed=(d.pages||[]).filter(p=>!pages.includes(p));if(removed.length&&await ask({title:`Remove ${removed.length} page${removed.length===1?'':'s'}?`,body:<>{removed.map(p=>byId.get(p)?.name).join(', ')} will disappear from navigation and their APIs will refuse requests. Existing records are kept.</>,confirm:'Save pages',danger:true})===false)return;const r=await act({action:'pages',pages,allowAbovePlan:above},'Page entitlements saved');if(r?.added?.length)setPages(r.pages)}}>Save pages</Btn>}>
   <div className="row-gap wrap">{(d.packages||[]).map(p=><Btn key={p.id} size="sm" icon="Package" onClick={async()=>{if(await ask({title:`Apply the ${p.name} package?`,body:<>Sets this company's pages to the {p.pages.length} pages in {p.name}. Pages outside it are removed from navigation and refused by the API. Records are kept.</>,confirm:'Apply package'})!==false)act({action:'package',package:p.id},`${p.name} package applied`)}}>{p.name}</Btn>)}</div>
   {mods.map(m=><div key={m} className="page-pick-group"><p className="rail-section">{appOfModule[m]||m}</p><div className="page-pick">{catalog.filter(p=>p.module===m).map(p=>{const over=rank[p.plan]>rank[d.tenant.plan];return <label key={p.id} className={cx('module-card',pages.includes(p.id)&&'on')}><input type="checkbox" checked={pages.includes(p.id)} onChange={e=>toggle(p.id,e.target.checked)}/><div><b>{p.name} {p.status==='beta'&&<Chip tone="amber">Beta</Chip>}{over&&<Chip tone={planTone(p.plan)}>{p.plan}</Chip>}</b><small>{p.description}{p.dependsOn.length?` · needs ${p.dependsOn.map(x=>byId.get(x)?.name||x).join(', ')}`:''}</small></div></label>})}</div></div>)}
   <label className="check"><input type="checkbox" checked={above} onChange={e=>setAbove(e.target.checked)}/>Allow pages above the {d.tenant.plan} plan</label>
   <Note>Removing a page hides it from navigation, blocks direct links and refuses its API for everyone in the company, including administrators. Data is kept. Home, Company settings, Manage users and the activity log are always included.</Note>
  </Card>
  <Card title="Preview: what the company sees"><p className="muted small">Apps in the company's navigation with the selection on the left. Company admins can then give each role a subset of these pages.</p><div className="mini-list">{apps.map(a=><div key={a} className="mini-row"><Icon name="CircleCheck" size={15}/><span>{a}<small>{pages.filter(p=>appOfModule[byId.get(p)?.module||'']===a).map(p=>byId.get(p)?.name).join(' · ')||'Always available'}</small></span></div>)}</div></Card>
 </div>;
}
function PlatformCatalog({tab}:{tab:string}){
 const {toast,ask}=useApp();
 const {data,error,reload}=useApi<{pages:CatalogPage[],packages:PagePackage[],workspaces:{id:string,name:string,plan:string,status:string,pages:string[]}[]}>('/api/platform?view=catalog');
 const [edit,setEdit]=useState<CatalogPage|null>(null),[pkgs,setPkgs]=useState<PagePackage[]|null>(null);
 useEffect(()=>{if(data)setPkgs(data.packages)},[data]);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data||!pkgs)return <div className="page"><Skeleton rows={10}/></div>;
 const assignable=data.pages.filter(p=>p.module!=='platform'&&p.kind!=='core');
 const cols:Col<CatalogPage>[]=[
  {key:'name',label:'Page',render:p=><div className="cell-title"><b>{p.name}</b><small className="mono">{p.id} · #{'/'+p.route}</small></div>},
  {key:'module',label:'Module',width:130,render:p=>appOfModule[p.module]||p.module},
  {key:'kind',label:'Classification',width:140,render:p=><Chip tone={p.kind==='platform'?'red':p.kind==='core'?'violet':'gray'}>{p.kind==='platform'?'Platform-only':p.kind==='core'?'Core (always on)':'Company-assignable'}</Chip>},
  {key:'plan',label:'Required plan',width:120,render:p=><Chip tone={planTone(p.plan)}>{p.plan}</Chip>},
  {key:'status',label:'Status',width:90,render:p=><Chip tone={p.status==='beta'?'amber':'green'}>{p.status}</Chip>},
  {key:'version',label:'Version',width:80},
  {key:'actions',label:'Actions',width:110,render:p=>`${p.actions.length} actions`,value:p=>p.actions.length},
  {key:'dependsOn',label:'Depends on',width:170,render:p=><span className="muted small">{p.dependsOn.join(', ')||'—'}</span>},
  {key:'companies',label:'Companies',width:100,align:'right',render:p=>p.kind==='core'?'All':String(data.workspaces.filter(w=>w.pages.includes(p.id)).length),value:p=>data.workspaces.filter(w=>w.pages.includes(p.id)).length},
 ];
 return <div className="page">
  <Header icon="LayoutGrid" tone="red" title="Page catalog" subtitle="Every page in One Workspace. Decide which pages each company receives, package them into plans, and mark pages beta or platform-only."/>
  <Tabs value={tab} onChange={v=>go(`platform/catalog/${v}`)} items={[{id:'pages',label:'Pages'},{id:'packages',label:'Packages'},{id:'entitlements',label:'Entitlements by company'}]}/>
  {tab==='pages'&&<Grid id="platform-catalog" rows={data.pages} cols={cols} exportName="page-catalog" onOpen={p=>p.kind==='company'||p.kind==='platform'&&p.module!=='platform'?setEdit(p):toast(p.kind==='core'?'Core pages are always available.':'Platform pages cannot be changed.','info')}/>}
  {tab==='packages'&&<Card title="Page packages" actions={<><Btn icon="Plus" onClick={()=>setPkgs([...pkgs,{id:`package-${pkgs.length+1}`,name:'New package',description:'',pages:[]}])}>Add package</Btn><Btn variant="primary" onClick={async()=>{try{await api('/api/platform',{action:'catalog',packages:pkgs});toast('Packages saved');reload()}catch(e){toast((e as Error).message,'error')}}}>Save packages</Btn></>}>
   {pkgs.map((p,i)=><div key={i} className="package-edit"><div className="form-grid"><Field label="Name"><input value={p.name} onChange={e=>setPkgs(pkgs.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/></Field><Field label="Package ID"><input value={p.id} onChange={e=>setPkgs(pkgs.map((x,j)=>j===i?{...x,id:e.target.value}:x))}/></Field><Field label="Description" wide><input value={p.description} onChange={e=>setPkgs(pkgs.map((x,j)=>j===i?{...x,description:e.target.value}:x))}/></Field></div>
    <div className="chip-picks">{assignable.map(c=><button type="button" key={c.id} className={cx('chip-btn',p.pages.includes(c.id)&&'on')} onClick={()=>setPkgs(pkgs.map((x,j)=>j===i?{...x,pages:x.pages.includes(c.id)?x.pages.filter(y=>y!==c.id):[...x.pages,c.id]}:x))}>{c.name}</button>)}</div>
    <div className="row-gap"><span className="muted small">{p.pages.length} pages · dependencies are added when saved</span><div className="grow"/><Btn size="sm" variant="ghost" icon="Trash2" onClick={async()=>{if(await ask({title:`Remove the ${p.name} package?`,body:'Companies keep their current pages.',confirm:'Remove',danger:true})!==false)setPkgs(pkgs.filter((_,j)=>j!==i))}}>Remove</Btn></div></div>)}
  </Card>}
  {tab==='entitlements'&&<Card title="Entitlements by company"><div className="matrix"><table><thead><tr><th>Company</th>{assignable.map(p=><th key={p.id} title={p.description}>{p.name}</th>)}</tr></thead><tbody>{data.workspaces.map(w=><tr key={w.id} className="clickable" onClick={()=>go(`platform/workspaces/${w.id}/pages`)}><th>{w.name}<small className="muted"> · {w.plan}</small></th>{assignable.map(p=><td key={p.id} className="center">{w.pages.includes(p.id)?<Icon name="Check" size={14}/>:<span className="muted">·</span>}</td>)}</tr>)}</tbody></table></div><p className="muted small">Click a company to change its pages.</p></Card>}
  {edit&&<CatalogPageEditor page={edit} all={assignable} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);reload()}}/>}
 </div>;
}
function CatalogPageEditor({page,all,onClose,onSaved}:{page:CatalogPage,all:CatalogPage[],onClose:()=>void,onSaved:()=>void}){
 const {toast}=useApp();const [v,setV]=useState({status:page.status,plan:page.plan,platformOnly:page.kind==='platform',description:page.description,dependsOn:page.dependsOn});const [busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={page.name} subtitle={`${page.id} · version ${page.version} · ${page.actions.join(', ')}`} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{await api('/api/platform',{action:'catalog',page:page.id,changes:v});toast('Page updated');onSaved()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Save</Btn></>}>
  <div className="form-grid">
   <Field label="Status" hint="Beta pages are only given to companies you select."><select value={v.status} onChange={e=>setV({...v,status:e.target.value})}><option value="stable">Stable</option><option value="beta">Beta</option></select></Field>
   <Field label="Required plan"><select value={v.plan} onChange={e=>setV({...v,plan:e.target.value})}><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option></select></Field>
   <Field label="Description" wide><input value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
   <Field label="Depends on" wide hint="Added automatically when this page is given to a company."><TagPicker values={v.dependsOn} options={all.filter(p=>p.id!==page.id).map(p=>p.id)} onChange={x=>setV({...v,dependsOn:x})} placeholder="No dependencies"/></Field>
   <label className="check wide"><input type="checkbox" checked={v.platformOnly} onChange={e=>setV({...v,platformOnly:e.target.checked})}/>Platform-only: refuse this page in every company (data is kept)</label>
  </div>
  {!!page.connectors.length&&<Note>Requires connectors: {page.connectors.join(', ')}</Note>}
 </Modal>;
}
