'use client';
import {useEffect,useMemo,useState} from 'react';
import {api,useApi,go,ago,dateOnly,hue,cx} from './lib';
import {useApp,Btn,Chip,Header,Field,Who,Avatar,Markdown,Thread,ErrorNote,Skeleton,Empty,Icon,Segmented,Menu} from './kit';
import {AiActions} from './assistant';
import {pageKinds} from '../data';

type Page={id:string,department:string,parent_id:string|null,kind:string,title:string,excerpt?:string,body?:string,icon:string,status:string,pinned:number,author_id:string,updated_by:string,created_at:string,updated_at:string,version:number};
const kindLabel:Record<string,string>={page:'Page',announcement:'Announcement',policy:'Policy',procedure:'Procedure',research:'Research note'};
const kindIcon:Record<string,string>={page:'FileText',announcement:'Megaphone',policy:'Scale',procedure:'ListChecks',research:'FlaskConical'};
const spaceColor=(name:string,color?:string)=>color||`hsl(${hue(name)} 65% 58%)`;
function usePages(){return useApi<{pages:Page[],canCreate:Record<string,boolean>}>('/api/pages')}

export default function Spaces({parts}:{parts:string[]}){
 if(parts[0]==='page'&&parts[1])return <Reader id={parts[1]}/>;
 if(parts[0]==='edit')return <Editor id={parts[1]==='new'?undefined:parts[1]} space={parts[2]} parent={parts[3]}/>;
 if(parts[0]==='d')return <Space name={parts[1]==='company'?'':parts[1]||''}/>;
 return <AllSpaces/>;
}

function AllSpaces(){
 const {s}=useApp();const {data,error,reload}=usePages();
 const spaces=[{name:'',label:'Company',color:'var(--brand)',headId:null as string|null,description:'Announcements, policies and pages for everyone.'},...s.departments.map(d=>({name:d.name,label:d.name,color:spaceColor(d.name,d.color),headId:d.headId,description:d.description}))];
 const recent=(data?.pages||[]).filter(p=>p.status==='Published').slice(0,8);
 return <div className="page">
  <Header icon="LibraryBig" tone="pink" title="Spaces" subtitle="Every department's home: procedures, announcements, research notes and know-how in one searchable place." actions={<Btn variant="primary" icon="PenLine" onClick={()=>go('spaces/edit/new')}>Write a page</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  <div className="space-grid">{spaces.map(sp=>{const n=(data?.pages||[]).filter(p=>p.department===sp.name).length;const members=s.people.filter(p=>p.active&&sp.name&&p.department.toLowerCase()===sp.name.toLowerCase());return <a key={sp.label} href={`#/spaces/d/${sp.name?encodeURIComponent(sp.name):'company'}`} className="space-card"><div className="space-cover" style={{background:sp.color}}><Icon name={sp.name?'Building2':'Megaphone'} size={20}/></div><div className="space-body"><b>{sp.label}</b><p>{sp.description||`${n} pages`}</p><div className="space-foot"><span className="avatars">{members.slice(0,4).map(m=><Avatar key={m.id} name={m.name} size={22}/>)}{members.length>4&&<em>+{members.length-4}</em>}</span><span className="muted small">{n} pages</span></div></div></a>})}</div>
  <h2 className="section-title">Recently updated</h2>
  {!data?<Skeleton/>:!recent.length?<Empty icon="FileText" title="No published pages yet">Start with a welcome page, an onboarding checklist or your team's key procedures.</Empty>:<div className="page-list">{recent.map(p=><PageRow key={p.id} p={p}/>)}</div>}
 </div>;
}
function PageRow({p}:{p:Page}){return <a href={`#/spaces/page/${p.id}`} className="page-row"><span className="page-row-icon">{p.icon&&!/^[a-z]+$/.test(p.icon)?p.icon:<Icon name={kindIcon[p.kind]||'FileText'} size={17}/>}</span><span className="page-row-main"><b>{p.title}{!!p.pinned&&<Icon name="Pin" size={13}/>}</b><small>{p.excerpt}</small></span><span className="page-row-meta">{p.status!=='Published'&&<Chip>{p.status}</Chip>}<Chip tone="gray">{kindLabel[p.kind]}</Chip><small>{p.department||'Company'} · {ago(p.updated_at)}</small></span></a>}

function Space({name}:{name:string}){
 const {s}=useApp();const {data,error,reload}=usePages();const [kind,setKind]=useState('all');
 const dept=s.departments.find(d=>d.name===name);const label=name||'Company';const color=name?spaceColor(name,dept?.color):'var(--brand)';
 const pages=(data?.pages||[]).filter(p=>p.department===name);const shown=pages.filter(p=>kind==='all'||p.kind===kind);
 const members=name?s.people.filter(p=>p.active&&p.department.toLowerCase()===name.toLowerCase()):[];
 const canWrite=!!data?.canCreate?.[name];
 const pinned=pages.filter(p=>p.pinned&&p.status==='Published');
 const tree=(parent:string|null,depth:number):React.ReactNode=>shown.filter(p=>p.parent_id===parent||(parent===null&&p.parent_id&&!shown.some(x=>x.id===p.parent_id))).map(p=><div key={p.id} style={{marginLeft:depth*20}}><PageRow p={p}/>{depth<4&&tree(p.id,depth+1)}</div>);
 return <div className="page">
  <section className="space-hero" style={{'--sc':color} as React.CSSProperties}>
   <div className="space-hero-band"/>
   <div className="space-hero-body"><div><span className="eyebrow">{name?'Department space':'Company space'}</span><h1>{label}</h1><p>{dept?.description||(name?`Procedures, announcements and knowledge from ${label}.`:'Announcements and pages for everyone in the company.')}</p></div>
    <div className="space-hero-side">{dept?.headId&&<div><small className="muted">Head</small><Who id={dept.headId} sub/></div>}{members.length>0&&<a href={`#/people/directory`} className="avatars">{members.slice(0,7).map(m=><Avatar key={m.id} name={m.name} size={28} ring/>)}{members.length>7&&<em>+{members.length-7}</em>}</a>}{canWrite&&<Btn variant="primary" icon="PenLine" onClick={()=>go(`spaces/edit/new/${name?encodeURIComponent(name):'company'}`)}>New page</Btn>}</div></div>
  </section>
  <ErrorNote error={error} onRetry={reload}/>
  {pinned.length>0&&<div className="pinned">{pinned.map(p=><a key={p.id} href={`#/spaces/page/${p.id}`} className="pinned-card"><Icon name="Pin" size={14}/><b>{p.title}</b><small>{p.excerpt?.slice(0,110)}</small></a>)}</div>}
  <div className="between"><h2 className="section-title">Pages</h2><Segmented value={kind} onChange={setKind} items={[{id:'all',label:'All'},...pageKinds.filter(k=>pages.some(p=>p.kind===k)).map(k=>({id:k,label:kindLabel[k]}))]}/></div>
  {!data?<Skeleton/>:!shown.length?<Empty icon="LibraryBig" title="Nothing here yet" action={canWrite&&<Btn icon="PenLine" onClick={()=>go(`spaces/edit/new/${name?encodeURIComponent(name):'company'}`)}>Write the first page</Btn>}>Good first pages: who's who, how to request help from this team, key procedures.</Empty>:<div className="page-list">{tree(null,0)}</div>}
 </div>;
}

function Reader({id}:{id:string}){
 const {toast,ask,s}=useApp();const {data,error,reload}=useApi<{page:Page,comments:any[],children:{id:string,title:string,icon:string,status:string}[],canEdit:boolean,canPublish:boolean}>('/api/pages?id='+encodeURIComponent(id));
 const p=data?.page;
 async function act(body:Record<string,unknown>,msg:string){try{await api('/api/pages',{id,...body});toast(msg);reload()}catch(e){toast((e as Error).message,'error')}}
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!p)return <div className="page"><Skeleton rows={10}/></div>;
 const space=p.department?`#/spaces/d/${encodeURIComponent(p.department)}`:'#/spaces/d/company';
 return <div className="page reader">
  <div className="doc-top"><a className="btn btn-ghost" href={space}><Icon name="ArrowLeft" size={17}/><span>{p.department||'Company'}</span></a><div className="grow"/><AiActions entity="page" entityId={p.id}/>
   {data.canPublish&&p.status!=='Published'&&<Btn variant="primary" icon="Send" onClick={()=>act({action:'status',status:'Published'},'Published')}>Publish</Btn>}
   {data.canEdit&&<Btn icon="Pencil" onClick={()=>go(`spaces/edit/${id}`)}>Edit</Btn>}
   {(data.canEdit||data.canPublish)&&<Menu trigger={o=><Btn variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:'Move back to draft',icon:'Undo2',onClick:()=>act({action:'status',status:'Draft'},'Moved to draft'),hidden:!data.canPublish||p.status!=='Published'},{label:'Archive',icon:'Archive',onClick:()=>act({action:'status',status:'Archived'},'Archived'),hidden:!data.canPublish},{label:'Add a sub-page',icon:'FilePlus',onClick:()=>go(`spaces/edit/new/${p.department?encodeURIComponent(p.department):'company'}/${p.id}`)},{label:'Print',icon:'Printer',onClick:()=>window.print()},'-',{label:'Delete page',icon:'Trash2',danger:true,hidden:!data.canEdit,onClick:async()=>{if(await ask({title:`Delete “${p.title}”?`,confirm:'Delete',danger:true})===false)return;await api('/api/pages',{action:'delete',id});toast('Page deleted');location.hash=space}}]}/>}
  </div>
  <article className="article">
   <div className="article-meta"><Chip tone="gray">{kindLabel[p.kind]}</Chip>{p.status!=='Published'&&<Chip>{p.status}</Chip>}<span className="muted small">By {s.people.find(x=>x.id===p.author_id)?.name||'—'} · updated {ago(p.updated_at)}</span></div>
   <h1>{p.icon&&!/^[a-z]+$/.test(p.icon)&&<span className="article-icon">{p.icon}</span>}{p.title}</h1>
   <Markdown text={p.body||''}/>
   {data.children.length>0&&<div className="children"><h3>In this section</h3>{data.children.map(c=><a key={c.id} href={`#/spaces/page/${c.id}`}><Icon name="CornerDownRight" size={15}/>{c.title}{c.status!=='Published'&&<Chip>{c.status}</Chip>}</a>)}</div>}
   <p className="muted small">Created {dateOnly(p.created_at)}</p>
  </article>
  <section className="article-comments no-print"><h3>Discussion</h3><Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:'page',id,body});reload()}}/></section>
 </div>;
}

function Editor({id,space,parent}:{id?:string,space?:string,parent?:string}){
 const {s,toast}=useApp();const all=usePages();const existing=useApi<{page:Page,canPublish:boolean}>(id?'/api/pages?id='+encodeURIComponent(id):null);
 const initSpace=space==='company'?'':space?decodeURIComponent(space):s.user.department;
 const [v,setV]=useState({title:'',body:'',icon:'',kind:'page',department:initSpace,parentId:parent||'',pinned:false});const [loaded,setLoaded]=useState(!id);const [mode,setMode]=useState('split');const [busy,setBusy]=useState('');
 useEffect(()=>{const p=existing.data?.page;if(!p||loaded)return;setV({title:p.title,body:p.body||'',icon:/^[a-z]+$/.test(p.icon)?'':p.icon,kind:p.kind,department:p.department,parentId:p.parent_id||'',pinned:!!p.pinned});setLoaded(true)},[existing.data,loaded]);
 const spaces=useMemo(()=>['',...s.departments.map(d=>d.name)].filter(x=>all.data?.canCreate?.[x]||x===v.department),[s.departments,all.data,v.department]);
 async function save(publish:boolean){setBusy(publish?'publish':'save');try{const r=await api<{id:string,status?:string}>('/api/pages',{action:'save',id,version:existing.data?.page.version,...v,parentId:v.parentId||null,publish});if(id&&publish&&existing.data?.canPublish)await api('/api/pages',{action:'status',id,status:'Published'});toast(publish?'Page published':'Saved');go(`spaces/page/${r.id}`)}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}}
 const insert=(before:string,after='')=>setV(x=>({...x,body:x.body+(x.body&&!x.body.endsWith('\n')?'\n':'')+before+after}));
 if(id&&!loaded)return <div className="page"><ErrorNote error={existing.error}/><Skeleton rows={8}/></div>;
 return <div className="page editor-page">
  <div className="doc-top"><Btn variant="ghost" icon="X" onClick={()=>history.back()}>Close</Btn><div className="grow"/><Segmented value={mode} onChange={setMode} items={[{id:'write',label:'Write'},{id:'split',label:'Split'},{id:'preview',label:'Preview'}]}/><Btn busy={busy==='save'} onClick={()=>save(false)}>Save draft</Btn><Btn variant="primary" icon="Send" busy={busy==='publish'} onClick={()=>save(true)}>{id&&existing.data?.page.status==='Published'?'Save':'Publish'}</Btn></div>
  <div className="page-settings">
   <input className="emoji-in" maxLength={4} value={v.icon} placeholder="📄" onChange={e=>setV({...v,icon:e.target.value})} aria-label="Page icon"/>
   <input className="title-in" value={v.title} placeholder="Untitled page" onChange={e=>setV({...v,title:e.target.value})} autoFocus={!id}/>
  </div>
  <div className="settings-row">
   <Field label="Space"><select value={v.department} onChange={e=>setV({...v,department:e.target.value})}>{spaces.map(x=><option key={x} value={x}>{x||'Company'}</option>)}</select></Field>
   <Field label="Type"><select value={v.kind} onChange={e=>setV({...v,kind:e.target.value})}>{pageKinds.map(k=><option key={k} value={k}>{kindLabel[k]}</option>)}</select></Field>
   <Field label="Inside"><select value={v.parentId} onChange={e=>setV({...v,parentId:e.target.value})}><option value="">Top level</option>{(all.data?.pages||[]).filter(p=>p.department===v.department&&p.id!==id).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
   <label className="check"><input type="checkbox" checked={v.pinned} onChange={e=>setV({...v,pinned:e.target.checked})}/>Pin to space</label>
  </div>
  {v.kind==='announcement'&&<p className="muted small"><Icon name="Megaphone" size={13}/> Publishing an announcement notifies everyone in {v.department||'the company'}.</p>}
  <div className={cx('md-editor',`mode-${mode}`)}>
   {mode!=='preview'&&<div className="md-write"><div className="md-tools">{[['Heading2','## '],['Bold','**bold**'],['List','- '],['ListChecks','- [ ] '],['ListOrdered','1. '],['Quote','> '],['Link','[text](https://)'],['Table','| Column | Column |\n|---|---|\n| | |'],['Minus','---']].map(([i,t])=><button key={i} type="button" title={i} onClick={()=>insert(t)}><Icon name={i} size={15}/></button>)}</div><textarea value={v.body} onChange={e=>setV({...v,body:e.target.value})} placeholder={'Write with Markdown.\n\n## Purpose\nWhat this page is for…\n\n## Steps\n1. First…'}/></div>}
   {mode!=='write'&&<div className="md-preview"><h1>{v.icon} {v.title||'Untitled page'}</h1><Markdown text={v.body}/></div>}
  </div>
 </div>;
}
