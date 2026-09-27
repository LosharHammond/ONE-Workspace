'use client';
import {Fragment,useEffect,useMemo,useState} from 'react';
import {api,useApi,go,dateOnly,cx} from './lib';
import {TagPicker,useApp,Btn,Chip,Header,Grid,Modal,Field,DeptSelect,PersonSelect,Who,ErrorNote,Skeleton,Empty,Card,Icon,Note,Stat,Tabs,type Col} from './kit';
import {pageLabels,baseRoleLabels} from '../access-policy';
import CompanyData from '../company-data';
import {modules as moduleCatalog} from '../modules';

export default function Admin({parts}:{parts:string[]}){
 const {s,can}=useApp();const admin=s.user.role==='admin';
 const view=parts[0]||(admin?'company':'activity');
 if(view==='roles'&&admin)return <Roles openId={parts[1]}/>;
 if(view==='overrides'&&admin)return <Overrides/>;
 if(view==='data'&&can('company-data'))return <DataHub/>;
 if(view==='activity'&&can('audit'))return <Activity/>;
 if(view==='security'&&admin)return <Activity security/>;
 if(admin)return <Company/>;
 return <div className="page"><Empty icon="Lock" title="Administrator access required"/></div>;
}

// ── Company settings ────────────────────────────────────────────────────────
function Company(){
 const {s,toast,refresh}=useApp();const {data,error,reload}=useApi<any>('/api/tenant');const [v,setV]=useState<any>(null);const [busy,setBusy]=useState(false);
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
    <Field label="Requisitions"><input value={v.prPrefix||'PR'} onChange={f('prPrefix')}/></Field><Field label="Purchase orders"><input value={v.poPrefix||'PO'} onChange={f('poPrefix')}/></Field><Field label="Tickets"><input value={v.ticketPrefix||'TKT'} onChange={f('ticketPrefix')}/></Field><Field label="Assets"><input value={v.assetPrefix||'AST'} onChange={f('assetPrefix')}/></Field><Field label="Work orders"><input value={v.woPrefix||'WO'} onChange={f('woPrefix')}/></Field>
   </div><p className="muted small">Numbers look like {v.prPrefix||'PR'}-{new Date().getFullYear()}-0001 and restart each year. Asset codes run continuously.</p></Card>
   <Card title="Lists & defaults"><div className="form-grid">
    <Field label="Ticket categories" wide><input value={v.ticketCategories||''} onChange={f('ticketCategories')} placeholder="Hardware, Software, Network, Facilities…"/></Field>
    <Field label="Asset categories" wide><input value={v.assetCategories||''} onChange={f('assetCategories')} placeholder="Laptop, Printer, Vehicle, Machinery…"/></Field>
    <Field label="Inventory categories" wide><input value={v.inventoryCategories||''} onChange={f('inventoryCategories')} placeholder="Consumables, Spare parts, Packaging…"/></Field>
    <Field label="Default purchase order terms" wide><textarea rows={3} value={v.poTerms||''} onChange={f('poTerms')}/></Field>
   </div></Card>
   <Card title="Modules"><div className="chips-wrap">{moduleCatalog.map(m=><Chip key={m.id} tone={(s.tenant.modules||[]).includes(m.id)?'green':'gray'}>{m.label}</Chip>)}</div><p className="muted small">Modules and plan limits are managed by the Platform Owner.</p></Card>
   <Card title="Connections"><div className="integrations">{[['Email notifications',integ.email,'Mail','Add RESEND_API_KEY and MAIL_FROM to the site secrets to email approvers, assignees and vendors.'],['File storage',integ.storage,'HardDrive','Documents, attachments and recordings.'],['AssemblyAI',integ.assemblyai,'AudioLines','Primary research transcription.'],['Groq / Whisper',integ.groq,'Cpu','Secondary research transcription.']].map(([n,ok,i,d])=><div key={n as string} className="integration"><span className={`stat-icon tone-${ok?'green':'gray'}`}><Icon name={i as string} size={16}/></span><div><b>{n}</b><small>{d}</small></div><Chip tone={ok?'green':'gray'}>{ok?'Connected':'Not set up'}</Chip></div>)}</div></Card>
   <div className="editor-bar"><Btn type="submit" variant="primary" busy={busy}>Save settings</Btn></div>
  </form>}
 </div>;
}

// ── Roles & permissions (custom roles with a permission tree, record scopes and a preview) ─
type RoleScope={departments?:string[],assetCategories?:string[],assetStatuses?:string[]};
type Role={id?:string,name:string,description:string,base:string,permissions:Record<string,Record<string,string>>,locations:string[],scope:RoleScope,vendor_access?:number,assigned_only?:number,template?:string,default_screen:string,members?:number,updated_at?:string,updated_by?:string,effective?:Record<string,Record<string,string>>};
type Template={id:string,name:string,description:string,base:string,permissions:Record<string,Record<string,string>>};
const groups:[string,string[]][]=[['Everyday',['overview','people','knowledge','documents','locations','reports']],['Help desk & assets',['maintenance','assets','schedules','it']],['Purchasing & stock',['requests','procurement','suppliers','receipts','budgets','inventory']],['Specialist & administration',['research','company-data','audit','settings']]];
const allActions=['view','create','update','delete','approve','assign','upload','download','process','publish','manage_devices','manage_members','import','export','configure'];
const landing=[['','Home'],['tickets/requested','My tickets'],['tickets/queue','Ticket queue'],['tickets/new','New ticket'],['purchasing/inbox','Approvals inbox'],['purchasing/pr','Requisitions'],['assets/mine','My assets'],['assets/all','Asset register'],['inventory/items','Inventory'],['maintenance/mine','My work orders'],['spaces','Spaces']];
function Roles({openId}:{openId?:string}){
 const {toast,ask,refresh}=useApp();const {data,error,reload}=useApi<{roles:Role[],templates:Template[],pageActions:Record<string,string[]>,defaults:Record<string,Record<string,Record<string,string>>>}>('/api/roles');
 const [edit,setEdit]=useState<Role|null>(null);
 useEffect(()=>{if(data&&openId){const r=openId==='new'?{name:'',description:'',base:'employee',permissions:{},locations:[],scope:{},default_screen:'',template:'custom'}:data.roles.find(x=>x.id===openId);if(r)setEdit(JSON.parse(JSON.stringify(r)))}else setEdit(null)},[data,openId]);
 const cols:Col<Role&{id:string}>[]=[{key:'name',label:'Role name',render:r=><div className="cell-title"><b>{r.name}</b><small>{r.description}</small></div>},{key:'base',label:'Role type',width:170,render:r=><Chip tone={r.base==='admin'?'violet':r.base==='manager'?'blue':'gray'}>{baseRoleLabels[r.base]}</Chip>},{key:'members',label:'People',width:90,align:'right'},{key:'perms',label:'Custom permissions',width:170,render:r=>`${Object.values(r.permissions).reduce((n,a)=>n+Object.keys(a).length,0)} rules`,value:r=>Object.keys(r.permissions).length},{key:'scope',label:'Record scope',width:200,render:r=>{const n=(r.locations?.length||0)+(r.scope?.departments?.length||0)+(r.scope?.assetCategories?.length||0)+(r.scope?.assetStatuses?.length||0);return n?`${n} filters${r.assigned_only?' · assigned only':''}`:r.assigned_only?'Assigned assets only':<span className="muted">No extra filters</span>},value:r=>r.locations?.length||0},{key:'updated_at',label:'Modified',width:150,render:r=><span className="muted">{r.updated_at?dateOnly(r.updated_at):''} · {r.updated_by}</span>}];
 return <div className="page"><Header icon="ShieldCheck" tone="gray" title="Roles & permissions" subtitle="Deny by default: a role gets its type's baseline plus the exact permissions and record scopes set here. People must be able to view a page before any other action on it works." actions={<Btn variant="primary" icon="Plus" onClick={()=>go('admin/roles/new')}>Create role</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="roles" rows={data.roles as (Role&{id:string})[]} cols={cols} onOpen={r=>go(`admin/roles/${r.id}`)} exportName="roles"/>}
  {edit&&data&&<RoleEditor role={edit} setRole={setEdit} templates={data.templates} pageActions={data.pageActions} defaults={data.defaults} onClose={()=>go('admin/roles')} onSave={async()=>{try{await api('/api/roles',{...edit,vendorAccess:!!edit.vendor_access,assignedOnly:!!edit.assigned_only,defaultScreen:edit.default_screen});toast('Role saved. It applies from each person’s next request.');reload();refresh();go('admin/roles')}catch(e){toast((e as Error).message,'error')}}} onDelete={edit.id?async()=>{if(await ask({title:`Delete role “${edit.name}”?`,body:'Roles still assigned to people cannot be deleted.',confirm:'Delete',danger:true})===false)return;try{await api('/api/roles',{action:'delete',id:edit.id});reload();refresh();go('admin/roles')}catch(e){toast((e as Error).message,'error')}}:undefined}/>}
 </div>;
}
function RoleEditor({role,setRole,templates,pageActions,defaults,onClose,onSave,onDelete}:{role:Role,setRole:(r:Role)=>void,templates:Template[],pageActions:Record<string,string[]>,defaults:Record<string,Record<string,Record<string,string>>>,onClose:()=>void,onSave:()=>void,onDelete?:()=>void}){
 const {s}=useApp();const [busy,setBusy]=useState(false),[tab,setTab]=useState('permissions');
 const base=defaults[role.base]||{};
 const effective=(p:string,a:string)=>role.base==='admin'?'all':role.permissions[p]?.[a]||base[p]?.[a]||'none';
 function setCell(page:string,action:string,val:string){const p={...role.permissions};const acts={...(p[page]||{})};if(val==='')delete acts[action];else acts[action]=val;if(Object.keys(acts).length)p[page]=acts;else delete p[page];setRole({...role,permissions:p})}
 const shared=(p:string)=>['it','research','company-data'].includes(p);
 const cats=String(s.tenant.settings.assetCategories||'').split(',').map(x=>x.trim()).filter(Boolean);
 const scope=role.scope||{};const setScope=(k:keyof RoleScope,v:string[])=>setRole({...role,scope:{...scope,[k]:v}});
 return <Modal open wide onClose={onClose} title={role.id?'Update role & permissions':'Create role'} footer={<>{onDelete&&<Btn variant="danger" icon="Trash2" onClick={onDelete} disabled={!!role.members}>Delete</Btn>}<div className="grow"/><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);await onSave();setBusy(false)}}>Save role</Btn></>}>
  <div className="form-grid">
   {!role.id&&<Field label="Start from a baseline" wide hint="Copies the baseline's type and permissions; adjust anything below."><select value={role.template||'custom'} onChange={e=>{const t=templates.find(x=>x.id===e.target.value);setRole(t?{...role,template:t.id,base:t.base,permissions:JSON.parse(JSON.stringify(t.permissions)),name:role.name||t.name,description:role.description||t.description}:{...role,template:'custom'})}}><option value="custom">Custom role</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} — {t.description}</option>)}</select></Field>}
   <Field label="Role name"><input required value={role.name} onChange={e=>setRole({...role,name:e.target.value})} placeholder="e.g. PR User"/></Field>
   <Field label="Role type" hint="The baseline this role builds on."><select value={role.base} onChange={e=>setRole({...role,base:e.target.value})}>{['admin','manager','employee','viewer'].map(b=><option key={b} value={b}>{b==='admin'?'Company Admin':baseRoleLabels[b]}</option>)}</select></Field>
   <Field label="Description" wide><input value={role.description} onChange={e=>setRole({...role,description:e.target.value})}/></Field>
   <Field label="Default landing screen"><select value={role.default_screen} onChange={e=>setRole({...role,default_screen:e.target.value})}>{landing.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field>
   <div className="field"><span className="field-label">Options</span><label className="check"><input type="checkbox" checked={!!role.vendor_access} onChange={e=>setRole({...role,vendor_access:e.target.checked?1:0})}/>Vendor access (view and maintain vendors)</label><label className="check"><input type="checkbox" checked={!!role.assigned_only} onChange={e=>setRole({...role,assigned_only:e.target.checked?1:0})}/>Show allotted assets only</label></div>
  </div>
  <Tabs value={tab} onChange={setTab} items={[{id:'permissions',label:'Permission tree'},{id:'scope',label:'Record scope'},{id:'preview',label:'Permission preview'}]}/>
  {tab==='permissions'&&(role.base==='admin'?<Note>Company Admin roles have full access inside this workspace; the tree does not apply. They can never reach the Platform Console.</Note>:<>
   <div className="matrix"><table><thead><tr><th>Module / page</th>{allActions.map(a=><th key={a}>{a.replace('manage_','manage ').replace('_',' ')}</th>)}</tr></thead><tbody>{groups.map(([g,pages])=><Fragment key={g}><tr className="matrix-group"><td colSpan={allActions.length+1}>{g}</td></tr>{pages.filter(p=>pageActions[p]).map(p=><tr key={p}><th>{pageLabels[p]}</th>{allActions.map(a=>{if(!pageActions[p].includes(a))return <td key={a} className="na"/>;const cur=role.permissions[p]?.[a]||'';const inherited=base[p]?.[a]||'none';return <td key={a}><select aria-label={`${pageLabels[p]} ${a}`} className={cx('scope-sel',cur?`sc-${cur}`:'inherit')} value={cur} onChange={e=>setCell(p,a,e.target.value)} title={`Baseline: ${inherited}`}><option value="">{`· ${inherited==='none'?'—':inherited}`}</option><option value="none">None</option>{!shared(p)&&<option value="own">Own</option>}{!shared(p)&&<option value="department">Dept</option>}<option value="all">All</option></select></td>})}</tr>)}</Fragment>)}</tbody></table></div>
   <p className="muted small">Grey = inherited from the role type. Own = records they created. Dept = their department plus any selected departments on the Record scope tab. All = every record in this workspace.</p></>)}
  {tab==='scope'&&<div className="form-grid">
   <Field label="Selected departments" wide hint="Counts as their own department wherever a permission is set to Dept."><TagPicker values={scope.departments||[]} options={s.departments.map(d=>d.name)} onChange={v=>setScope('departments',v)} placeholder="Only their own department"/></Field>
   <Field label="Asset location scope" wide hint="Assets at or under these locations only."><TagPicker values={role.locations} options={s.locations.map(l=>l.path)} onChange={v=>setRole({...role,locations:v})} placeholder="All locations"/></Field>
   <Field label="Asset category scope" wide><TagPicker values={scope.assetCategories||[]} options={cats} onChange={v=>setScope('assetCategories',v)} placeholder="All categories"/></Field>
   <Field label="Asset status scope" wide><TagPicker values={scope.assetStatuses||[]} options={['In use','In store','Maintenance','Retired','Disposed','Lost']} onChange={v=>setScope('assetStatuses',v)} placeholder="All statuses"/></Field>
   <Note>Scopes narrow what a person can see; they never widen a permission set to None.</Note>
  </div>}
  {tab==='preview'&&<div className="access-grid">{groups.flatMap(([,pages])=>pages).filter(p=>pageActions[p]).map(p=>{const on=pageActions[p].map(a=>[a,effective(p,a)]).filter(([,v])=>v!=='none');const noView=effective(p,'view')==='none';return <div key={p} className={cx('access-cell',(noView||!on.length)&&'off')}><b>{pageLabels[p]}</b>{noView?<small>No access{on.length?' (other actions need View first)':''}</small>:<small>{on.map(([a,v])=>`${a}: ${v}`).join(' · ')}</small>}</div>})}</div>}
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
// Security log = sign-ins, passwords, invitations, access and role changes, and platform support sessions.
const SECURITY=/sign|password|invit|activat|access|permission|role|account|support|disabled|reactivated/i;
function Activity({security}:{security?:boolean}){
 const {person}=useApp();const [q,setQ]=useState('');const [debounced,setD]=useState('');useEffect(()=>{const t=setTimeout(()=>setD(q),300);return()=>clearTimeout(t)},[q]);
 const {data,error,reload}=useApi<{events:{id:string,action:string,actor:string,department:string,recordId:string,createdAt:string}[]}>('/api/audit?q='+encodeURIComponent(debounced));
 const events=(data?.events||[]).filter(e=>!security||SECURITY.test(e.action));
 const days=useMemo(()=>{const m=new Map<string,any[]>();for(const e of events){const d=dateOnly(e.createdAt);m.set(d,[...(m.get(d)||[]),e])}return [...m]},[events]);
 return <div className="page"><Header icon={security?'ShieldAlert':'History'} tone="gray" title={security?'Security log':'Activity log'} subtitle={security?'Sign-ins, password and invitation events, access and role changes, and Platform Owner support sessions. Visible to administrators only.':'A server-recorded history of sign-ins, changes, approvals and access decisions.'}/>
  <div className="filter-row"><div className="grid-search big"><Icon name="Search" size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search actions or record IDs"/></div><Btn icon="RefreshCw" variant="ghost" onClick={reload}>Refresh</Btn></div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!events.length?<Empty icon="History" title="No activity found"/>:days.map(([d,events])=><section key={d} className="activity-day"><h3>{d}</h3>{events.map((e:any)=><div key={e.id} className="activity-row"><span className="activity-time">{new Date(e.createdAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span><Who id={e.actor} fallback={person(e.actor)?.name||'System'}/><span className="activity-action">{e.action}</span>{e.department&&<Chip tone="gray">{e.department}</Chip>}</div>)}</section>)}
 </div>;
}
