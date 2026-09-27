'use client';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {api,useApi,go,ago,dateOnly,readXlsx,parseCsv,sheetObjects,cx,downloadCsv} from './lib';
import {ConnectedContext} from './context';
import {CustomFields} from './studio-runtime';
import {useApp,TagPicker,Timeline,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,LocationInput,PersonSelect,Who,Avatar,ErrorNote,Skeleton,Empty,KV,Card,Icon,Note,Segmented,Menu,type Col,LookupSelect,SelectControl} from './kit';
import {baseRoleLabels} from '../access-policy';

type Member={id:string,name:string,email:string,role:string,role_id:string|null,department:string,title:string,phone:string,location:string,additional_locations:string[],manager_id:string|null,employee_code:string,active:number,status:'Active'|'Invited'|'Disabled',last_seen_at:string|null,created_at:string,updated_at:string|null,updated_by:string|null,manageable?:boolean};

export default function People({parts}:{parts:string[]}){
 const view=parts[0]||'directory';
 if(view==='org')return <OrgChart/>;
 if(view==='departments')return <Departments/>;
 if(view==='locations')return <Locations/>;
 if(view==='manage')return <Manage openId={parts[1]}/>;
 return <Directory openId={parts[1]}/>;
}
function usePeople(){return useApi<{manage:boolean,members:Member[]}>('/api/people')}

function Directory({openId}:{openId?:string}){
 const {s}=useApp();const {data,error,reload}=usePeople();const [q,setQ]=useState(''),[dept,setDept]=useState(''),[mode,setMode]=useState('cards');
 const list=useMemo(()=>(data?.members||[]).filter(m=>m.active&&(!dept||m.department===dept)&&`${m.name} ${m.email} ${m.title} ${m.department} ${m.location}`.toLowerCase().includes(q.toLowerCase())),[data,q,dept]);
 const cols:Col<Member>[]=[{key:'name',label:'Name',render:m=><Who id={m.id} sub/>,value:m=>m.name},{key:'title',label:'Job title'},{key:'department',label:'Department'},{key:'email',label:'Email'},{key:'phone',label:'Phone'},{key:'location',label:'Location'}];
 return <div className="page">
  <Header icon="Contact" tone="sky" title="People directory" subtitle={`${list.length} colleagues at ${s.tenant.name}`} actions={<Segmented value={mode} onChange={setMode} items={[{id:'cards',label:'',icon:'LayoutGrid'},{id:'list',label:'',icon:'List'}]}/>}/>
  <ErrorNote error={error} onRetry={reload}/>
  <div className="filter-row"><div className="grid-search big"><Icon name="Search" size={17}/><input placeholder="Search by name, role, department or location" value={q} onChange={e=>setQ(e.target.value)}/></div><DeptSelect value={dept} any="All departments" onChange={setDept}/></div>
  {!data?<Skeleton/>:mode==='list'?<Grid id="directory" rows={list} cols={cols} onOpen={m=>go(`people/directory/${m.id}`)} exportName="directory"/>:
  <div className="people-grid">{list.slice(0,300).map(m=><a key={m.id} href={`#/people/directory/${m.id}`} className="person-card"><Avatar name={m.name} size={48}/><b>{m.name}</b><small>{m.title||'—'}</small><span className="person-dept">{m.department}</span>{m.last_seen_at&&Date.now()-Date.parse(m.last_seen_at)<900000&&<span className="online" title="Active recently"/>}</a>)}{!list.length&&<Empty icon="UserSearch" title="No one matches"/>}</div>}
  {openId&&data&&<Profile m={data.members.find(x=>x.id===openId)} all={data.members} onClose={()=>go('people/directory')}/>}
 </div>;
}
function Profile({m,all,onClose}:{m?:Member,all:Member[],onClose:()=>void}){
 const {s,can}=useApp();if(!m)return null;const reports=all.filter(x=>x.manager_id===m.id&&x.active);const role=s.roles.find(r=>r.id===m.role_id);
 return <Inspector open onClose={onClose} width={480} title={m.name} eyebrow={m.title||m.department} actions={can('settings','manage_members')&&m.manageable&&<Btn size="sm" variant="ghost" icon="UserCog" title="Manage account" onClick={()=>go(`people/manage/${m.id}`)}/>}>
  <div className="profile-hero"><Avatar name={m.name} size={72}/><div><h3>{m.name}</h3><p>{[m.title,m.department].filter(Boolean).join(' · ')}</p>{m.email&&<a href={`mailto:${m.email}`} className="btn btn-sm btn-default"><Icon name="Mail" size={15}/><span>Email</span></a>}</div></div>
  <KV items={[['Email',m.email],['Phone',m.phone],['Department',<a key="d" href={`#/spaces/d/${encodeURIComponent(m.department)}`}>{m.department}</a>],['Location',m.location],['Role',role?.name||baseRoleLabels[m.role]],['Reports to',m.manager_id&&<Who key="m" id={m.manager_id} sub/>],['Employee code',m.employee_code],['Last active',m.last_seen_at?ago(m.last_seen_at):'Not yet signed in']]}/>
  {reports.length>0&&<><h4 className="section-title">Direct reports · {reports.length}</h4><div className="mini-list">{reports.map(r=><a key={r.id} href={`#/people/directory/${r.id}`}><Avatar name={r.name} size={22}/><span>{r.name}<small>{r.title||r.department}</small></span></a>)}</div></>}
  <CustomFields type="person" id={m.id}/><ConnectedContext type="person" id={m.id} compact title="Work connected to this person"/>
 </Inspector>;
}

function OrgChart(){
 const {data,error,reload}=usePeople();const [focus,setFocus]=useState<string|null>(null);
 const active=(data?.members||[]).filter(m=>m.active);const ids=new Set(active.map(m=>m.id));
 const kids=(id:string|null)=>active.filter(m=>(id===null?!m.manager_id||!ids.has(m.manager_id):m.manager_id===id)).sort((a,b)=>a.name.localeCompare(b.name));
 const roots=focus?active.filter(m=>m.id===focus):kids(null).filter(m=>active.some(x=>x.manager_id===m.id));
 const loners=focus?[]:kids(null).filter(m=>!active.some(x=>x.manager_id===m.id));
 const node=(m:Member,depth:number):ReactNode=>{const c=kids(m.id);return <li key={m.id}><div className="org-node"><button onClick={()=>setFocus(m.id)} title="Focus on this team"><Avatar name={m.name} size={34}/><span><b>{m.name}</b><small>{m.title||m.department}</small></span>{c.length>0&&<em>{c.length}</em>}</button></div>{c.length>0&&depth<6&&<ul>{c.map(x=>node(x,depth+1))}</ul>}</li>};
 return <div className="page"><Header icon="Network" tone="sky" title="Org chart" subtitle="Built from each person's reporting manager. Click someone to focus on their team." actions={focus&&<Btn icon="Maximize2" onClick={()=>setFocus(null)}>Whole company</Btn>}/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!roots.length?<Empty icon="Network" title="No reporting lines yet">Set each person's reporting manager in Manage users, or import them from a spreadsheet.</Empty>:<div className="org"><ul className="org-root">{roots.map(r=>node(r,0))}</ul></div>}
  {loners.length>0&&<Card title={`No reporting line · ${loners.length}`}><div className="chips-wrap">{loners.map(m=><a key={m.id} href={`#/people/directory/${m.id}`} className="person-pill"><Avatar name={m.name} size={20}/>{m.name}</a>)}</div></Card>}
 </div>;
}

type Dept={id:string,name:string,code:string,headId:string|null,description:string,color:string,parentId:string|null,costCentre:string,status:string,createdAt:string,createdBy:string|null,updatedAt:string|null,updatedBy:string|null,members:number};
function Departments(){
 const {s,toast,refresh,ask}=useApp();const {data,error,reload}=useApi<{departments:Dept[],canManage:boolean}>('/api/org');const [edit,setEdit]=useState<Partial<Dept>|null>(null),[importing,setImporting]=useState(false),[history,setHistory]=useState<Dept|null>(null),[mode,setMode]=useState('table');
 const rows=data?.departments||[];const name=(id?:string|null)=>rows.find(d=>d.id===id)?.name||'';
 const save=async(d:Partial<Dept>)=>{try{await api('/api/org',{action:'department',id:d.id,name:d.name,code:d.code,headId:d.headId,parentId:d.parentId,description:d.description,color:d.color,costCentre:d.costCentre,status:d.status});setEdit(null);toast('Department saved');reload();refresh()}catch(e){toast((e as Error).message,'error')}};
 const cols:Col<Dept>[]=[
  {key:'name',label:'Department',render:d=><span className="who"><span className="space-dot" style={{background:d.color||`hsl(${[...d.name].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,0)} 65% 58%)`}}/><span>{d.name}{d.parentId&&<small>in {name(d.parentId)}</small>}</span></span>,value:d=>d.name},
  {key:'code',label:'Code',width:100,render:d=><span className="mono">{d.code||'—'}</span>},
  {key:'head',label:'Head / contact',width:190,render:d=><Who id={d.headId} fallback="—"/>,value:d=>s.people.find(p=>p.id===d.headId)?.name||''},
  {key:'costCentre',label:'Cost centre',width:120},
  {key:'status',label:'Status',width:100,render:d=><Chip>{d.status}</Chip>},
  {key:'members',label:'People',width:80,align:'right'},
  {key:'description',label:'Description',hide:true},
  {key:'createdAt',label:'Created',width:120,hide:true,render:d=>dateOnly(d.createdAt)},
  {key:'updatedAt',label:'Modified',width:170,render:d=><span className="muted small">{d.updatedAt?`${dateOnly(d.updatedAt)} · ${s.people.find(p=>p.id===d.updatedBy)?.name||'—'}`:'—'}</span>,value:d=>d.updatedAt||''},
 ];
 return <div className="page"><Header icon="Building2" tone="sky" title="Departments" subtitle="Codes and cost centres drive reporting; department heads approve requisitions and publish in their space." actions={<><Segmented value={mode} onChange={setMode} items={[{id:'table',label:'',icon:'List'},{id:'cards',label:'',icon:'LayoutGrid'}]}/>{data?.canManage&&<><Btn icon="FileSpreadsheet" onClick={()=>setImporting(true)}>Import</Btn><Btn variant="primary" icon="Plus" onClick={()=>setEdit({name:'',code:'',headId:null,parentId:null,description:'',color:'',costCentre:'',status:'Active'})}>Add department</Btn></>}</>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:mode==='table'?<Grid id="departments" rows={rows} cols={cols} exportName="departments" onOpen={d=>data.canManage?setEdit(d):go(`spaces/d/${encodeURIComponent(d.name)}`)}/>:
  <div className="dept-grid">{rows.map(d=><div key={d.id} className={cx('dept-card',d.status!=='Active'&&'is-off')} style={{'--dc':d.color||`hsl(${[...d.name].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,0)} 65% 58%)`} as React.CSSProperties}><div className="dept-band"/><div className="dept-body"><div className="dept-head"><h3>{d.name} {d.code&&<span className="mono muted small">{d.code}</span>}</h3>{data.canManage&&<Btn size="sm" variant="ghost" icon="Pencil" title="Edit" onClick={()=>setEdit(d)}/>}</div><p>{d.description||<span className="muted">No description.</span>}</p><div className="dept-foot"><span>{d.headId?<Who id={d.headId} sub/>:<span className="muted small">No head assigned</span>}</span><span className="muted small">{d.members} people</span></div><div className="row-gap"><Btn size="sm" variant="ghost" icon="LibraryBig" onClick={()=>go(`spaces/d/${encodeURIComponent(d.name)}`)}>Space</Btn>{d.status!=='Active'&&<Chip>{d.status}</Chip>}</div></div></div>)}</div>}
  {edit&&<Modal open onClose={()=>setEdit(null)} title={edit.id?`Edit ${edit.name}`:'New department'} footer={<>{edit.id&&<><Btn variant="ghost" icon="History" onClick={()=>setHistory(edit as Dept)}>History</Btn><Btn variant="danger" onClick={async()=>{if(await ask({title:`Delete ${edit.name}?`,body:'Only empty departments can be deleted. Disable it instead to keep its history.',confirm:'Delete',danger:true})===false)return;try{await api('/api/org',{action:'delete-department',id:edit.id});setEdit(null);reload();refresh()}catch(e){toast((e as Error).message,'error')}}}>Delete</Btn></>}<div className="grow"/><Btn variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn><Btn variant="primary" disabled={!edit.name} onClick={()=>save(edit)}>Save</Btn></>}>
   <div className="form-grid"><Field label="Name"><input autoFocus value={edit.name||''} onChange={e=>setEdit({...edit,name:e.target.value})}/></Field><Field label="Code" hint="Unique in this workspace."><input value={edit.code||''} onChange={e=>setEdit({...edit,code:e.target.value.toUpperCase()})} placeholder="FIN"/></Field><Field label="Parent department"><select value={edit.parentId||''} onChange={e=>setEdit({...edit,parentId:e.target.value||null})}><option value="">None (top level)</option>{rows.filter(d=>d.id!==edit.id).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Cost centre"><input value={edit.costCentre||''} onChange={e=>setEdit({...edit,costCentre:e.target.value})}/></Field><Field label="Department head / contact" wide hint="Approves requisitions at the 'department head' step."><PersonSelect value={edit.headId} onChange={v=>setEdit({...edit,headId:v})}/></Field><Field label="Status"><select value={edit.status||'Active'} onChange={e=>setEdit({...edit,status:e.target.value})}><option>Active</option><option>Inactive</option></select></Field><Field label="Colour"><input type="color" value={edit.color||'#6d5ef8'} onChange={e=>setEdit({...edit,color:e.target.value})}/></Field><Field label="Description" wide><textarea rows={3} value={edit.description||''} onChange={e=>setEdit({...edit,description:e.target.value})}/></Field></div>
   {edit.id&&<p className="muted small">Created {dateOnly(edit.createdAt)} by {s.people.find(p=>p.id===edit.createdBy)?.name||'—'}{edit.updatedAt?` · modified ${dateOnly(edit.updatedAt)} by ${s.people.find(p=>p.id===edit.updatedBy)?.name||'—'}`:''}</p>}
  </Modal>}
  {history&&<DeptHistory d={history} onClose={()=>setHistory(null)}/>}
  {importing&&<ImportGeneric title="Import departments" hint="Columns: Name, Code, Cost centre, Description, Status (Active/Inactive), Parent" action="import-departments" url="/api/org" map={r=>({name:pickCol(r,'name','department','departmentname'),code:pickCol(r,'code','departmentcode'),costCentre:pickCol(r,'costcentre','costcenter'),description:pickCol(r,'description'),status:pickCol(r,'status'),parent:pickCol(r,'parent','parentdepartment')})} onClose={()=>setImporting(false)} onDone={()=>{reload();refresh()}}/>}
 </div>;
}
function DeptHistory({d,onClose}:{d:Dept,onClose:()=>void}){const {data}=useApi<{history:{id:string,action:string,actor:string,createdAt:string}[]}>('/api/org?history='+d.id);return <Inspector open onClose={onClose} title={`${d.name} history`} width={440}>{!data?<Skeleton/>:<Timeline events={data.history}/>}</Inspector>}

// Spreadsheet import with a server-side validation preview and an error report before anything is written.
export function ImportGeneric({title,hint,action,url,map,onClose,onDone,extra}:{title:string,hint:string,action:string,url:string,map:(r:Record<string,string>)=>Record<string,unknown>,onClose:()=>void,onDone:()=>void,extra?:Record<string,unknown>}){
 const {toast}=useApp();const [rows,setRows]=useState<Record<string,unknown>[]>([]),[file,setFile]=useState(''),[preview,setPreview]=useState<any>(null),[result,setResult]=useState<any>(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function load(f:File){setErr('');setPreview(null);setResult(null);try{const grid=f.name.toLowerCase().endsWith('.csv')?parseCsv(await f.text()):await readXlsx(f);const objs=sheetObjects(grid,/name|code|sku|email/i).map(map).filter(r=>Object.values(r).some(v=>String(v??'').trim()));setRows(objs);setFile(f.name);setBusy(true);setPreview(await api(url,{action,rows:objs,preview:true,...extra}))}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 async function run(){setBusy(true);try{const r=await api(url,{action,rows,...extra});setResult(r);onDone();toast(`${r.created} created · ${r.updated} updated`)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 const errors=(result||preview)?.errors||[];
 return <Modal open wide onClose={onClose} title={title} subtitle="Upload .xlsx or .csv. Nothing is saved until you confirm the preview." footer={result?<Btn variant="primary" onClick={onClose}>Done</Btn>:<><Btn variant="ghost" onClick={onClose}>Cancel</Btn>{errors.length>0&&<Btn icon="Download" onClick={()=>downloadCsv('import-errors',[['Row','Problem'],...errors.map((e:{row:number,reason:string})=>[e.row,e.reason])])}>Error report</Btn>}<Btn variant="primary" icon="Upload" busy={busy} disabled={!preview||!(preview.create+preview.update)} onClick={run}>Import {preview?preview.create+preview.update:''} rows</Btn></>}>
  <label className={cx('dropzone',file&&'has-file')}><input type="file" accept=".xlsx,.csv" onChange={e=>e.target.files?.[0]&&load(e.target.files[0])}/><Icon name="FileSpreadsheet" size={28}/><b>{file||'Choose a spreadsheet'}</b><small>{hint}</small></label>
  <ErrorNote error={err}/>
  {(preview||result)&&<div className="stats compact"><div className="stat"><span>{result?'Created':'Will create'}</span><strong>{(result||preview).create??result?.created}</strong></div><div className="stat"><span>{result?'Updated':'Will update'}</span><strong>{(result||preview).update??result?.updated}</strong></div><div className="stat"><span>Rows with problems</span><strong>{errors.length}</strong></div></div>}
  {errors.length>0&&<div className="preview-table"><table><thead><tr><th>Row</th><th>Problem</th></tr></thead><tbody>{errors.slice(0,50).map((e:{row:number,reason:string})=><tr key={e.row}><td>{e.row}</td><td>{e.reason}</td></tr>)}</tbody></table></div>}
 </Modal>;
}

function Locations(){
 const {toast,can,refresh}=useApp();const {data,error,reload}=useApi<{locations:{id:string,name:string,path:string,parentId:string|null,kind:string,assets:number}[]}>('/api/org');const [add,setAdd]=useState<{parentId:string|null,name:string,kind:string}|null>(null);
 const locs=data?.locations||[];
 const tree=(parent:string|null,depth:number):ReactNode=>locs.filter(l=>l.parentId===parent).map(l=><div key={l.id}><div className="loc-row" style={{paddingLeft:14+depth*22}}><Icon name={depth?'CornerDownRight':'MapPin'} size={15}/><b>{l.name}</b><Chip tone="gray">{l.kind}</Chip><span className="muted small">{l.assets} assets</span><div className="grow"/>{can('locations','create')&&<Btn size="sm" variant="ghost" icon="Plus" title="Add inside" onClick={()=>setAdd({parentId:l.id,name:'',kind:'Unit'})}/>}{can('locations','update')&&<Btn size="sm" variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{try{await api('/api/org',{action:'delete-location',id:l.id});reload();refresh()}catch(e){toast((e as Error).message,'error')}}}/>}</div>{tree(l.id,depth+1)}</div>);
 return <div className="page"><Header icon="MapPin" tone="sky" title="Locations" subtitle="Sites, units, stores and areas. Used for assets, tickets and deliveries." actions={can('locations','create')&&<Btn variant="primary" icon="Plus" onClick={()=>setAdd({parentId:null,name:'',kind:'Site'})}>Add site</Btn>}/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!locs.length?<Empty icon="MapPin" title="No locations yet">Add your sites, or promote the imported asset register to build them automatically.</Empty>:<Card pad={false}><div className="loc-tree">{tree(null,0)}</div></Card>}
  {add&&<Modal open onClose={()=>setAdd(null)} title={add.parentId?`Add inside ${locs.find(l=>l.id===add.parentId)?.path}`:'Add a site'} footer={<><Btn variant="ghost" onClick={()=>setAdd(null)}>Cancel</Btn><Btn variant="primary" onClick={async()=>{try{await api('/api/org',{action:'location',...add});setAdd(null);reload();refresh()}catch(e){toast((e as Error).message,'error')}}}>Add</Btn></>}><div className="form-grid"><Field label="Name"><input autoFocus value={add.name} onChange={e=>setAdd({...add,name:e.target.value})}/></Field><Field label="Type"><select value={add.kind} onChange={e=>setAdd({...add,kind:e.target.value})}>{['Site','Building','Unit','Store','Area','Office'].map(k=><option key={k}>{k}</option>)}</select></Field></div></Modal>}
 </div>;
}

// ── Manage users: memberships of this workspace, invited by one-time link ───
type LinkResult={id:string,name:string,email:string,purpose:string,emailed:boolean,link?:string,error?:string};
function Manage({openId}:{openId?:string}){
 const {s,person,toast,refresh}=useApp();const {data,error,reload}=usePeople();const [sel,setSel]=useState<Set<string>>(new Set());const [status,setStatus]=useState('Active');const [importing,setImporting]=useState(false),[links,setLinks]=useState<LinkResult[]|null>(null),[activity,setActivity]=useState<Member|null>(null);
 const rows=useMemo(()=>(data?.members||[]).filter(m=>status==='all'||m.status===status),[data,status]);
 const counts=useMemo(()=>{const c:Record<string,number>={Active:0,Invited:0,Disabled:0};for(const m of data?.members||[])c[m.status]=(c[m.status]||0)+1;return c},[data]);
 const roleName=(m:Member)=>s.roles.find(r=>r.id===m.role_id)?.name||baseRoleLabels[m.role];
 const cols:Col<Member>[]=[
  {key:'name',label:'Full name',render:m=><span className="who"><Avatar name={m.name} size={24}/><span>{m.name}<small>{m.title}</small></span></span>,value:m=>m.name},
  {key:'email',label:'Email'},
  {key:'phone',label:'Phone',width:130},
  {key:'role',label:'Role',width:170,render:m=><span>{roleName(m)}{m.role==='admin'&&m.role_id&&<Chip tone="violet">Admin</Chip>}</span>,value:m=>roleName(m)},
  {key:'manager',label:'Reporting manager',width:170,render:m=><Who id={m.manager_id} fallback="—"/>,value:m=>person(m.manager_id)?.name||''},
  {key:'department',label:'Department',width:140},
  {key:'location',label:'Primary location',width:170},
  {key:'additional',label:'Additional locations',hide:true,value:m=>(m.additional_locations||[]).join('; ')},
  {key:'status',label:'Status',width:110,render:m=><Chip tone={m.status==='Active'?'green':m.status==='Invited'?'amber':'gray'}>{m.status}</Chip>},
  {key:'last_seen_at',label:'Last active',width:120,render:m=><span className="muted small">{m.status==='Invited'?'Not activated':ago(m.last_seen_at)}</span>,value:m=>m.last_seen_at||''},
  {key:'created_at',label:'Created',hide:true,render:m=>dateOnly(m.created_at),value:m=>m.created_at},
  {key:'updated_at',label:'Modified',hide:true,render:m=>m.updated_at?`${dateOnly(m.updated_at)} · ${person(m.updated_by)?.name||'—'}`:'—',value:m=>m.updated_at||''},
  {key:'title',label:'Job title',hide:true},{key:'employee_code',label:'Employee code',hide:true},
 ];
 const chosen=rows.filter(m=>sel.has(m.id)&&m.manageable);
 async function bulk(activeFlag:boolean){try{const r=await api<{updated:number}>('/api/people',{action:'bulk-active',ids:chosen.map(m=>m.id),active:activeFlag});toast(`${r.updated} account${r.updated===1?'':'s'} ${activeFlag?'reactivated':'disabled'}`);setSel(new Set());reload();refresh()}catch(e){toast((e as Error).message,'error')}}
 async function sendLinks(ids:string[]){try{const r=await api<{results:LinkResult[]}>('/api/people',{action:'send-links',ids});setLinks(r.results);reload()}catch(e){toast((e as Error).message,'error')}}
 const editing=openId==='new'?'new':openId?data?.members.find(m=>m.id===openId):undefined;
 return <div className="page">
  <Header icon="UserCog" tone="sky" title="Manage users" subtitle="Memberships of this workspace. People are invited with a one-time link and choose their own password; administrators never see or set passwords." actions={<>{s.user.role==='admin'&&<Btn icon="FileSpreadsheet" onClick={()=>setImporting(true)}>Import</Btn>}<Btn variant="primary" icon="UserPlus" onClick={()=>go('people/manage/new')}>Invite person</Btn></>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="manage-users" rows={rows} cols={cols} selectable selected={sel} onSelect={setSel} onOpen={m=>m.manageable&&go(`people/manage/${m.id}`)} activeId={openId} exportName="users"
   toolbar={<><Segmented value={status} onChange={v=>{setStatus(v);setSel(new Set())}} items={[{id:'Active',label:`Active ${counts.Active||0}`},{id:'Invited',label:`Invited ${counts.Invited||0}`},{id:'Disabled',label:`Disabled ${counts.Disabled||0}`},{id:'all',label:'All'}]}/>{chosen.length>0&&<div className="bulk">{status!=='Disabled'&&<Btn size="sm" icon="Ban" onClick={()=>bulk(false)}>Disable</Btn>}{status!=='Active'&&status!=='Invited'&&<Btn size="sm" icon="CircleCheck" onClick={()=>bulk(true)}>Reactivate</Btn>}{status!=='Disabled'&&<Btn size="sm" icon="Send" onClick={()=>sendLinks(chosen.map(m=>m.id))}>{status==='Invited'?'Resend invitations':'Send reset links'}</Btn>}</div>}</>}/>}
  {editing&&<PersonEditor m={editing==='new'?undefined:editing} onClose={()=>go('people/manage')} onSaved={r=>{reload();refresh();if(r?.link||r?.emailed)setLinks([{id:'new',name:r.name,email:r.email,purpose:'invite',emailed:!!r.emailed,link:r.link}]);go('people/manage')}} onLink={id=>sendLinks([id])} onActivity={m=>setActivity(m)}/>}
  {importing&&<ImportPeople onClose={()=>setImporting(false)} onDone={()=>{reload();refresh()}}/>}
  {links&&<LinksDialog results={links} onClose={()=>setLinks(null)}/>}
  {activity&&<ActivityReport m={activity} onClose={()=>setActivity(null)}/>}
 </div>;
}
function LinksDialog({results,onClose}:{results:LinkResult[],onClose:()=>void}){
 const {toast}=useApp();const shown=results.filter(r=>r.link);
 return <Modal open wide onClose={onClose} title="Invitation & reset links" footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
  {results.some(r=>r.emailed)&&<Note tone="ok">Emailed: {results.filter(r=>r.emailed).map(r=>r.name).join(', ')}.</Note>}
  {shown.length>0&&<><Note tone="warn">Email delivery is not configured, so these one-time links are shown <b>once</b>. Send each one privately to its owner. Invitations expire in 7 days, reset links in 2 hours.</Note>{shown.map(r=><div key={r.id} className="copy-link"><div><b>{r.name}</b><small className="muted"> {r.email} · {r.purpose==='invite'?'Invitation':'Password reset'}</small><code>{r.link}</code></div><Btn size="sm" icon="Copy" onClick={()=>{navigator.clipboard.writeText(r.link||'');toast('Link copied')}}>Copy</Btn></div>)}</>}
  {results.filter(r=>r.error).map(r=><ErrorNote key={r.id} error={`${r.name}: ${r.error}`}/>)}
 </Modal>;
}
function ActivityReport({m,onClose}:{m:Member,onClose:()=>void}){const {data,error}=useApi<{activity:{id:string,action:string,recordId:string,createdAt:string}[]}>('/api/people?activity='+m.id);return <Inspector open onClose={onClose} title={`${m.name} · activity`} eyebrow="User activity report" width={520} actions={data&&<Btn size="sm" variant="ghost" icon="Download" title="Export CSV" onClick={()=>downloadCsv(`activity-${m.name}`,[['When','Action','Record'],...data.activity.map(a=>[a.createdAt,a.action,a.recordId])])}/>}><ErrorNote error={error}/>{!data?<Skeleton/>:!data.activity.length?<Empty icon="History" title="No recorded activity"/>:<Timeline events={data.activity.map(a=>({id:a.id,action:a.action,actor:m.id,createdAt:a.createdAt}))}/>}</Inspector>}
function PersonEditor({m,onClose,onSaved,onLink,onActivity}:{m?:Member,onClose:()=>void,onSaved:(r?:any)=>void,onLink:(id:string)=>void,onActivity:(m:Member)=>void}){
 const {s,toast}=useApp();const admin=s.user.role==='admin';const [busy,setBusy]=useState(false);
 const [v,setV]=useState({name:m?.name||'',email:m?.email||'',title:m?.title||'',phone:m?.phone||'',department:m?.department||(admin?'':s.user.department),location:m?.location||'',additionalLocations:m?.additional_locations||[] as string[],managerId:m?.manager_id||null as string|null,employeeCode:m?.employee_code||'',role:m?.role||'employee',roleId:m?.role_id||'',active:m?!!m.active:true});
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 const customRoles=s.roles.filter(r=>admin||['employee','viewer'].includes(r.base));
 return <Inspector open onClose={onClose} width={680} eyebrow={m?`${m.status} member`:'Invite a person'} title={m?.name||'Invite a person'} actions={m&&<Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:m.status==='Invited'?'Resend invitation':'Send password-reset link',icon:m.status==='Invited'?'Send':'KeyRound',onClick:()=>onLink(m.id),hidden:!m.active},{label:'Activity report',icon:'History',onClick:()=>onActivity(m)},{label:'View profile',icon:'IdCard',onClick:()=>go(`people/directory/${m.id}`)}]}/>}> 
  <form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const body={...v,roleId:v.roleId||null};const r=await api<any>('/api/people',m?{action:'update',id:m.id,...body}:{action:'create',...body});toast(m?'Member updated':r.note||(r.emailed?`Invitation emailed to ${v.email}`:'Invitation created'));onSaved(m?undefined:{...r,name:v.name,email:v.email})}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
   <Field label="Full name" wide><input required value={v.name} onChange={f('name')}/></Field>
   <Field label="Email" wide hint={m?'Email identifies the account and cannot be changed here.':s.tenant.domains?`Company domains: ${s.tenant.domains}`:undefined}><input required type="email" disabled={!!m} value={v.email} onChange={f('email')}/></Field>
   <div className="form-section-title"><span>Work details</span><small>Role, contact details and organisational placement.</small></div>
   <Field label="Job title"><LookupSelect list="job-titles" label="Job titles" value={v.title} onChange={x=>setV({...v,title:x})}/></Field>
   <Field label="Phone"><input value={v.phone} onChange={f('phone')}/></Field>
   <Field label="Department"><DeptSelect value={v.department} required onChange={x=>setV({...v,department:x})}/></Field>
   <Field label="Employee code"><input value={v.employeeCode} onChange={f('employeeCode')}/></Field>
   <Field label="Primary location" wide><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field>
   <Field label="Additional locations" wide><TagPicker values={v.additionalLocations} options={s.locations.map(l=>l.path)} onChange={x=>setV({...v,additionalLocations:x})} placeholder="None"/></Field>
   <div className="form-section-title"><span>Access & reporting</span><small>Set the reporting line and the minimum access this person needs.</small></div>
   <Field label="Reporting manager" wide hint="First approver for requisitions and the org chart."><PersonSelect value={v.managerId} onChange={x=>setV({...v,managerId:x})} filter={p=>p.id!==m?.id}/></Field>
   <Field label="Workspace role" hint="Optional custom permissions for this workspace only."><SelectControl value={v.roleId} label="Workspace role" options={[{value:'',label:'No custom role',description:'Use the access level beside this field.',icon:'User'},...customRoles.map(r=>({value:r.id,label:r.name,description:`Based on ${r.base==='admin'?'Company Admin':baseRoleLabels[r.base]||r.base}`,icon:'ShieldCheck'}))]} onChange={roleId=>{const r=s.roles.find(x=>x.id===roleId);setV({...v,roleId,role:r?.base||v.role})}}/></Field>
   <Field label="Access level" hint={v.roleId?'Controlled by the selected workspace role.':'The base permission level for this person.'}><SelectControl value={v.role} label="Access level" disabled={!!v.roleId} options={(admin?['admin','manager','employee','viewer']:['employee','viewer']).map(r=>({value:r,label:r==='admin'?'Company Admin':baseRoleLabels[r],description:r==='admin'?'Full workspace administration':r==='manager'?'Team oversight and approvals':r==='viewer'?'Read-only access':'Standard day-to-day access',icon:r==='admin'?'ShieldCheck':r==='manager'?'UsersRound':r==='viewer'?'Eye':'User'}))} onChange={role=>setV({...v,role})}/></Field>
   {m&&<Field label="Membership"><SelectControl value={v.active?'1':'0'} label="Membership status" options={[{value:'1',label:'Active',description:'Can sign in and use assigned pages.',icon:'CircleCheck'},{value:'0',label:'Disabled',description:'Cannot sign in until reactivated.',icon:'Ban'}]} onChange={active=>setV({...v,active:active==='1'})}/></Field>}
   {!m&&<Note>An invitation link is created for this person. They choose their own password; nobody else ever sees it.</Note>}
   {m&&<p className="muted small field-wide">Created {dateOnly(m.created_at)}{m.updated_at?` · modified ${dateOnly(m.updated_at)}`:''}</p>}
   <div className="form-actions"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" variant="primary" busy={busy}>{m?'Save changes':'Send invitation'}</Btn></div>
  </form>
 </Inspector>;
}

// Accepts the AssetInfinity "List of users" export (or any sheet with similar headers).
const pickCol=(r:Record<string,string>,...names:string[])=>{for(const n of names){const k=Object.keys(r).find(x=>x.toLowerCase().replace(/[^a-z]/g,'')===n);if(k&&r[k])return r[k]}return ''};
function ImportPeople({onClose,onDone}:{onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [rows,setRows]=useState<Record<string,string>[]>([]),[file,setFile]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<any>(null),[result,setResult]=useState<any>(null),[err,setErr]=useState('');
 const mapped=rows.map(r=>({name:pickCol(r,'fullname','name','employeename'),email:pickCol(r,'emailaddress','email'),role:pickCol(r,'role'),department:pickCol(r,'department','staffdepartment'),phone:pickCol(r,'contactnumber','phone','mobile'),manager:pickCol(r,'reportingmanager','manager'),location:pickCol(r,'location'),title:pickCol(r,'jobtitle','title','designation'),employeeCode:pickCol(r,'employeecode','staffid','employeeid')})).filter(r=>r.name||r.email);
 async function load(f:File){setErr('');setPreview(null);setResult(null);try{const grid=f.name.toLowerCase().endsWith('.csv')?parseCsv(await f.text()):await readXlsx(f);const objs=sheetObjects(grid);setRows(objs);setFile(f.name)}catch(e){setErr((e as Error).message)}}
 useEffect(()=>{if(!mapped.length)return;setBusy(true);api('/api/people',{action:'import',rows:mapped,preview:true}).then(setPreview).catch(e=>setErr((e as Error).message)).finally(()=>setBusy(false))},[rows]);// eslint-disable-line react-hooks/exhaustive-deps
 const skipped=(result||preview)?.skipped||[];
 return <Modal open wide onClose={onClose} title="Import people" subtitle="Upload an .xlsx or .csv export, such as AssetInfinity's “List of users”. Existing members are matched by email and updated; new people are invited." footer={result?<Btn variant="primary" onClick={onClose}>Done</Btn>:<><Btn variant="ghost" onClick={onClose}>Cancel</Btn>{skipped.length>0&&<Btn icon="Download" onClick={()=>downloadCsv('import-errors',[['Row','Problem'],...skipped.map((x:any)=>[x.row,x.reason])])}>Error report</Btn>}<Btn variant="primary" icon="Upload" busy={busy} disabled={!preview||!(preview.create+preview.update)} onClick={async()=>{setBusy(true);try{const r=await api('/api/people',{action:'import',rows:mapped});setResult(r);onDone();toast(`${r.created} invited · ${r.updated} updated`)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}}>Import {preview?preview.create+preview.update:''} people</Btn></>}>
  {result?<div className="import-result"><div className="stats compact"><div className="stat"><span>Invited</span><strong>{result.created}</strong></div><div className="stat"><span>Updated</span><strong>{result.updated}</strong></div><div className="stat"><span>Skipped</span><strong>{result.skipped.length}</strong></div></div>{result.invitesEmailed<result.created&&<Note tone="warn">{result.created-result.invitesEmailed} invitation(s) were not emailed. Filter the list to Invited, select them and choose “Resend invitations” to get their links.</Note>}{result.rolesCreated.length>0&&<Note tone="warn">New roles were created: <b>{result.rolesCreated.join(', ')}</b>. Review their permissions in Admin → Roles & permissions.</Note>}</div>:<>
   <label className={cx('dropzone',file&&'has-file')}><input type="file" accept=".xlsx,.csv" onChange={e=>e.target.files?.[0]&&load(e.target.files[0])}/><Icon name="FileSpreadsheet" size={28}/><b>{file||'Choose a spreadsheet'}</b><small>{file?`${mapped.length} people found`:'Columns: Full Name, Email Address, Role, Contact Number, Reporting Manager, Department, Location'}</small></label>
   <ErrorNote error={err}/>
   {preview&&<div className="stats compact"><div className="stat"><span>Will invite</span><strong>{preview.create}</strong></div><div className="stat"><span>Will update</span><strong>{preview.update}</strong></div><div className="stat"><span>Will skip</span><strong>{skipped.length}</strong></div></div>}
   {preview?.rolesToCreate?.length>0&&<Note>Roles that don't exist yet will be created for you to configure: {preview.rolesToCreate.join(', ')}.</Note>}
   {skipped.length>0&&<div className="preview-table"><table><thead><tr><th>Row</th><th>Why it will be skipped</th></tr></thead><tbody>{skipped.slice(0,30).map((x:any)=><tr key={x.row}><td>{x.row}</td><td>{x.reason}</td></tr>)}</tbody></table></div>}
   <Note>No passwords are imported or set. New people receive an invitation. Imports never grant full Admin.</Note></>}
 </Modal>;
}
