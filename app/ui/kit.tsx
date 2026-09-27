'use client';
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type ComponentType} from 'react';
import {icons as iconSet} from './icons';
import {cx,initials,hue,downloadCsv,pref,setPref} from './lib';
import qrcode from 'qrcode-generator';

// ── Session ─────────────────────────────────────────────────────────────────
export type Person={id:string,name:string,email:string,department:string,title:string,role:string,roleId:string|null,location:string,active:number};
export type Session={
 user:{id:string,name:string,email:string,role:string,roleId:string|null,department:string,title:string,location:string,platformRole:string|null,permissions:Record<string,Record<string,string>>,identityId:string,defaultScreen:string,rolePages?:string[]|null},
 tenant:{id:string,name:string,legalName:string,slug:string,brandColor:string,currency:string,timezone:string,domains:string,plan:string,status:string,settings:Record<string,any>,modules:string[],pages?:string[]},
 support:{id:string,reason:string,startedAt:string,tenantName:string}|null,
 memberships:{id:string,tenantId:string,name:string,brandColor:string}[],
 people:Person[],departments:{id:string,name:string,code:string,headId:string|null,color:string,description:string,parentId?:string|null,costCentre?:string,status?:string}[],locations:{id:string,name:string,path:string,parentId:string|null,kind:string}[],roles:{id:string,name:string,base:string}[],
 counts:{notifications:number,approvals:number,tickets:number},
};
type Ask={title:string,body?:ReactNode,confirm?:string,danger?:boolean,input?:{label:string,placeholder?:string,required?:boolean,type?:string,minLength?:number,multiline?:boolean}};
type Ctx={s:Session,can:(page:string,action?:string)=>boolean,scope:(page:string,action?:string)=>string,person:(id?:string|null)=>Person|undefined,refresh:()=>Promise<void>,toast:(msg:string,tone?:'ok'|'error'|'info')=>void,ask:(a:Ask)=>Promise<string|false>};
export const AppContext=createContext<Ctx|null>(null);
export function useApp(){const c=useContext(AppContext);if(!c)throw Error('App context missing');return c}

// ── Icons ───────────────────────────────────────────────────────────────────
const icons=iconSet as unknown as Record<string,ComponentType<{size?:number,strokeWidth?:number,className?:string}>>;
export function Icon({name,size=18,className,stroke=1.8}:{name:string,size?:number,className?:string,stroke?:number}){const C=icons[name]||icons.Circle;return <C size={size} strokeWidth={stroke} className={className}/>}

// ── Primitives ──────────────────────────────────────────────────────────────
type BtnProps={children?:ReactNode,icon?:string,variant?:'primary'|'ghost'|'danger'|'subtle'|'default',size?:'sm'|'md',onClick?:(e:React.MouseEvent)=>void,disabled?:boolean,type?:'button'|'submit',title?:string,className?:string,busy?:boolean,href?:string};
export function Btn({children,icon,variant='default',size='md',onClick,disabled,type='button',title,className,busy,href}:BtnProps){
 const c=cx('btn',`btn-${variant}`,size==='sm'&&'btn-sm',!children&&'btn-icon',className);
 const inner=<>{busy?<span className="spin"/>:icon&&<Icon name={icon} size={size==='sm'?15:17}/>}{children&&<span>{children}</span>}</>;
 if(href)return <a className={c} href={href} title={title} aria-label={title}>{inner}</a>;
 return <button type={type} className={c} onClick={onClick} disabled={disabled||busy} title={title} aria-label={!children?title:undefined}>{inner}</button>;
}
const tones:Record<string,string>={Approved:'green',Active:'green','In use':'green',Resolved:'green',Published:'green',Received:'green',Ready:'green','In stock':'green',Normal:'green',Converted:'violet',Issued:'blue',New:'blue',Open:'blue','In store':'blue','Partially received':'amber','Pending approval':'amber',Pending:'amber','In progress':'amber','On hold':'amber',Maintenance:'amber',Draft:'gray','Low stock':'amber','Under review':'amber',Rejected:'red',Lost:'red',Urgent:'red',Failed:'red','Out of stock':'red',High:'orange',Medium:'amber',Low:'gray',Closed:'gray',Retired:'gray',Archived:'gray',Cancelled:'gray',Inactive:'gray',Skipped:'gray',Waiting:'gray',Suspended:'red',suspended:'red',active:'green'};
export function Chip({children,tone}:{children:ReactNode,tone?:string}){const t=tone||tones[String(children)]||'gray';return <span className={`chip chip-${t}`}><i/>{children}</span>}
export function Avatar({name,size=28,ring}:{name?:string,size?:number,ring?:boolean}){const h=hue(name||'');return <span className={cx('avatar',ring&&'avatar-ring')} style={{width:size,height:size,fontSize:size*.38,background:`hsl(${h} 70% 88%)`,color:`hsl(${h} 45% 28%)`}} title={name}>{initials(name)}</span>}
export function Who({id,fallback='Unassigned',sub}:{id?:string|null,fallback?:string,sub?:boolean}){const {person}=useApp();const p=person(id);if(!p)return <span className="muted">{fallback}</span>;return <span className="who"><Avatar name={p.name} size={22}/><span>{p.name}{sub&&<small>{p.title||p.department}</small>}</span></span>}
export function Empty({icon='Inbox',title,children,action}:{icon?:string,title:string,children?:ReactNode,action?:ReactNode}){return <div className="empty"><span className="empty-icon"><Icon name={icon} size={26}/></span><h3>{title}</h3>{children&&<p>{children}</p>}{action}</div>}
export function Skeleton({rows=5}:{rows?:number}){return <div className="skeleton">{Array.from({length:rows},(_,i)=><div key={i} style={{width:`${92-i*9%40}%`}}/>)}</div>}
export function Field({label,hint,children,wide}:{label:string,hint?:ReactNode,children:ReactNode,wide?:boolean}){return <label className={cx('field',wide&&'field-wide')}><span className="field-label">{label}</span>{children}{hint&&<small className="field-hint">{hint}</small>}</label>}
export function ErrorNote({error,onRetry}:{error:string,onRetry?:()=>void}){if(!error)return null;return <div className="note note-error" role="alert"><Icon name="TriangleAlert" size={16}/><span>{error}</span>{onRetry&&<button className="link" onClick={onRetry}>Retry</button>}</div>}
export function Note({children,tone='info',icon}:{children:ReactNode,tone?:'info'|'warn'|'ok',icon?:string}){return <div className={`note note-${tone}`}><Icon name={icon||(tone==='warn'?'TriangleAlert':tone==='ok'?'CircleCheck':'Info')} size={16}/><span>{children}</span></div>}
export function Header({title,subtitle,actions,icon,tone}:{title:ReactNode,subtitle?:ReactNode,actions?:ReactNode,icon?:string,tone?:string}){return <header className="page-head">{icon&&<span className={`page-icon tone-${tone||'violet'}`}><Icon name={icon} size={22}/></span>}<div className="page-head-text"><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</header>}
export function Stat({label,value,sub,icon,tone='violet',onClick}:{label:string,value:ReactNode,sub?:ReactNode,icon?:string,tone?:string,onClick?:()=>void}){const Tag=onClick?'button':'div';return <Tag className={cx('stat',onClick&&'stat-link')} onClick={onClick}><div className="stat-top"><span>{label}</span>{icon&&<span className={`stat-icon tone-${tone}`}><Icon name={icon} size={16}/></span>}</div><strong>{value}</strong>{sub&&<small>{sub}</small>}</Tag>}
export function Tabs({items,value,onChange}:{items:{id:string,label:ReactNode,count?:number}[],value:string,onChange:(id:string)=>void}){return <div className="tabs" role="tablist">{items.map(t=><button key={t.id} role="tab" aria-selected={value===t.id} className={cx('tab',value===t.id&&'on')} onClick={()=>onChange(t.id)}>{t.label}{t.count!==undefined&&<b>{t.count}</b>}</button>)}</div>}
export function Segmented({items,value,onChange}:{items:{id:string,label:ReactNode,icon?:string}[],value:string,onChange:(id:string)=>void}){return <div className="segmented">{items.map(t=><button key={t.id} className={cx(value===t.id&&'on')} onClick={()=>onChange(t.id)} title={typeof t.label==='string'?t.label:undefined}>{t.icon&&<Icon name={t.icon} size={15}/>}{t.label&&<span>{t.label}</span>}</button>)}</div>}
export function Card({title,actions,children,className,pad=true}:{title?:ReactNode,actions?:ReactNode,children:ReactNode,className?:string,pad?:boolean}){return <section className={cx('card',!pad&&'card-flush',className)}>{(title||actions)&&<div className="card-head"><h2>{title}</h2>{actions&&<div className="card-actions">{actions}</div>}</div>}{children}</section>}
export function KV({items}:{items:[string,ReactNode][]}){return <dl className="kv">{items.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}

// ── Overlays ────────────────────────────────────────────────────────────────
function useEscape(open:boolean,onClose:()=>void){useEffect(()=>{if(!open)return;const f=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose()}};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[open,onClose])}
export function Modal({open,onClose,title,children,footer,wide,subtitle}:{open:boolean,onClose:()=>void,title:ReactNode,children:ReactNode,footer?:ReactNode,wide?:boolean,subtitle?:ReactNode}){useEscape(open,onClose);if(!open)return null;return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={cx('modal',wide&&'modal-wide')} role="dialog" aria-modal="true" aria-label={typeof title==='string'?title:undefined}><div className="modal-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><Btn icon="X" variant="ghost" title="Close" onClick={onClose}/></div><div className="modal-body">{children}</div>{footer&&<div className="modal-foot">{footer}</div>}</div></div>}
// Right-hand panel for record details; keeps the list visible behind it on wide screens.
export function Inspector({open,onClose,title,subtitle,eyebrow,actions,children,width=560}:{open:boolean,onClose:()=>void,title:ReactNode,subtitle?:ReactNode,eyebrow?:ReactNode,actions?:ReactNode,children:ReactNode,width?:number}){useEscape(open,onClose);if(!open)return null;return <><div className="inspector-scrim" onClick={onClose}/><aside className="inspector" style={{width:`min(${width}px,100vw)`}} role="dialog" aria-label={typeof title==='string'?title:'Details'}><div className="inspector-head"><div className="inspector-title">{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{subtitle&&<div className="inspector-sub">{subtitle}</div>}</div><div className="inspector-tools">{actions}<Btn icon="X" variant="ghost" title="Close" onClick={onClose}/></div></div><div className="inspector-body">{children}</div></aside></>}
export function AskDialog({ask,onDone}:{ask:Ask|null,onDone:(v:string|false)=>void}){const [v,setV]=useState('');useEffect(()=>setV(''),[ask]);if(!ask)return null;const i=ask.input;const invalid=!!i&&((i.required&&!v.trim())||(!!i.minLength&&v.length<i.minLength));return <Modal open onClose={()=>onDone(false)} title={ask.title} footer={<><Btn variant="ghost" onClick={()=>onDone(false)}>Cancel</Btn><Btn variant={ask.danger?'danger':'primary'} disabled={invalid} onClick={()=>onDone(v)}>{ask.confirm||'Confirm'}</Btn></>}>{ask.body&&<div className="ask-body">{ask.body}</div>}{i&&<Field label={i.label} hint={i.minLength?`At least ${i.minLength} characters`:undefined}>{i.multiline?<textarea autoFocus rows={4} value={v} placeholder={i.placeholder} onChange={e=>setV(e.target.value)}/>:<input autoFocus type={i.type||'text'} value={v} placeholder={i.placeholder} onChange={e=>setV(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!invalid)onDone(v)}}/>}</Field>}</Modal>}
export function Menu({trigger,items,align='right'}:{trigger:(open:()=>void)=>ReactNode,items:({label:string,icon?:string,onClick:()=>void,danger?:boolean,hidden?:boolean}|'-')[],align?:'left'|'right'}){
 const [open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const f=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',f);return()=>document.removeEventListener('mousedown',f)},[open]);
 return <div className="menu-wrap" ref={ref}>{trigger(()=>setOpen(o=>!o))}{open&&<div className={`menu menu-${align}`} role="menu">{items.filter(i=>i==='-'||!i.hidden).map((i,n)=>i==='-'?<hr key={n}/>:<button key={n} role="menuitem" className={cx(i.danger&&'danger')} onClick={()=>{setOpen(false);i.onClick()}}>{i.icon&&<Icon name={i.icon} size={15}/>}{i.label}</button>)}</div>}</div>;
}

// ── Pickers ─────────────────────────────────────────────────────────────────
export function PersonSelect({value,onChange,placeholder='Search people…',filter,allowClear=true}:{value?:string|null,onChange:(id:string|null)=>void,placeholder?:string,filter?:(p:Person)=>boolean,allowClear?:boolean}){
 const {s,person}=useApp();const [q,setQ]=useState(''),[open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const f=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',f);return()=>document.removeEventListener('mousedown',f)},[open]);
 const list=useMemo(()=>s.people.filter(p=>p.active&&(!filter||filter(p))&&`${p.name} ${p.email} ${p.department} ${p.title}`.toLowerCase().includes(q.toLowerCase())).slice(0,40),[s.people,q,filter]);
 const cur=person(value);
 return <div className="combo" ref={ref}>{cur&&!open?<button type="button" className="combo-value" onClick={()=>setOpen(true)}><Avatar name={cur.name} size={20}/><span>{cur.name}</span><small>{cur.department}</small>{allowClear&&<span className="combo-clear" role="button" aria-label="Clear" onClick={e=>{e.stopPropagation();onChange(null)}}><Icon name="X" size={14}/></span>}</button>:<input value={q} placeholder={placeholder} onFocus={()=>setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(true)}} autoFocus={open&&!!cur}/>}{open&&<div className="combo-list">{list.map(p=><button type="button" key={p.id} onClick={()=>{onChange(p.id);setOpen(false);setQ('')}}><Avatar name={p.name} size={22}/><span>{p.name}<small>{[p.title,p.department].filter(Boolean).join(' · ')}</small></span></button>)}{!list.length&&<div className="combo-empty">No matches</div>}</div>}</div>;
}
export function DeptSelect({value,onChange,any,required}:{value:string,onChange:(v:string)=>void,any?:string,required?:boolean}){const {s}=useApp();const names=[...new Set([...s.departments.map(d=>d.name),...(value&&value!=='*'?[value]:[])])].sort();return <select value={value} required={required} onChange={e=>onChange(e.target.value)}>{any!==undefined&&<option value={any==='*'?'*':''}>{any==='*'?'All departments':any||'—'}</option>}{!any&&!value&&<option value="">Choose…</option>}{names.map(n=><option key={n}>{n}</option>)}</select>}
export function LocationInput({value,onChange,placeholder='Site > Unit > Area'}:{value:string,onChange:(v:string)=>void,placeholder?:string}){const {s}=useApp();const id=useMemo(()=>'loc-'+Math.random().toString(36).slice(2),[]);return <><input list={id} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/><datalist id={id}>{s.locations.map(l=><option key={l.id} value={l.path}/>)}</datalist></>}

// ── Data grid ───────────────────────────────────────────────────────────────
export type Col<T>={key:string,label:string,render?:(r:T)=>ReactNode,value?:(r:T)=>string|number,width?:number,align?:'right',hide?:boolean,sortable?:boolean};
export function Grid<T extends {id:string}>({id,rows,cols,onOpen,selectable,selected,onSelect,toolbar,empty,exportName,initialSort,pageSize=100,dense,activeId}:{id:string,rows:T[],cols:Col<T>[],onOpen?:(r:T)=>void,selectable?:boolean,selected?:Set<string>,onSelect?:(s:Set<string>)=>void,toolbar?:ReactNode,empty?:ReactNode,exportName?:string,initialSort?:[string,'asc'|'desc'],pageSize?:number,dense?:boolean,activeId?:string}){
 const [q,setQ]=useState(''),[filters,setFilters]=useState<Record<string,string>>({}),[sort,setSort]=useState<[string,'asc'|'desc']|null>(initialSort||null),[page,setPage]=useState(0),[showFilters,setShowFilters]=useState(false);
 const [hidden,setHidden]=useState<string[]>(()=>pref('grid:'+id,cols.filter(c=>c.hide).map(c=>c.key)));
 const {ask,toast}=useApp();const [views,setViews]=useState<{id:string,name:string,state:{q?:string,filters?:Record<string,string>,sort?:[string,'asc'|'desc']|null,hidden?:string[]}}[]|null>(null);
 const loadViews=()=>fetch('/api/views?grid='+encodeURIComponent(id)).then(r=>r.json() as Promise<{views?:never[]}>).then(d=>setViews(d.views||[])).catch(()=>setViews([]));
 async function saveView(){const name=await ask({title:'Save this view',body:'Saves the current filters, sort and columns for you in this workspace.',confirm:'Save',input:{label:'View name',required:true}});if(name===false)return;const r=await fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grid:id,name,state:{q,filters,sort,hidden}})});if(r.ok){toast('View saved');loadViews()}else toast(((await r.json()) as {error?:string}).error||'Could not save view','error')}
 function applyView(v:{state:{q?:string,filters?:Record<string,string>,sort?:[string,'asc'|'desc']|null,hidden?:string[]}}){setQ(v.state.q||'');setFilters(v.state.filters||{});setSort(v.state.sort||null);if(v.state.hidden){setHidden(v.state.hidden);setPref('grid:'+id,v.state.hidden)}if(v.state.filters&&Object.values(v.state.filters).some(Boolean))setShowFilters(true)}
 const val=(c:Col<T>,r:T)=>c.value?c.value(r):String((r as Record<string,unknown>)[c.key]??'');
 const visible=cols.filter(c=>!hidden.includes(c.key));
 const filtered=useMemo(()=>{let out=rows;const ql=q.toLowerCase();if(ql)out=out.filter(r=>cols.some(c=>String(val(c,r)).toLowerCase().includes(ql)));for(const [k,v] of Object.entries(filters))if(v){const c=cols.find(x=>x.key===k);if(c)out=out.filter(r=>String(val(c,r)).toLowerCase().includes(v.toLowerCase()))}if(sort){const c=cols.find(x=>x.key===sort[0]);if(c)out=[...out].sort((a,b)=>{const x=val(c,a),y=val(c,b);const n=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true});return sort[1]==='asc'?n:-n})}return out},[rows,q,filters,sort,cols]);
 useEffect(()=>setPage(0),[q,filters,rows.length]);
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize));const shown=filtered.slice(page*pageSize,page*pageSize+pageSize);
 const all=selectable&&shown.length>0&&shown.every(r=>selected?.has(r.id));
 function toggleCol(k:string){const next=hidden.includes(k)?hidden.filter(x=>x!==k):[...hidden,k];setHidden(next);setPref('grid:'+id,next)}
 return <div className={cx('grid',dense&&'grid-dense')}>
  <div className="grid-bar">
   <div className="grid-search"><Icon name="Search" size={16}/><input placeholder="Filter this list…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Filter rows"/>{q&&<button className="link" onClick={()=>setQ('')}><Icon name="X" size={14}/></button>}</div>
   {toolbar}
   <div className="grid-tools">
    <Menu trigger={open=><Btn size="sm" variant="ghost" icon="Bookmark" title="Saved views" onClick={()=>{if(!views)loadViews();open()}}/>} items={[{label:'Save current view…',icon:'BookmarkPlus',onClick:saveView},...(views?.length?['-' as const,...views.map(v=>({label:v.name,icon:'Bookmark',onClick:()=>applyView(v)})),'-' as const,...views.map(v=>({label:`Delete “${v.name}”`,icon:'Trash2',danger:true,onClick:()=>{fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id:v.id})}).then(loadViews)}}))]:[])]}/>
    <Btn size="sm" variant={showFilters||Object.values(filters).some(Boolean)?'subtle':'ghost'} icon="ListFilter" title="Column filters" onClick={()=>setShowFilters(!showFilters)}/>
    <Menu trigger={open=><Btn size="sm" variant="ghost" icon="Columns3" title="Choose columns" onClick={open}/>} items={cols.map(c=>({label:(hidden.includes(c.key)?'   ':'✓ ')+c.label,onClick:()=>toggleCol(c.key)}))}/>
    {exportName&&<Btn size="sm" variant="ghost" icon="Download" title="Export CSV" onClick={()=>downloadCsv(exportName,[visible.map(c=>c.label),...filtered.map(r=>visible.map(c=>val(c,r)))])}/>}
   </div>
  </div>
  {selectable&&!!selected?.size&&<div className="grid-selection"><b>{selected.size}</b> selected<button className="link" onClick={()=>onSelect?.(new Set())}>Clear</button></div>}
  <div className="grid-scroll"><table>
   <thead><tr>{selectable&&<th className="grid-check"><input type="checkbox" aria-label="Select all" checked={!!all} onChange={()=>{const n=new Set(selected);for(const r of shown){if(all)n.delete(r.id);else n.add(r.id)}onSelect?.(n)}}/></th>}{visible.map(c=><th key={c.key} style={{width:c.width,textAlign:c.align}}><button className="th" onClick={()=>c.sortable!==false&&setSort(s=>s?.[0]===c.key?(s[1]==='asc'?[c.key,'desc']:null):[c.key,'asc'])}>{c.label}{sort?.[0]===c.key&&<Icon name={sort[1]==='asc'?'ArrowUp':'ArrowDown'} size={12}/>}</button></th>)}</tr>
   {showFilters&&<tr className="grid-filters">{selectable&&<th/>}{visible.map(c=><th key={c.key}><input aria-label={`Filter ${c.label}`} value={filters[c.key]||''} onChange={e=>setFilters({...filters,[c.key]:e.target.value})} placeholder="Filter"/></th>)}</tr>}</thead>
   <tbody>{shown.map(r=><tr key={r.id} className={cx(onOpen&&'clickable',activeId===r.id&&'active',selected?.has(r.id)&&'selected')} onClick={()=>onOpen?.(r)}>{selectable&&<td className="grid-check" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label="Select row" checked={!!selected?.has(r.id)} onChange={()=>{const n=new Set(selected);if(n.has(r.id))n.delete(r.id);else n.add(r.id);onSelect?.(n)}}/></td>}{visible.map(c=><td key={c.key} style={{textAlign:c.align}}>{c.render?c.render(r):val(c,r)||<span className="muted">—</span>}</td>)}</tr>)}</tbody>
  </table>{!filtered.length&&(empty||<Empty icon="SearchX" title={rows.length?'Nothing matches':'Nothing here yet'}>{rows.length?'Try a different filter.':undefined}</Empty>)}</div>
  <div className="grid-foot"><span>{filtered.length===rows.length?`${rows.length.toLocaleString()} records`:`${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()}`}</span>{pages>1&&<div className="pager"><Btn size="sm" variant="ghost" icon="ChevronLeft" title="Previous page" disabled={!page} onClick={()=>setPage(page-1)}/><span>{page+1} / {pages}</span><Btn size="sm" variant="ghost" icon="ChevronRight" title="Next page" disabled={page>=pages-1} onClick={()=>setPage(page+1)}/></div>}</div>
 </div>;
}

// ── Markdown (safe subset rendered to React, never raw HTML) ────────────────
function inline(text:string,key=0):ReactNode[]{
 const out:ReactNode[]=[];const re=/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|@[A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?)/g;let last=0,m:RegExpExecArray|null,i=0;
 while((m=re.exec(text))){if(m.index>last)out.push(text.slice(last,m.index));const t=m[0];const k=`${key}-${i++}`;
  if(t.startsWith('**'))out.push(<strong key={k}>{t.slice(2,-2)}</strong>);else if(t.startsWith('`'))out.push(<code key={k}>{t.slice(1,-1)}</code>);else if(t.startsWith('*'))out.push(<em key={k}>{t.slice(1,-1)}</em>);else if(t.startsWith('@'))out.push(<span key={k} className="mention">{t}</span>);
  else{const mm=t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;const href=/^(https?:|mailto:|#)/i.test(mm[2])?mm[2]:'#';out.push(<a key={k} href={href} target={href.startsWith('#')?undefined:'_blank'} rel="noreferrer">{mm[1]}</a>)}
  last=m.index+t.length}
 if(last<text.length)out.push(text.slice(last));return out;
}
export function Markdown({text}:{text:string}){
 const blocks:ReactNode[]=[];const lines=(text||'').replace(/\r/g,'').split('\n');let i=0,k=0;
 while(i<lines.length){const l=lines[i];
  if(!l.trim()){i++;continue}
  if(l.startsWith('```')){const buf:string[]=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))buf.push(lines[i++]);i++;blocks.push(<pre key={k++}><code>{buf.join('\n')}</code></pre>);continue}
  const h=l.match(/^(#{1,3})\s+(.*)/);if(h){const T=(['h2','h3','h4'] as const)[h[1].length-1];blocks.push(<T key={k++}>{inline(h[2],k)}</T>);i++;continue}
  if(/^>\s?/.test(l)){const buf:string[]=[];while(i<lines.length&&/^>\s?/.test(lines[i]))buf.push(lines[i++].replace(/^>\s?/,''));blocks.push(<blockquote key={k++}>{inline(buf.join(' '),k)}</blockquote>);continue}
  if(/^---+$/.test(l.trim())){blocks.push(<hr key={k++}/>);i++;continue}
  if(/^\|.*\|$/.test(l.trim())){const rows:string[][]=[];while(i<lines.length&&/^\|.*\|$/.test(lines[i].trim())){const cells=lines[i].trim().slice(1,-1).split('|').map(c=>c.trim());if(!cells.every(c=>/^:?-+:?$/.test(c)))rows.push(cells);i++}blocks.push(<div key={k++} className="md-table"><table><thead><tr>{rows[0]?.map((c,j)=><th key={j}>{inline(c,j)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r,j)=><tr key={j}>{r.map((c,n)=><td key={n}>{inline(c,n)}</td>)}</tr>)}</tbody></table></div>);continue}
  if(/^\s*([-*]|\d+\.)\s+/.test(l)){const ordered=/^\s*\d+\./.test(l);const items:ReactNode[]=[];while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i])){const t=lines[i].replace(/^\s*([-*]|\d+\.)\s+/,'');const task=t.match(/^\[( |x)\]\s+(.*)/i);items.push(<li key={i} className={task?'task':undefined}>{task&&<input type="checkbox" readOnly checked={task[1].toLowerCase()==='x'}/>}{inline(task?task[2]:t,i)}</li>);i++}blocks.push(ordered?<ol key={k++}>{items}</ol>:<ul key={k++}>{items}</ul>);continue}
  const buf:string[]=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,3}\s|```|>|\s*([-*]|\d+\.)\s|\|)/.test(lines[i]))buf.push(lines[i++]);blocks.push(<p key={k++}>{buf.flatMap((b,j)=>j?[<br key={'b'+j}/>,...inline(b,j)]:inline(b,j))}</p>);
 }
 return <div className="md">{blocks}</div>;
}

// ── Comments thread ─────────────────────────────────────────────────────────
export function Thread({comments,onPost,allowInternal}:{comments:{id:string,authorId:string,body:string,createdAt:string,internal?:number}[],onPost:(body:string,internal:boolean)=>Promise<void>,allowInternal?:boolean}){
 const {person}=useApp();const [body,setBody]=useState(''),[internal,setInternal]=useState(false),[busy,setBusy]=useState(false);
 return <div className="thread">{comments.map(c=>{const p=person(c.authorId);return <div key={c.id} className={cx('comment',!!c.internal&&'internal')}><Avatar name={p?.name} size={28}/><div><div className="comment-meta"><b>{p?.name||'Former member'}</b><span>{new Date(c.createdAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>{!!c.internal&&<Chip tone="amber">Internal note</Chip>}</div><Markdown text={c.body}/></div></div>})}
  {!comments.length&&<p className="muted small">No comments yet. Mention someone with @Name to notify them.</p>}
  <form className="composer" onSubmit={async e=>{e.preventDefault();if(!body.trim())return;setBusy(true);try{await onPost(body,internal);setBody('');setInternal(false)}finally{setBusy(false)}}}><textarea rows={2} value={body} placeholder="Write a comment… use @Name to mention" onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))(e.currentTarget.form as HTMLFormElement).requestSubmit()}}/><div className="composer-bar">{allowInternal&&<label className="check"><input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)}/>Internal note</label>}<span className="muted small">Ctrl + Enter</span><Btn type="submit" variant="primary" size="sm" busy={busy} disabled={!body.trim()}>Comment</Btn></div></form>
 </div>;
}
export function Timeline({events}:{events:{id:string,action:string,actor:string,createdAt:string}[]}){const {person}=useApp();if(!events.length)return <p className="muted small">No activity recorded yet.</p>;return <ol className="timeline">{events.map(e=><li key={e.id}><span className="dot"/><div><b>{e.action}</b><small>{person(e.actor)?.name||'System'} · {new Date(e.createdAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div></li>)}</ol>}

// ── Attachments on a record (ticket, asset, requisition/order, work order, page) ─
export function Attachments({type,id,files,onChange,canUpload=true}:{type:string,id:string,files:{id:string,name:string,mime:string,bytes:number,uploadedBy:string,createdAt:string}[],onChange:()=>void,canUpload?:boolean}){
 const {toast,person}=useApp();const [busy,setBusy]=useState(false);
 async function upload(list:FileList|null){if(!list?.length)return;setBusy(true);let ok=0;for(const file of Array.from(list)){const fd=new FormData();fd.set('file',file);fd.set('entityType',type);fd.set('entityId',id);fd.set('visibility','company');const r=await fetch('/api/files',{method:'POST',body:fd});if(r.ok)ok++;else toast(`${file.name}: ${((await r.json().catch(()=>({}))) as {error?:string}).error||'upload failed'}`,'error')}setBusy(false);if(ok){toast(`${ok} attachment${ok>1?'s':''} added`);onChange()}}
 const size=(n:number)=>n<1048576?`${Math.round(n/1024)} KB`:`${(n/1048576).toFixed(1)} MB`;
 return <div className="attachments">{files.map(f=><div key={f.id} className="attachment">{f.mime.startsWith('image/')?<img alt="" src={`/api/files?preview=${f.id}`}/>:<span className="attachment-icon"><Icon name={f.mime==='application/pdf'?'FileText':'File'} size={18}/></span>}<div><a href={`/api/files?download=${f.id}`}>{f.name}</a><small>{size(f.bytes)} · {person(f.uploadedBy)?.name||'—'}</small></div></div>)}
  {!files.length&&<p className="muted small">No attachments yet.</p>}
  {canUpload&&<label className="btn btn-sm btn-default attach-btn"><Icon name={busy?'Loader':'Paperclip'} size={15}/><span>{busy?'Uploading…':'Attach files'}</span><input type="file" multiple hidden onChange={e=>{upload(e.target.files);e.target.value=''}}/></label>}
 </div>;
}
// ── QR code for asset labels (rendered locally, no external service) ────────
export function QRCode({value,size=132}:{value:string,size?:number}){
 const svg=useMemo(()=>{const qr=qrcode(0,'M');qr.addData(value);qr.make();const n=qr.getModuleCount();let d='';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))d+=`M${c} ${r}h1v1h-1z`;return {n,d}},[value]);
 return <svg className="qr" width={size} height={size} viewBox={`-2 -2 ${svg.n+4} ${svg.n+4}`} role="img" aria-label={`QR code for ${value}`}><rect x="-2" y="-2" width={svg.n+4} height={svg.n+4} fill="#fff"/><path d={svg.d} fill="#000"/></svg>;
}

// Multi-value picker with suggestions (departments, locations, categories…).
export function TagPicker({values,options,onChange,placeholder}:{values:string[],options:string[],onChange:(v:string[])=>void,placeholder:string}){
 const [q,setQ]=useState('');const list=options.filter(o=>!values.includes(o)&&o.toLowerCase().includes(q.toLowerCase())).slice(0,8);
 return <><div className="tag-input">{values.map(v=><span key={v} className="tag">{v}<button type="button" aria-label={`Remove ${v}`} onClick={()=>onChange(values.filter(x=>x!==v))}><Icon name="X" size={12}/></button></span>)}<input value={q} onChange={e=>setQ(e.target.value)} placeholder={values.length?'Add more…':placeholder} onKeyDown={e=>{if(e.key==='Enter'&&q.trim()){e.preventDefault();onChange([...values,list[0]||q.trim()]);setQ('')}}}/></div>{q&&list.length>0&&<div className="tag-suggest">{list.map(o=><button type="button" key={o} onClick={()=>{onChange([...values,o]);setQ('')}}>{o}</button>)}</div>}</>;
}