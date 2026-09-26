'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {api,useApi,go,ago,dateOnly,cx} from './lib';
import {useApp,Btn,Chip,Header,Grid,Modal,Field,DeptSelect,PersonSelect,Who,ErrorNote,Skeleton,Empty,Card,Icon,Note,Stat,Tabs,type Col} from './kit';
import {pageLabels,baseRoleLabels} from '../access-policy';
import CompanyData from '../company-data';

export default function Admin({parts}:{parts:string[]}){
 const {s,can}=useApp();const admin=s.user.role==='admin';
 const view=parts[0]||(admin?'company':can('audit')?'activity':'platform');
 if(view==='roles'&&admin)return <Roles openId={parts[1]}/>;
 if(view==='overrides'&&admin)return <Overrides/>;
 if(view==='data'&&can('company-data'))return <DataHub/>;
 if(view==='activity'&&can('audit'))return <Activity/>;
 if(view==='platform'&&s.user.platformRole)return <Platform/>;
 if(admin)return <Company/>;
 return <div className="page"><Empty icon="Lock" title="Administrator access required"/></div>;
}

// ── Company settings ────────────────────────────────────────────────────────
function Company(){
 const {toast,refresh}=useApp();const {data,error,reload}=useApi<any>('/api/tenant');const [v,setV]=useState<any>(null);const [busy,setBusy]=useState(false);
 useEffect(()=>{if(data)setV({name:data.tenant.name,legalName:data.tenant.legal_name,domains:data.tenant.domains,brandColor:data.tenant.brand_color,currency:data.tenant.currency,timezone:data.tenant.timezone,...data.tenant.settings})},[data]);
 const f=(k:string)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 const integ=data?.integrations||{};
 return <div className="page"><Header icon="Building" tone="gray" title="Company settings" subtitle="Your company's identity in One Workspace, plus numbering and purchasing defaults."/>
  <ErrorNote error={error} onRetry={reload}/>
  {!v?<Skeleton/>:<form className="settings-layout" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api('/api/tenant',v);toast('Settings saved');refresh()}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
   <Card title="Identity"><div className="form-grid">
    <Field label="Workspace name"><input required value={v.name} onChange={f('name')}/></Field><Field label="Legal name" hint="Printed on purchase orders."><input value={v.legalName} onChange={f('legalName')}/></Field>
    <Field label="Company address" wide><input value={v.address||''} onChange={f('address')}/></Field><Field label="Tax ID / TIN"><input value={v.taxId||''} onChange={f('taxId')}/></Field>
    <Field label="Brand colour" hint="Accent used across the workspace."><div className="color-in"><input type="color" value={v.brandColor} onChange={f('brandColor')}/><input value={v.brandColor} onChange={f('brandColor')}/></div></Field>
    <Field label="Company email domains" wide hint="Only these domains can be used for new accounts. Comma separated; leave empty to allow any."><input value={v.domains} onChange={f('domains')} placeholder="company.com, company.com.gh"/></Field>
    <Field label="Currency"><input value={v.currency} maxLength={8} onChange={f('currency')}/></Field><Field label="Time zone"><input value={v.timezone} onChange={f('timezone')}/></Field>
   </div></Card>
   <Card title="Numbering"><div className="form-grid four">
    <Field label="Requisitions"><input value={v.prPrefix||'PR'} onChange={f('prPrefix')}/></Field><Field label="Purchase orders"><input value={v.poPrefix||'PO'} onChange={f('poPrefix')}/></Field><Field label="Tickets"><input value={v.ticketPrefix||'TKT'} onChange={f('ticketPrefix')}/></Field><Field label="Assets"><input value={v.assetPrefix||'AST'} onChange={f('assetPrefix')}/></Field>
   </div><p className="muted small">Numbers look like {v.prPrefix||'PR'}-{new Date().getFullYear()}-0001 and restart each year. Asset codes run continuously.</p></Card>
   <Card title="Lists & defaults"><div className="form-grid">
    <Field label="Ticket categories" wide><input value={v.ticketCategories||''} onChange={f('ticketCategories')} placeholder="Hardware, Software, Network, Facilities…"/></Field>
    <Field label="Asset categories" wide><input value={v.assetCategories||''} onChange={f('assetCategories')} placeholder="Laptop, Printer, Vehicle, Machinery…"/></Field>
    <Field label="Default purchase order terms" wide><textarea rows={3} value={v.poTerms||''} onChange={f('poTerms')}/></Field>
   </div></Card>
   <Card title="Connections"><div className="integrations">{[['Email notifications',integ.email,'Mail','Add RESEND_API_KEY and MAIL_FROM to the site secrets to email approvers, assignees and vendors.'],['File storage',integ.storage,'HardDrive','Documents, attachments and recordings.'],['AssemblyAI',integ.assemblyai,'AudioLines','Primary research transcription.'],['Groq / Whisper',integ.groq,'Cpu','Secondary research transcription.']].map(([n,ok,i,d])=><div key={n as string} className="integration"><span className={`stat-icon tone-${ok?'green':'gray'}`}><Icon name={i as string} size={16}/></span><div><b>{n}</b><small>{d}</small></div><Chip tone={ok?'green':'gray'}>{ok?'Connected':'Not set up'}</Chip></div>)}</div></Card>
   <div className="editor-bar"><Btn type="submit" variant="primary" busy={busy}>Save settings</Btn></div>
  </form>}
 </div>;
}

// ── Roles & permissions (custom roles with a permission matrix) ─────────────
type Role={id?:string,name:string,description:string,base:string,permissions:Record<string,Record<string,string>>,locations:string[],default_screen:string,members?:number,updated_at?:string,updated_by?:string,effective?:Record<string,Record<string,string>>};
const groups:[string,string[]][]=[['Everyday',['overview','people','knowledge','documents','locations']],['Service & assets',['maintenance','assets','it']],['Purchasing',['requests','procurement','suppliers','receipts','inventory','budgets']],['Specialist & admin',['research','company-data','audit','settings']]];
function Roles({openId}:{openId?:string}){
 const {toast,ask,refresh}=useApp();const {data,error,reload}=useApi<{roles:Role[],pageActions:Record<string,string[]>,defaults:Record<string,Record<string,Record<string,string>>>}>('/api/roles');
 const [edit,setEdit]=useState<Role|null>(null);
 useEffect(()=>{if(data&&openId){const r=openId==='new'?{name:'',description:'',base:'employee',permissions:{},locations:[],default_screen:''}:data.roles.find(x=>x.id===openId);if(r)setEdit(JSON.parse(JSON.stringify(r)))}else setEdit(null)},[data,openId]);
 const cols:Col<Role&{id:string}>[]=[{key:'name',label:'Role name',render:r=><div className="cell-title"><b>{r.name}</b><small>{r.description}</small></div>},{key:'base',label:'Role type',width:170,render:r=><Chip tone={r.base==='admin'?'violet':r.base==='manager'?'blue':'gray'}>{baseRoleLabels[r.base]}</Chip>},{key:'members',label:'People',width:90,align:'right'},{key:'perms',label:'Custom permissions',width:170,render:r=>`${Object.values(r.permissions).reduce((n,a)=>n+Object.keys(a).length,0)} rules`,value:r=>Object.keys(r.permissions).length},{key:'locations',label:'Location scope',width:160,render:r=>r.locations.length?`${r.locations.length} locations`:<span className="muted">All</span>,value:r=>r.locations.length},{key:'updated_at',label:'Modified',width:140,render:r=><span className="muted">{r.updated_at?dateOnly(r.updated_at):''} · {r.updated_by}</span>}];
 return <div className="page"><Header icon="ShieldCheck" tone="gray" title="Roles & permissions" subtitle="Each role has a type (its baseline access) plus exact page permissions and an optional location scope. People get a role in Manage users." actions={<Btn variant="primary" icon="Plus" onClick={()=>go('admin/roles/new')}>Create role</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="roles" rows={data.roles as (Role&{id:string})[]} cols={cols} onOpen={r=>go(`admin/roles/${r.id}`)} exportName="roles"/>}
  {edit&&data&&<RoleEditor role={edit} setRole={setEdit} pageActions={data.pageActions} defaults={data.defaults} onClose={()=>go('admin/roles')} onSave={async()=>{try{await api('/api/roles',edit);toast('Role saved. It applies from each person’s next request.');reload();refresh();go('admin/roles')}catch(e){toast((e as Error).message,'error')}}} onDelete={edit.id?async()=>{if(await ask({title:`Delete role “${edit.name}”?`,confirm:'Delete',danger:true})===false)return;try{await api('/api/roles',{action:'delete',id:edit.id});reload();refresh();go('admin/roles')}catch(e){toast((e as Error).message,'error')}}:undefined}/>}
 </div>;
}
function RoleEditor({role,setRole,pageActions,defaults,onClose,onSave,onDelete}:{role:Role,setRole:(r:Role)=>void,pageActions:Record<string,string[]>,defaults:Record<string,Record<string,Record<string,string>>>,onClose:()=>void,onSave:()=>void,onDelete?:()=>void}){
 const {s}=useApp();const [locQ,setLocQ]=useState('');const [busy,setBusy]=useState(false);
 const allActions=['view','create','update','approve','assign','upload','download','process','publish','manage_devices','manage_members','export'];
 const base=defaults[role.base]||{};
 function setCell(page:string,action:string,val:string){const p={...role.permissions};const acts={...(p[page]||{})};if(val==='')delete acts[action];else acts[action]=val;if(Object.keys(acts).length)p[page]=acts;else delete p[page];setRole({...role,permissions:p})}
 const shared=(p:string)=>['it','research','company-data'].includes(p);
 const locs=s.locations.filter(l=>!role.locations.includes(l.path)&&l.path.toLowerCase().includes(locQ.toLowerCase())).slice(0,8);
 return <Modal open wide onClose={onClose} title={role.id?'Update role & permissions':'Create role'} footer={<>{onDelete&&<Btn variant="danger" icon="Trash2" onClick={onDelete}>Delete</Btn>}<div className="grow"/><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);await onSave();setBusy(false)}}>Save role</Btn></>}>
  <div className="form-grid">
   <Field label="Role name"><input required value={role.name} onChange={e=>setRole({...role,name:e.target.value})} placeholder="e.g. PR User"/></Field>
   <Field label="Role type" hint="Admin sees everything. Department Heads manage their department. Standard Users work their own items. Viewers read only."><select value={role.base} onChange={e=>setRole({...role,base:e.target.value})}>{['admin','manager','employee','viewer'].map(b=><option key={b} value={b}>{baseRoleLabels[b]}</option>)}</select></Field>
   <Field label="Description" wide><input value={role.description} onChange={e=>setRole({...role,description:e.target.value})}/></Field>
   <Field label="Asset location scope" wide hint="Assets under these locations only. Leave empty for all locations."><div className="tag-input">{role.locations.map(l=><span key={l} className="tag">{l}<button type="button" onClick={()=>setRole({...role,locations:role.locations.filter(x=>x!==l)})}><Icon name="X" size={12}/></button></span>)}<input value={locQ} onChange={e=>setLocQ(e.target.value)} placeholder={s.locations.length?'Add location…':'Add locations in People → Locations first'}/></div>{locQ&&<div className="tag-suggest">{locs.map(l=><button type="button" key={l.id} onClick={()=>{setRole({...role,locations:[...role.locations,l.path]});setLocQ('')}}>{l.path}</button>)}</div>}</Field>
  </div>
  {role.base==='admin'?<Note>Admin roles have full access to everything; the matrix does not apply.</Note>:<>
  <h3 className="section-title">Permissions <span className="muted small">— “Default” inherits from the role type (shown in grey)</span></h3>
  <div className="matrix"><table><thead><tr><th>Page</th>{allActions.map(a=><th key={a}>{a.replace('manage_','manage ').replace('_',' ')}</th>)}</tr></thead><tbody>{groups.map(([g,pages])=><Fragment key={g}><tr className="matrix-group"><td colSpan={allActions.length+1}>{g}</td></tr>{pages.filter(p=>pageActions[p]).map(p=><tr key={p}><th>{pageLabels[p]}</th>{allActions.map(a=>{if(!pageActions[p].includes(a))return <td key={a} className="na"/>;const cur=role.permissions[p]?.[a]||'';const inherited=base[p]?.[a]||'none';return <td key={a}><select className={cx('scope-sel',cur?`sc-${cur}`:'inherit')} value={cur} onChange={e=>setCell(p,a,e.target.value)} title={`Default: ${inherited}`}><option value="">{`· ${inherited==='none'?'—':inherited}`}</option><option value="none">None</option>{!shared(p)&&<option value="own">Own</option>}{!shared(p)&&<option value="department">Dept</option>}<option value="all">All</option></select></td>})}</tr>)}</Fragment>)}</tbody></table></div>
  <p className="muted small">Own = records they created. Dept = records of their department. All = every record on the page. People must also be able to <b>view</b> a page to use its other actions.</p></>}
 </Modal>;
}

// ── Overrides (per person / base role / department) ─────────────────────────
function Overrides(){
 const {s,toast,refresh}=useApp();const {data,error,reload}=useApi<{members:{id:string,name:string,role:string,department:string,permissions:Record<string,Record<string,string>>}[],rules:any[],pageActions:Record<string,string[]>}>('/api/permissions');
 const [form,setForm]=useState({subject_type:'user',subject_id:'',department:'*',page:'assets',action:'view',effect:'allow',scope:'department'});const [preview,setPreview]=useState<string|null>(null);
 async function save(body:unknown){try{await api('/api/permissions',body);toast('Saved');reload();refresh()}catch(e){toast((e as Error).message,'error')}}
 const shared=['it','research','company-data'].includes(form.page);
 return <div className="page"><Header icon="KeyRound" tone="gray" title="Access overrides" subtitle="Exceptions on top of roles: grant or deny a single action for one person, a base access level, or a whole department. A person override wins over their role."/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<>
  <Card title="Add an override"><form className="form-grid four" onSubmit={e=>{e.preventDefault();save(form)}}>
   <Field label="Apply to"><select value={form.subject_type} onChange={e=>setForm({...form,subject_type:e.target.value,subject_id:e.target.value==='role'?'employee':e.target.value==='department'?s.departments[0]?.name||'':''})}><option value="user">A person</option><option value="role">An access level</option><option value="department">A department</option></select></Field>
   <Field label="Who">{form.subject_type==='user'?<PersonSelect value={form.subject_id||null} onChange={v=>setForm({...form,subject_id:v||''})} filter={p=>p.role!=='admin'}/>:form.subject_type==='role'?<select value={form.subject_id} onChange={e=>setForm({...form,subject_id:e.target.value})}>{['manager','employee','viewer'].map(r=><option key={r} value={r}>{baseRoleLabels[r]}</option>)}</select>:<DeptSelect value={form.subject_id} onChange={v=>setForm({...form,subject_id:v})}/>}</Field>
   <Field label="When they are in"><DeptSelect value={form.department} any="*" onChange={v=>setForm({...form,department:v||'*'})}/></Field>
   <Field label="Page"><select value={form.page} onChange={e=>setForm({...form,page:e.target.value,action:'view',scope:['it','research','company-data'].includes(e.target.value)?'all':'department'})}>{Object.keys(data.pageActions).map(p=><option key={p} value={p}>{pageLabels[p]}</option>)}</select></Field>
   <Field label="Action"><select value={form.action} onChange={e=>setForm({...form,action:e.target.value})}>{data.pageActions[form.page].map(a=><option key={a}>{a}</option>)}</select></Field>
   <Field label="Effect"><select value={form.effect} onChange={e=>setForm({...form,effect:e.target.value})}><option value="allow">Allow</option><option value="deny">Deny</option></select></Field>
   <Field label="Records"><select value={form.scope} onChange={e=>setForm({...form,scope:e.target.value})}>{!shared&&<option value="own">Their own</option>}{!shared&&<option value="department">Their department</option>}<option value="all">All</option></select></Field>
   <div className="form-actions"><Btn type="submit" variant="primary" disabled={!form.subject_id}>Save override</Btn></div>
  </form></Card>
  <Card title={`Current overrides · ${data.rules.length}`} pad={false}>{!data.rules.length?<p className="card-pad muted">No overrides. Roles and defaults apply.</p>:<table className="plain"><thead><tr><th>Applies to</th><th>In department</th><th>Page · action</th><th>Access</th><th/></tr></thead><tbody>{data.rules.map(r=><tr key={r.id}><td>{r.subject_type==='user'?<Who id={r.subject_id}/>:r.subject_type==='role'?baseRoleLabels[r.subject_id]:`Department: ${r.subject_id}`}</td><td>{r.department==='*'?'Any':r.department}</td><td>{pageLabels[r.page]} · {r.action}</td><td><Chip tone={r.effect==='deny'?'red':'green'}>{r.effect} · {r.scope}</Chip></td><td><Btn size="sm" variant="ghost" onClick={()=>save({remove:true,id:r.id})}>Restore default</Btn></td></tr>)}</tbody></table>}</Card>
  <Card title="Check someone's effective access"><PersonSelect value={preview} onChange={setPreview}/>{preview&&(()=>{const m=data.members.find(x=>x.id===preview);if(!m)return null;return <div className="access-grid">{Object.entries(m.permissions).map(([p,acts])=>{const on=Object.entries(acts).filter(([,v])=>v!=='none');return <div key={p} className={cx('access-cell',!on.length&&'off')}><b>{pageLabels[p]}</b>{on.length?<small>{on.map(([a,v])=>`${a}: ${v}`).join(' · ')}</small>:<small>No access</small>}</div>})}</div>})()}</Card>
  </>}
 </div>;
}

// ── Data hub ────────────────────────────────────────────────────────────────
function DataHub(){
 const {s,toast,ask}=useApp();const status=useApi<{datasets:{dataset:string,rows:number}[],promoted:{kind:string,n:number}[]}>(s.user.role==='admin'?'/api/import':null);const [busy,setBusy]=useState(false),[tab,setTab]=useState('promote');
 const labels:Record<string,string>={'assets':'Asset register','it-assets':'IT assets',tickets:'Tickets','purchase-requisitions':'Purchase requisitions','purchase-orders':'Purchase orders',locations:'Locations',staff:'Staff','inventory-balances':'Inventory balances','goods-receipts':'Goods receipts',budgets:'Budgets'};
 async function promote(){if(await ask({title:'Promote imported data to live records?',body:'Creates live assets, tickets, requisitions, purchase orders, vendors and locations from the latest imported snapshots. Rows already promoted are skipped, so this is safe to repeat.',confirm:'Promote'})===false)return;setBusy(true);try{const r=await api<{processed:Record<string,number>}>('/api/import',{});toast(`Processed ${Object.entries(r.processed).filter(([,n])=>n).map(([k,n])=>`${n} ${k}`).join(', ')||'nothing new'}`);status.reload()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}
 return <div className="page"><Header icon="DatabaseZap" tone="gray" title="Data hub" subtitle="Snapshots imported from earlier systems (e.g. AssetInfinity exports), and the tools to turn them into live records."/>
  <Tabs value={tab} onChange={setTab} items={[...(s.user.role==='admin'?[{id:'promote',label:'Promote to live'}]:[]),{id:'archive',label:'Source archive'}]}/>
  {tab==='promote'&&s.user.role==='admin'?<>{!status.data?<Skeleton/>:<><div className="stats">{status.data.promoted.map(p=><Stat key={p.kind} label={`Live ${p.kind} from imports`} value={p.n}/>)}</div>
   <Card title="Latest imported snapshots" actions={<Btn variant="primary" icon="Sparkles" busy={busy} onClick={promote}>Promote to live records</Btn>}>{!status.data.datasets.length?<p className="muted">No imported snapshots in this workspace.</p>:<div className="mini-list">{status.data.datasets.map(d=><div key={d.dataset} className="mini-row"><Icon name="Table" size={15}/><span>{labels[d.dataset]||d.dataset}</span><b>{d.rows.toLocaleString()} rows</b></div>)}</div>}<Note>Staff are imported from Manage users → Import. Inventory, receipts and budgets stay as read-only registers under Operations.</Note></Card></>}</>:<div className="legacy"><CompanyData role="admin"/></div>}
 </div>;
}

// ── Activity log ────────────────────────────────────────────────────────────
function Activity(){
 const {person}=useApp();const [q,setQ]=useState('');const [debounced,setD]=useState('');useEffect(()=>{const t=setTimeout(()=>setD(q),300);return()=>clearTimeout(t)},[q]);
 const {data,error,reload}=useApi<{events:{id:string,action:string,actor:string,department:string,recordId:string,createdAt:string}[]}>('/api/audit?q='+encodeURIComponent(debounced));
 const days=useMemo(()=>{const m=new Map<string,any[]>();for(const e of data?.events||[]){const d=dateOnly(e.createdAt);m.set(d,[...(m.get(d)||[]),e])}return [...m]},[data]);
 return <div className="page"><Header icon="History" tone="gray" title="Activity log" subtitle="A server-recorded history of sign-ins, changes, approvals and access decisions."/>
  <div className="filter-row"><div className="grid-search big"><Icon name="Search" size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search actions or record IDs"/></div><Btn icon="RefreshCw" variant="ghost" onClick={reload}>Refresh</Btn></div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.events.length?<Empty icon="History" title="No activity found"/>:days.map(([d,events])=><section key={d} className="activity-day"><h3>{d}</h3>{events.map((e:any)=><div key={e.id} className="activity-row"><span className="activity-time">{new Date(e.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span><Who id={e.actor} fallback={person(e.actor)?.name||'System'}/><span className="activity-action">{e.action}</span>{e.department&&<Chip tone="gray">{e.department}</Chip>}</div>)}</section>)}
 </div>;
}

// ── Platform console ────────────────────────────────────────────────────────
function Platform(){
 const {toast,ask,s}=useApp();const {data,error,reload}=useApi<{tenants:any[]}>('/api/platform');const [creating,setCreating]=useState(false);
 const cols:Col<any>[]=[{key:'name',label:'Company',render:t=><span className="who"><span className="tenant-mark" style={{background:t.brandColor}}>{t.name[0]}</span><span>{t.name}<small>{t.slug} · {t.domains||'any domain'}</small></span></span>},{key:'status',label:'Status',width:110,render:t=><Chip>{t.status}</Chip>},{key:'plan',label:'Plan',width:110},{key:'members',label:'People',width:90,align:'right'},{key:'assets',label:'Assets',width:90,align:'right'},{key:'tickets',label:'Tickets',width:90,align:'right'},{key:'purchasing',label:'PR/PO',width:90,align:'right'},{key:'lastActive',label:'Last active',width:130,render:t=><span className="muted">{ago(t.lastActive)}</span>},{key:'createdAt',label:'Created',width:120,render:t=>dateOnly(t.createdAt)},{key:'actions',label:'',width:130,sortable:false,render:t=>t.id!==s.tenant.id&&<Btn size="sm" variant={t.status==='active'?'ghost':'default'} onClick={async(e)=>{e.stopPropagation();const next=t.status==='active'?'suspended':'active';if(await ask({title:`${next==='suspended'?'Suspend':'Reactivate'} ${t.name}?`,body:next==='suspended'?'Everyone in this workspace is signed out and cannot sign in until it is reactivated. Data is kept.':undefined,confirm:next==='suspended'?'Suspend':'Reactivate',danger:next==='suspended'})===false)return;try{await api('/api/platform',{action:'status',id:t.id,status:next});reload()}catch(err){toast((err as Error).message,'error')}}}>{t.status==='active'?'Suspend':'Reactivate'}</Btn>}];
 return <div className="page"><Header icon="Globe" tone="gray" title="Platform console" subtitle="Provision company workspaces. Each company's data is isolated; this console only sees workspace metadata and counts." actions={<Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>New company workspace</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&<div className="stats"><Stat label="Workspaces" value={data.tenants.length} icon="Building" tone="violet"/><Stat label="Active" value={data.tenants.filter(t=>t.status==='active').length} icon="CircleCheck" tone="green"/><Stat label="People across workspaces" value={data.tenants.reduce((n,t)=>n+t.members,0)} icon="Users" tone="sky"/></div>}
  {!data?<Skeleton/>:<Grid id="tenants" rows={data.tenants} cols={cols} exportName="workspaces"/>}
  {creating&&<NewTenant onClose={()=>setCreating(false)} onDone={()=>{setCreating(false);reload()}}/>}
 </div>;
}
function NewTenant({onClose,onDone}:{onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [v,setV]=useState({name:'',legalName:'',slug:'',domains:'',adminName:'',adminEmail:'',password:'',currency:'GHS',timezone:'Africa/Accra',brandColor:'#6D5EF8',plan:'business'});const [busy,setBusy]=useState(false);const [done,setDone]=useState<{slug:string}|null>(null);
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV(x=>({...x,[k]:e.target.value,...(k==='name'&&!x.slug?{}:{})}));
 return <Modal open wide onClose={onClose} title="New company workspace" subtitle="Creates the company, its first administrator, starter departments, roles, approval workflows and a welcome page." footer={done?<Btn variant="primary" onClick={onDone}>Done</Btn>:<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{const r=await api<{slug:string}>('/api/platform',{action:'create',...v});setDone(r);toast('Workspace created')}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Create workspace</Btn></>}>
  {done?<Note tone="ok">Workspace <b>{done.slug}</b> is ready. Send <b>{v.adminEmail}</b> the sign-in address and temporary password privately; they will set their own password at first sign-in and can then invite their team.</Note>:<div className="form-grid">
   <Field label="Company name"><input value={v.name} onChange={e=>setV({...v,name:e.target.value,slug:v.slug||e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)})}/></Field><Field label="Legal name"><input value={v.legalName} onChange={f('legalName')}/></Field>
   <Field label="Workspace ID" hint="Lowercase letters, numbers and dashes."><input value={v.slug} onChange={f('slug')}/></Field><Field label="Email domains" hint="e.g. acme.com"><input value={v.domains} onChange={f('domains')}/></Field>
   <Field label="Currency"><input value={v.currency} onChange={f('currency')}/></Field><Field label="Brand colour"><input type="color" value={v.brandColor} onChange={f('brandColor')}/></Field>
   <Field label="Plan"><select value={v.plan} onChange={f('plan')}><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option></select></Field><Field label="Time zone"><input value={v.timezone} onChange={f('timezone')}/></Field>
   <Field label="Administrator name"><input value={v.adminName} onChange={f('adminName')}/></Field><Field label="Administrator email"><input type="email" value={v.adminEmail} onChange={f('adminEmail')}/></Field>
   <Field label="Temporary password" wide hint="At least 12 characters. Share it privately."><input value={v.password} onChange={f('password')} autoComplete="new-password"/></Field>
  </div>}
 </Modal>;
}
