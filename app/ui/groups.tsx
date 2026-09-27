'use client';
import {useState} from 'react';
import {api,useApi,go,ago,cx,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Field,Who,ErrorNote,Skeleton,Empty,Icon,Modal,Note,PersonSelect,TagPicker,Card,Tabs,resetGroupCache} from './kit';

// Company settings › Groups: reusable audiences (static members and owners, or dynamic rules) that can be
// chosen wherever content is shared. Deleting a group still in use is refused; it can be replaced first.
type Rules={departments?:string[],locations?:string[],roles?:string[],titles?:string[]};
type Group={id:string,code:string,name:string,description:string,type:string,status:string,visibility:string,membership_mode:string,rules:Rules,members:number,updated_at:string};
type Detail={group:Group,members:{id:string,name:string,email:string,department:string,role:string,dynamic?:boolean}[],references:Record<string,number>|null,activity:{action:string,createdAt:string,who:string}[],canManage:boolean};

export default function Groups({openId}:{openId?:string}){
 const {data,error,reload}=useApi<{groups:Group[],canManage:boolean}>('/api/groups');const [edit,setEdit]=useState<Partial<Group>|null>(null);const [q,setQ]=useState('');const [show,setShow]=useState('active');
 const rows=(data?.groups||[]).filter(g=>(show==='all'||g.status===show)&&(!q||`${g.name} ${g.code} ${g.type}`.toLowerCase().includes(q.toLowerCase())));
 const done=()=>{resetGroupCache();reload()};
 return <div className="page">
  <Header icon="UsersRound" tone="gray" title="Groups" subtitle="Reusable audiences for files, announcements, pages, tasks, projects and messaging." actions={data?.canManage&&<><Btn icon="Download" onClick={()=>downloadCsv('groups.csv',[['Code','Name','Type','Status','Membership','Visibility','Static members'],...(data?.groups||[]).map(g=>[g.code,g.name,g.type,g.status,g.membership_mode,g.visibility,g.members])])}>Export</Btn><Btn variant="primary" icon="Plus" onClick={()=>setEdit({membership_mode:'static',visibility:'company',type:'team',rules:{}})}>New group</Btn></>}/>
  <div className="toolbar"><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search groups…" aria-label="Search groups"/><select value={show} onChange={e=>setShow(e.target.value)} aria-label="Status"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!rows.length?<Empty icon="UsersRound" title="No groups" action={data.canManage&&<Btn variant="primary" icon="Plus" onClick={()=>setEdit({membership_mode:'static',visibility:'company',type:'team',rules:{}})}>Create a group</Btn>}>For example a safety committee, a project steering group, or everyone at the Tema plant.</Empty>:
   <table className="grid-table"><thead><tr><th>Group</th><th>Type</th><th>Membership</th><th>Visibility</th><th>Status</th><th>Updated</th></tr></thead><tbody>{rows.map(g=><tr key={g.id} onClick={()=>go(`admin/groups/${g.id}`)}><td><b>{g.name}</b> <small className="muted">{g.code}</small>{g.description&&<><br/><small className="muted">{g.description}</small></>}</td><td>{g.type}</td><td>{g.membership_mode==='dynamic'?<Chip tone="blue">Rules</Chip>:`${g.members} people`}</td><td>{g.visibility==='company'?'Everyone can choose it':'Members only'}</td><td><Chip tone={g.status==='active'?'green':'gray'}>{g.status}</Chip></td><td>{ago(g.updated_at)}</td></tr>)}</tbody></table>}
  {openId&&<GroupPanel id={openId} groups={data?.groups||[]} onEdit={g=>setEdit(g)} onChange={done}/>}
  {edit&&<GroupForm g={edit} onClose={()=>setEdit(null)} onDone={id=>{setEdit(null);done();go(`admin/groups/${id}`)}}/>}
 </div>;
}
function GroupPanel({id,groups,onEdit,onChange}:{id:string,groups:Group[],onEdit:(g:Group)=>void,onChange:()=>void}){
 const {toast,ask}=useApp();const {data,error,reload}=useApi<Detail>(`/api/groups?id=${encodeURIComponent(id)}`);const [tab,setTab]=useState('members');const [add,setAdd]=useState<string|null>(null);
 const act=async(body:Record<string,unknown>,msg:string)=>{try{await api('/api/groups',{id,...body});toast(msg);reload();onChange()}catch(e){toast((e as Error).message,'error')}};
 if(error)return <Modal open onClose={()=>go('admin/groups')} title="Group"><ErrorNote error={error}/></Modal>;
 if(!data)return null;
 const g=data.group;const used=Object.entries(data.references||{}).filter(([,n])=>n>0);
 return <Modal open wide onClose={()=>go('admin/groups')} title={<>{g.name} <small className="muted">{g.code}</small></>} subtitle={g.description} footer={data.canManage&&<><Btn icon="Pencil" onClick={()=>onEdit(g)}>Edit</Btn><Btn icon="Archive" onClick={()=>act({action:g.status==='active'?'archive':'restore'},g.status==='active'?'Archived':'Restored')}>{g.status==='active'?'Archive':'Restore'}</Btn><div className="grow"/>
   {used.length>0&&<Btn icon="Replace" onClick={async()=>{const others=groups.filter(x=>x.id!==g.id&&x.status==='active');if(!others.length){toast('Create another active group first','error');return}const n=await ask({title:'Replace this group everywhere?',body:<>Audiences that use {g.name} will use the group you name instead. Available: {others.map(o=>o.code).join(', ')}</>,input:{label:'Replacement group code',required:true},confirm:'Replace'});if(n===false)return;const to=others.find(o=>o.code.toLowerCase()===n.trim().toLowerCase()||o.name.toLowerCase()===n.trim().toLowerCase());if(!to){toast('No active group with that code','error');return}act({action:'replace',replacementId:to.id},`Replaced with ${to.name}`)}}>Replace…</Btn>}
   <Btn variant="danger" icon="Trash2" onClick={async()=>{if(await ask({title:`Delete ${g.name}?`,body:used.length?`It is still used by ${used.map(([k,n])=>`${n} ${k}`).join(', ')}; deletion will be refused.`:'This cannot be undone.',confirm:'Delete',danger:true})===false)return;try{await api('/api/groups',{action:'delete',id});toast('Deleted');onChange();go('admin/groups')}catch(e){toast((e as Error).message,'error')}}}>Delete</Btn></>}>
  <Tabs value={tab} onChange={setTab} items={[{id:'members',label:'Members',count:data.members.length},{id:'usage',label:'Where it is used'},{id:'activity',label:'Activity'}]}/>
  {tab==='members'&&<div className="stack">
   {g.membership_mode==='dynamic'?<Note>Members come from rules: {describeRules(g.rules)}. The list updates automatically.</Note>:data.canManage&&<div className="row-gap"><div style={{minWidth:240}}><PersonSelect value={add} onChange={setAdd} placeholder="Add a person…"/></div><Btn disabled={!add} onClick={()=>{act({action:'members',add:[add]},'Added');setAdd(null)}}>Add member</Btn><Btn disabled={!add} onClick={()=>{act({action:'members',add:[add],role:'owner'},'Owner added');setAdd(null)}}>Add owner</Btn></div>}
   <table className="plain"><tbody>{data.members.map(m=><tr key={m.id}><td><Who id={m.id} sub/></td><td>{m.role==='owner'?<Chip tone="violet">Owner</Chip>:m.dynamic?<Chip tone="blue">By rule</Chip>:'Member'}</td><td>{data.canManage&&!m.dynamic&&<Btn size="sm" variant="ghost" icon="X" title="Remove" onClick={()=>act({action:'members',remove:[m.id]},'Removed')}/>}</td></tr>)}</tbody></table>
   {!data.members.length&&<p className="muted small">No members yet.</p>}
  </div>}
  {tab==='usage'&&(data.references?<table className="plain"><tbody>{Object.entries(data.references).map(([k,n])=><tr key={k}><td>{k}</td><td className="num">{n}</td></tr>)}</tbody></table>:<p className="muted">Only administrators see where groups are used.</p>)}
  {tab==='activity'&&<ol className="timeline">{data.activity.map((a,i)=><li key={i}><span className="dot"/><div><b>{a.action}</b><small>{a.who||'System'} · {ago(a.createdAt)}</small></div></li>)}{!data.activity.length&&<li className="muted">No activity.</li>}</ol>}
 </Modal>;
}
const describeRules=(r:Rules)=>[r.departments?.length&&`department is ${r.departments.join(' or ')}`,r.locations?.length&&`location is ${r.locations.join(' or ')}`,r.roles?.length&&`role is ${r.roles.join(' or ')}`,r.titles?.length&&`title contains ${r.titles.join(' or ')}`].filter(Boolean).join(' and ')||'none';
function GroupForm({g,onClose,onDone}:{g:Partial<Group>,onClose:()=>void,onDone:(id:string)=>void}){
 const {s,toast}=useApp();const [v,setV]=useState({name:g.name||'',code:g.code||'',description:g.description||'',type:g.type||'team',visibility:g.visibility||'company',membershipMode:g.membership_mode||'static',rules:{departments:[],locations:[],roles:[],titles:[],...g.rules} as Required<Rules>});
 const [owners,setOwners]=useState<string[]>([]);const [preview,setPreview]=useState<{id:string,name:string,department:string}[]|null>(null);
 const setRule=(k:keyof Rules,x:string[])=>{setV({...v,rules:{...v.rules,[k]:x}});setPreview(null)};
 return <Modal open wide onClose={onClose} title={g.id?'Edit group':'New group'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!v.name.trim()} onClick={async()=>{try{const r=await api<{id:string}>('/api/groups',{action:'save',id:g.id,...v,owners});toast('Saved');onDone(r.id)}catch(e){toast((e as Error).message,'error')}}}>Save</Btn></>}>
  <div className="form-grid">
   <Field label="Name"><input autoFocus value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field>
   <Field label="Code" hint="Letters, numbers and dashes. Generated from the name if empty."><input value={v.code} onChange={e=>setV({...v,code:e.target.value.toUpperCase()})}/></Field>
   <Field label="Description" wide><input value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
   <Field label="Type"><select value={v.type} onChange={e=>setV({...v,type:e.target.value})}>{['team','committee','site','project','distribution','security','other'].map(t=><option key={t}>{t}</option>)}</select></Field>
   <Field label="Who can choose it as an audience"><select value={v.visibility} onChange={e=>setV({...v,visibility:e.target.value})}><option value="company">Everyone</option><option value="members">Its members only</option></select></Field>
   <Field label="Membership" wide><div className="row-gap"><label className="check"><input type="radio" checked={v.membershipMode==='static'} onChange={()=>setV({...v,membershipMode:'static'})}/>Chosen people</label><label className="check"><input type="radio" checked={v.membershipMode==='dynamic'} onChange={()=>setV({...v,membershipMode:'dynamic'})}/>By rules (updates automatically)</label></div></Field>
   {v.membershipMode==='static'&&!g.id&&<Field label="Owners (can manage members)" wide><TagPicker values={owners.map(o=>s.people.find(p=>p.id===o)?.name||o)} options={s.people.filter(p=>p.active).map(p=>p.name)} onChange={names=>setOwners(names.map(n=>s.people.find(p=>p.name===n)?.id).filter(Boolean) as string[])} placeholder="Add owners"/></Field>}
   {v.membershipMode==='dynamic'&&<>
    <Field label="Departments" wide><TagPicker values={v.rules.departments} options={s.departments.map(d=>d.name)} onChange={x=>setRule('departments',x)} placeholder="Any department"/></Field>
    <Field label="Locations" wide><TagPicker values={v.rules.locations} options={s.locations.map(l=>l.name)} onChange={x=>setRule('locations',x)} placeholder="Any location"/></Field>
    <Field label="Roles" wide><TagPicker values={v.rules.roles} options={[...new Set(['admin','manager','staff',...s.roles.map(r=>r.name)])]} onChange={x=>setRule('roles',x)} placeholder="Any role"/></Field>
    <Field label="Job title contains" wide><TagPicker values={v.rules.titles} options={[...new Set(s.people.map(p=>p.title).filter(Boolean))]} onChange={x=>setRule('titles',x)} placeholder="Any title"/></Field>
    <div className="wide"><Btn size="sm" icon="Eye" onClick={async()=>{try{setPreview((await api<{members:{id:string,name:string,department:string}[]}>('/api/groups',{action:'preview-rules',rules:v.rules})).members)}catch(e){toast((e as Error).message,'error')}}}>Preview members</Btn>{preview&&<p className="small">{preview.length} people: {preview.slice(0,30).map(p=>p.name).join(', ')}{preview.length>30?'…':''}</p>}</div>
   </>}
  </div>
 </Modal>;
}
export {Card,Icon,cx};
