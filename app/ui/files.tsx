'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {api,useApi,go,ago,bytes,dateTime,cx,pref,setPref,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Inspector,Modal,Field,ErrorNote,Skeleton,Empty,KV,Icon,Note,Menu,Tabs,Markdown,AudiencePicker,TagPicker} from './kit';
import {ConnectedContext} from './context';
import {AiActions} from './assistant';

// Files: folders, audiences, versions, recycle bin, processing results (text, transcripts, captions, summaries),
// links to other records, favorites and access history. Everything shown here was checked by the server.
type Acl={mode:string,departments?:string[],people?:string[],roles?:string[],groups?:string[],locations?:string[],projectId?:string|null,spaceId?:string|null,editors?:string[]};
type Folder={id:string,parent_id:string|null,name:string,department:string,visibility:string,created_by:string,space_id?:string|null};
const THUMB=new RegExp('^image/(png|jpe?g|gif|webp)$');
type FileItem={archived_at?:string|null,id:string,folder_id:string|null,name:string,mime:string,bytes:number,department:string,tags:string,description:string,category?:string,version:number,uploaded_by:string,owner_id?:string|null,created_at:string,updated_at:string,deleted_at?:string|null,pinned?:number,legal_hold?:number,processing_status?:string,processing_error?:string,acl:Acl,pendingAcl?:Acl|null,favorite?:boolean,space_id?:string|null};
type Data={folders:Folder[],files:FileItem[],canUpload:boolean,defaultAcl?:Acl};
const cache:{data:Data|null,subs:Set<()=>void>,loading:boolean}={data:null,subs:new Set(),loading:false};
async function refreshFiles(){cache.loading=true;try{cache.data=await api<Data>('/api/files')}finally{cache.loading=false;cache.subs.forEach(f=>f())}}
export function useFolders(){const [,tick]=useState(0);useEffect(()=>{const f=()=>tick(x=>x+1);cache.subs.add(f);if(!cache.data&&!cache.loading)refreshFiles().catch(()=>{});return()=>{cache.subs.delete(f)}},[]);return {data:cache.data,reload:refreshFiles}}
export const fileIcon=(m:string)=>m.startsWith('image/')?'FileImage':m==='application/pdf'?'FileText':/sheet|excel|csv/.test(m)?'FileSpreadsheet':/word/.test(m)?'FileType':/presentation|powerpoint/.test(m)?'Presentation':/zip/.test(m)?'FileArchive':m.startsWith('video/')?'FileVideo':m.startsWith('audio/')?'FileAudio':'File';
const audienceShort=(a:Acl)=>({private:'Only me',department:`Dept: ${a.departments?.[0]||''}`,departments:`${a.departments?.length||0} departments`,people:`${a.people?.length||0} people`,roles:`${a.roles?.length||0} roles`,groups:`${a.groups?.length||0} groups`,locations:`${a.locations?.length||0} locations`,project:'Project team',space:'Space members',company:'Everyone'} as Record<string,string>)[a.mode]||a.mode;
const statusTone=(s?:string)=>s==='ready'?'green':s==='failed'?'red':['partial','unsupported'].includes(s||'')?'amber':s==='none'?'gray':'blue';
const statusLabel:Record<string,string>={none:'Stored',queued:'Queued',scanning:'Scanning',extracting:'Extracting',transcribing:'Transcribing',summarizing:'Summarizing',ready:'Ready',partial:'Partially processed',failed:'Failed',retrying:'Retrying',unsupported:'Not processed'};
const views:[string,string,string][]=[['root','All files','HardDrive'],['recent','Recent','Clock'],['mine','My uploads','User'],['shared','Shared with me','Users'],['favorites','Favorites','Bookmark'],['department','Department files','Building2'],['project','Project files','FolderKanban'],['company','Company files','Globe'],['archived','Archived','Archive'],['recycle','Recycle bin','Trash2']];
const allCols=[['name','Name'],['audience','Who can see'],['status','Processing'],['size','Size'],['owner','Owner'],['updated','Updated'],['category','Category'],['tags','Tags']] as const;

export default function Files({parts}:{parts:string[]}){
 const {s,person,toast,ask}=useApp();const place=parts[0]||'root';const isView=views.some(v=>v[0]===place)&&place!=='root';
 const openId=parts[1]&&parts[1]!=='upload'?parts[1]:undefined,upload=parts[1]==='upload';
 const listUrl=place==='storage'?null:`/api/files?view=${isView?place:'all'}`;
 const {data,error,reload}=useApi<Data>(listUrl);const {reload:reloadRail}=useFolders();
 const [q,setQ]=useState(''),[sel,setSel]=useState<string[]>([]),[cols,setCols]=useState<string[]>(()=>pref('file-cols',['name','audience','status','size','owner','updated'])),[drop,setDrop]=useState<File[]|null>(null),[dragging,setDragging]=useState(false),[sort,setSort]=useState<[string,1|-1]>(['updated',-1]);
 useEffect(()=>{setPref('file-cols',cols)},[cols]);useEffect(()=>setSel([]),[place]);
 const refresh=useCallback(()=>{reload();reloadRail()},[reload,reloadRail]);
 // Refresh while anything is still processing.
 useEffect(()=>{if(!data?.files.some(f=>['queued','scanning','extracting','transcribing','summarizing','retrying'].includes(f.processing_status||'')))return;const t=setInterval(reload,5000);return()=>clearInterval(t)},[data,reload]);
 if(place==='storage')return <Storage/>;
 const folder=!isView&&place!=='root'?data?.folders.find(f=>f.id===place):null;
 const subfolders=!isView?(data?.folders||[]).filter(f=>(f.parent_id||'root')===(folder?.id||'root')):[];
 let files=(data?.files||[]).filter(f=>isView||((f.folder_id||'root')===(folder?.id||'root')));
 if(q){const t=q.toLowerCase();files=(data?.files||[]).filter(f=>f.name.toLowerCase().includes(t)||f.tags.toLowerCase().includes(t)||(f.description||'').toLowerCase().includes(t))}
 const key=(f:FileItem)=>sort[0]==='name'?f.name.toLowerCase():sort[0]==='size'?String(f.bytes).padStart(15,'0'):sort[0]==='owner'?person(f.owner_id||f.uploaded_by)?.name||'':f.updated_at;
 files=[...files].sort((a,b)=>(b.pinned||0)-(a.pinned||0)||(key(a)>key(b)?1:-1)*sort[1]);
 const title=folder?.name||views.find(v=>v[0]===place)?.[1]||'All files';
 const bulk=async(op:string,extra:Record<string,unknown>={})=>{const r=await api<{results:{id:string,ok:boolean,error?:string,url?:string}[]}>('/api/files',{action:'bulk',op,ids:sel,...extra});const bad=r.results.filter(x=>!x.ok);toast(bad.length?`${r.results.length-bad.length} done, ${bad.length} failed: ${bad[0].error}`:'Done',bad.length?'error':'ok');if(op==='links')r.results.filter(x=>x.url).forEach((x,i)=>setTimeout(()=>{const a=document.createElement('a');a.href=x.url!;a.download='';document.body.appendChild(a);a.click();a.remove()},i*400));setSel([]);refresh()};
 const crumbs:Folder[]=[];for(let f=folder;f;f=data?.folders.find(x=>x.id===f!.parent_id))crumbs.unshift(f);
 return <div className={cx('page',dragging&&'drop-active')} onDragOver={e=>{if(data?.canUpload&&place!=='recycle'){e.preventDefault();setDragging(true)}}} onDragLeave={e=>{if(e.currentTarget===e.target)setDragging(false)}} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length)setDrop([...e.dataTransfer.files])}}>
  <Header icon={place==='recycle'?'Trash2':'FolderClosed'} tone="amber" title={title} subtitle={place==='recycle'?'Deleted files stay here until an administrator removes them permanently or the retention period ends.':'Drop files anywhere on this page to upload. New files are shared with your department unless you choose otherwise.'} actions={place!=='recycle'&&data?.canUpload&&<><Btn icon="FolderPlus" onClick={async()=>{const name=await ask({title:'New folder',confirm:'Create',input:{label:'Folder name',required:true}});if(name===false)return;try{await api('/api/files',{action:'folder',name,parentId:folder?.id||null});toast('Folder created');refresh()}catch(e){toast((e as Error).message,'error')}}}>New folder</Btn><Btn variant="primary" icon="Upload" onClick={()=>go(`files/${place}/upload`)}>Upload</Btn></>}/>
  {!isView&&crumbs.length>0&&<nav className="crumbs-row" aria-label="Folder path"><a href="#/files/root">All files</a>{crumbs.map(c=><span key={c.id}> › <a href={`#/files/${c.id}`}>{c.name}</a></span>)}</nav>}
  <ErrorNote error={error} onRetry={reload}/>
  <div className="file-toolbar">
   <input className="grid-search" aria-label="Search files" placeholder="Search files, tags and descriptions…" value={q} onChange={e=>setQ(e.target.value)}/>
   <select aria-label="Sort" value={sort.join(':')} onChange={e=>{const [k,d]=e.target.value.split(':');setSort([k,Number(d) as 1|-1])}}><option value="updated:-1">Newest first</option><option value="name:1">Name A–Z</option><option value="size:-1">Largest first</option><option value="owner:1">Owner</option></select>
   <Menu trigger={o=><Btn icon="Columns3" title="Columns" onClick={o}/>} items={allCols.map(([k,l])=>({label:`${cols.includes(k)?'✓ ':''}${l}`,onClick:()=>setCols(c=>c.includes(k)?c.filter(x=>x!==k||k==='name'):[...c,k])}))}/>
   <Btn icon="Download" title="Export list" onClick={()=>downloadCsv('files',[['Name','Audience','Size','Owner','Updated','Status','Tags'],...files.map(f=>[f.name,audienceShort(f.acl),f.bytes,person(f.owner_id||f.uploaded_by)?.name||'',f.updated_at,f.processing_status||'',f.tags])])}/>
   {sel.length>0&&<div className="bulk-bar"><b>{sel.length} selected</b>{place==='recycle'?<Btn size="sm" icon="RotateCcw" onClick={()=>bulk('restore')}>Restore</Btn>:<><Btn size="sm" icon="Download" onClick={()=>bulk('links')}>Download</Btn><Btn size="sm" icon="FolderOpen" onClick={async()=>{const to=await ask({title:'Move to folder',confirm:'Move',input:{label:'Folder name (empty for top level)'}});if(to===false)return;const f=data?.folders.find(x=>x.name.toLowerCase()===to.trim().toLowerCase());if(to.trim()&&!f){toast('Folder not found','error');return}bulk('move',{folderId:f?.id||null})}}>Move</Btn><BulkAccess ids={sel} onDone={()=>{setSel([]);refresh()}}/>{place==='archived'?<Btn size="sm" icon="ArchiveRestore" onClick={()=>bulk('unarchive')}>Unarchive</Btn>:<Btn size="sm" icon="Archive" onClick={()=>bulk('archive')}>Archive</Btn>}<Btn size="sm" variant="danger" icon="Trash2" onClick={async()=>{if(await ask({title:`Move ${sel.length} files to the recycle bin?`,confirm:'Delete',danger:true})!==false)bulk('delete')}}>Delete</Btn></>}<Btn size="sm" variant="ghost" onClick={()=>setSel([])}>Clear</Btn></div>}
  </div>
  {!data?<Skeleton/>:<div className="file-table-wrap"><table className="plain file-table">
   <thead><tr><th className="check-col"><input type="checkbox" aria-label="Select all" checked={!!files.length&&sel.length===files.length} onChange={e=>setSel(e.target.checked?files.map(f=>f.id):[])}/></th>{allCols.filter(([k])=>cols.includes(k)).map(([k,l])=><th key={k}>{l}</th>)}</tr></thead>
   <tbody>
    {!q&&subfolders.map(f=><tr key={f.id} className="clickable" onClick={()=>go(`files/${f.id}`)}><td/><td colSpan={cols.length}><span className="file-name"><Icon name="Folder" size={17}/><b>{f.name}</b></span></td></tr>)}
    {files.map(f=><tr key={f.id} className={cx('clickable',sel.includes(f.id)&&'selected')} onClick={()=>go(`files/${place}/${f.id}`)}>
     <td className="check-col" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`Select ${f.name}`} checked={sel.includes(f.id)} onChange={e=>setSel(e.target.checked?[...sel,f.id]:sel.filter(x=>x!==f.id))}/></td>
     {cols.includes('name')&&<td><span className="file-name">{THUMB.test(f.mime)?<img className="file-thumb" src={`/api/files?preview=${f.id}`} alt="" loading="lazy" width={28} height={28}/>:<Icon name={fileIcon(f.mime)} size={17}/>}<span><b>{f.name}</b>{f.pinned?<Icon name="Pin" size={12}/>:null}{f.favorite&&<Icon name="Bookmark" size={12}/>}{f.legal_hold?<Chip tone="violet">Legal hold</Chip>:null}{f.pendingAcl&&<Chip tone="amber">Awaiting approval</Chip>}</span></span></td>}
     {cols.includes('audience')&&<td><Chip tone={f.acl.mode==='company'?'green':f.acl.mode==='private'?'gray':'blue'}>{audienceShort(f.acl)}</Chip></td>}
     {cols.includes('status')&&<td><Chip tone={statusTone(f.processing_status)}>{statusLabel[f.processing_status||'none']||f.processing_status}</Chip></td>}
     {cols.includes('size')&&<td className="muted">{bytes(f.bytes)}</td>}
     {cols.includes('owner')&&<td className="muted">{person(f.owner_id||f.uploaded_by)?.name||'—'}</td>}
     {cols.includes('updated')&&<td className="muted">{place==='recycle'?`deleted ${ago(f.deleted_at)}`:ago(f.updated_at)}</td>}
     {cols.includes('category')&&<td>{f.category}</td>}
     {cols.includes('tags')&&<td className="small muted">{f.tags}</td>}
    </tr>)}
   </tbody></table>
   {!files.length&&!subfolders.length&&<Empty icon={place==='recycle'?'Trash2':'FolderOpen'} title={place==='recycle'?'The recycle bin is empty':'No files here'}>{place==='recycle'?'':data.canUpload?'Drop files here or use Upload.':''}</Empty>}
  </div>}
  {(upload||drop)&&<UploadDialog initial={drop||[]} folderId={folder?.id||null} defaultAcl={data?.defaultAcl||{mode:'department',departments:[s.user.department]}} onClose={()=>{setDrop(null);if(upload)go(`files/${place}`)}} onDone={()=>{setDrop(null);refresh();if(upload)go(`files/${place}`)}}/>}
  {openId&&<FilePanel id={openId} onClose={()=>go(`files/${place}`)} onChanged={refresh}/>}
 </div>;
}
function BulkAccess({ids,onDone}:{ids:string[],onDone:()=>void}){
 const {s,toast}=useApp();const [open,setOpen]=useState(false),[acl,setAcl]=useState<Acl>({mode:'department',departments:[s.user.department]});
 return <><Btn size="sm" icon="Users" onClick={()=>setOpen(true)}>Change access</Btn>{open&&<Modal open onClose={()=>setOpen(false)} title={`Change who can see ${ids.length} files`} footer={<><Btn variant="ghost" onClick={()=>setOpen(false)}>Cancel</Btn><Btn variant="primary" onClick={async()=>{const r=await api<{results:{ok:boolean,error?:string}[]}>('/api/files',{action:'bulk',op:'access',ids,acl});const bad=r.results.filter(x=>!x.ok);toast(bad.length?`${bad.length} could not be changed: ${bad[0].error}`:'Access updated',bad.length?'error':'ok');setOpen(false);onDone()}}>Apply</Btn></>}><AudiencePicker value={acl} onChange={setAcl}/></Modal>}</>;
}

// ── Upload: multi-file, drag and drop, progress, resumable for large files ──
type Up={file:File,progress:number,status:'waiting'|'uploading'|'done'|'error',error?:string,resumable:boolean};
const SIMPLE=25*1024*1024;
function xhrUpload(fd:FormData,onProgress:(p:number)=>void){return new Promise<any>((resolve,reject)=>{const x=new XMLHttpRequest();x.open('POST','/api/files');x.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};x.onload=()=>{let d:any={};try{d=JSON.parse(x.responseText)}catch{}if(x.status>=200&&x.status<300)resolve(d);else reject(new Error(d.error||'Upload failed'))};x.onerror=()=>reject(new Error('Network error. Check your connection and retry.'));x.send(fd)})}
async function resumableUpload(file:File,meta:Record<string,unknown>,onProgress:(p:number)=>void){
 // The upload id is remembered per file, so a failed or interrupted upload continues where it stopped.
 const k=`ows-upload:${file.name}:${file.size}:${file.lastModified}`;let uploadId=localStorage.getItem(k)||'';let partSize=8*1024*1024;let done=new Set<number>();
 if(uploadId){try{const st=await api<{parts:number[]}>('/api/files',{action:'upload-status',uploadId});done=new Set(st.parts)}catch{uploadId=''}}
 if(!uploadId){const init=await api<{uploadId:string,partSize:number}>('/api/files',{action:'upload-init',name:file.name,size:file.size,...meta});uploadId=init.uploadId;partSize=init.partSize;try{localStorage.setItem(k,uploadId)}catch{}}
 const parts=Math.ceil(file.size/partSize);
 for(let n=1;n<=parts;n++){if(done.has(n)){onProgress(n/parts);continue}const chunk=file.slice((n-1)*partSize,n*partSize);
  for(let attempt=0;;attempt++){const r=await fetch(`/api/files?upload=${uploadId}&part=${n}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:chunk});if(r.ok)break;if(attempt>=3)throw new Error((await r.json().catch(()=>({})) as {error?:string}).error||'Upload failed');await new Promise(x=>setTimeout(x,1000*(attempt+1)))}
  onProgress(n/parts)}
 const r=await api<{id:string}>('/api/files',{action:'upload-complete',uploadId});try{localStorage.removeItem(k)}catch{}return r;
}
function UploadDialog({initial,folderId,defaultAcl,onClose,onDone,spaceId,links}:{initial:File[],folderId:string|null,defaultAcl:Acl,onClose:()=>void,onDone:(ids:string[])=>void,spaceId?:string,links?:{type:string,id:string}[]}){
 const {s,toast}=useApp();const [items,setItems]=useState<Up[]>(initial.map(f=>({file:f,progress:0,status:'waiting',resumable:f.size>SIMPLE})));
 const [acl,setAcl]=useState<Acl>(defaultAcl);const [tags,setTags]=useState(''),[description,setDescription]=useState(''),[busy,setBusy]=useState(false);const inputRef=useRef<HTMLInputElement>(null);
 const {data:projects}=useApi<{projects:{id:string,name:string,code:string}[]}>(s.tenant.pages?.includes('projects')?'/api/projects':null);
 const {data:spaces}=useApi<{spaces:{id:string,name:string,isMember:boolean}[]}>('/api/spaces');
 const add=(fs:FileList|File[])=>setItems(x=>[...x,...[...fs].map(f=>({file:f,progress:0,status:'waiting' as const,resumable:f.size>SIMPLE}))]);
 async function start(){setBusy(true);const ids:string[]=[];let pending=0;
  for(let i=0;i<items.length;i++){const it=items[i];if(it.status==='done')continue;const set=(p:Partial<Up>)=>setItems(x=>x.map((y,j)=>j===i?{...y,...p}:y));set({status:'uploading',error:undefined});
   try{let r:any;if(it.resumable)r=await resumableUpload(it.file,{acl,folderId,spaceId,tags,description,links},p=>set({progress:p}));else{const fd=new FormData();fd.set('file',it.file);if(folderId)fd.set('folderId',folderId);if(spaceId)fd.set('spaceId',spaceId);fd.set('acl',JSON.stringify(acl));fd.set('tags',tags);fd.set('description',description);if(links)fd.set('links',JSON.stringify(links));r=await xhrUpload(fd,p=>set({progress:p}))}
    if(r.pendingApproval)pending++;ids.push(r.id);set({status:'done',progress:1})}catch(e){set({status:'error',error:(e as Error).message})}}
  setBusy(false);if(pending)toast(`${pending} file(s) are shared with your department until an administrator approves company-wide sharing.`,'info');
  if(ids.length){toast(`${ids.length} file${ids.length===1?'':'s'} uploaded. Processing continues in the background.`);onDone(ids)}}
 return <Modal open wide onClose={busy?()=>{}:onClose} title="Upload files" subtitle="Files are checked, then text, transcripts and summaries are prepared in the background." footer={<><Btn variant="ghost" disabled={busy} onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="Upload" busy={busy} disabled={!items.some(i=>i.status!=='done')} onClick={start}>Upload {items.filter(i=>i.status!=='done').length||''}</Btn></>}>
  <div className="upload-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files)}} onClick={()=>inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')inputRef.current?.click()}}><Icon name="CloudUpload" size={26}/><p><b>Drop files here</b> or click to choose. Large files (over 25 MB) upload in resumable parts.</p><input ref={inputRef} type="file" multiple hidden onChange={e=>{if(e.target.files)add(e.target.files);e.target.value=''}}/></div>
  {items.length>0&&<ul className="upload-list">{items.map((it,i)=><li key={i}><Icon name={fileIcon(it.file.type)} size={16}/><span className="grow"><b>{it.file.name}</b><small className="muted"> {bytes(it.file.size)}{it.resumable?' · resumable':''}</small>{it.error&&<small className="error-text"> {it.error}</small>}<span className="progress"><i style={{width:`${Math.round(it.progress*100)}%`}}/></span></span><Chip tone={it.status==='done'?'green':it.status==='error'?'red':it.status==='uploading'?'blue':'gray'}>{it.status==='uploading'?`${Math.round(it.progress*100)}%`:it.status}</Chip>{!busy&&it.status!=='done'&&<Btn size="sm" variant="ghost" icon="X" title="Remove" onClick={()=>setItems(x=>x.filter((_,j)=>j!==i))}/>}</li>)}</ul>}
  <div className="form-grid">
   <div className="wide"><AudiencePicker value={acl} onChange={setAcl} projects={(projects?.projects||[]).map(p=>({id:p.id,name:`${p.code} · ${p.name}`}))} spaces={(spaces?.spaces||[]).filter(x=>x.isMember).map(x=>({id:x.id,name:x.name}))} note={acl.mode==='company'&&s.tenant.settings.companyWidePublishing==='admins'&&s.user.role!=='admin'?<Note tone="warn">Company-wide sharing needs an administrator’s approval. Until then the files are shared with your department.</Note>:undefined}/></div>
   <Field label="Tags"><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="e.g. policy, 2026"/></Field>
   <Field label="Description"><input value={description} onChange={e=>setDescription(e.target.value)}/></Field>
  </div>
 </Modal>;
}
export {UploadDialog};

// ── File panel ──
type Detail={file:FileItem,versions:{version:number,bytes:number,uploadedBy:string,createdAt:string}[],links:{entityType:string,entityId:string}[],artifacts:{kind:string,createdAt:string,version:number}[],job:{status:string,stage:string,attempts:number,error:string,id:string}|null,favorite:boolean,events:{action:string,createdAt:string,ip:string,who:string}[],history:{action:string,createdAt:string,who:string}[],canEdit:boolean,canDownload:boolean,isAdmin:boolean};
function FilePanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {toast,ask,person,s}=useApp();const {data,error,reload}=useApi<Detail>(`/api/files?id=${encodeURIComponent(id)}`);const [tab,setTab]=useState('preview');const replaceRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!data||!['queued','scanning','extracting','transcribing','summarizing','retrying'].includes(data.file.processing_status||''))return;const t=setInterval(reload,4000);return()=>clearInterval(t)},[data,reload]);
 const act=async(body:Record<string,unknown>,msg:string)=>{try{const r=await api<any>('/api/files',{id,...body});toast(msg);reload();onChanged();return r}catch(e){toast((e as Error).message,'error')}};
 const download=async(inline=false)=>{const r=await act({action:'link-url',inline},'Download ready');if(r?.url){if(inline)window.open(r.url,'_blank','noopener');else{const a=document.createElement('a');a.href=r.url;a.download='';document.body.appendChild(a);a.click();a.remove()}}};
 if(error)return <Inspector open onClose={onClose} title="File"><ErrorNote error={error}/></Inspector>;
 if(!data)return <Inspector open onClose={onClose} title="Loading…"><Skeleton rows={6}/></Inspector>;
 const f=data.file;const deleted=!!f.deleted_at;const pre=`/api/files?preview=${f.id}`;
 return <Inspector open onClose={onClose} width={720} eyebrow={audienceShort(f.acl)} title={f.name} subtitle={<><Chip tone={statusTone(f.processing_status)}>{statusLabel[f.processing_status||'none']}</Chip><span className="muted small">v{f.version} · {bytes(f.bytes)} · {person(f.owner_id||f.uploaded_by)?.name||'—'} · {ago(f.updated_at)}</span></>} actions={<>
  {!deleted&&<AiActions entity="file" entityId={f.id} onApply={{'tasks.create':async(d:{tasks:{title:string,description?:string,dueDate?:string}[]})=>{for(const t of (d.tasks||[]).slice(0,30))await api('/api/tasks',{action:'save',title:t.title,description:t.description||'',dueDate:/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate||'')?t.dueDate:null,sourceType:'file',sourceId:f.id});toast('Draft tasks created')}}}/>}
  {!deleted&&data.canDownload&&<Btn size="sm" icon="Download" onClick={()=>download()}>Download</Btn>}
  <Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={deleted?[{label:'Restore',icon:'RotateCcw',onClick:()=>act({action:'restore'},'Restored')},{label:'Delete permanently',icon:'Trash2',danger:true,hidden:!data.isAdmin,onClick:async()=>{const v=await ask({title:'Delete permanently?',body:<>This removes every version and generated content. Type <b>{f.name}</b> to confirm.</>,confirm:'Delete permanently',danger:true,input:{label:'File name',required:true}});if(v!==false){await act({action:'purge',confirm:v},'Permanently deleted');onClose()}}}]:[
   {label:data.favorite?'Remove from favorites':'Add to favorites',icon:'Bookmark',onClick:()=>act({action:'favorite',on:!data.favorite},data.favorite?'Removed from favorites':'Added to favorites')},
   {label:'Upload new version',icon:'Upload',hidden:!data.canEdit,onClick:()=>replaceRef.current?.click()},
   {label:'Rename',icon:'Pencil',hidden:!data.canEdit,onClick:async()=>{const n=await ask({title:'Rename',confirm:'Rename',input:{label:'Name',required:true}});if(n!==false)act({action:'update',name:n},'Renamed')}},
   {label:'Make a copy',icon:'Copy',hidden:!data.canEdit,onClick:()=>act({action:'copy'},'Copied')},
   {label:f.archived_at?'Unarchive':'Archive',icon:'Archive',hidden:!data.canEdit||deleted,onClick:()=>act({action:f.archived_at?'unarchive':'archive'},f.archived_at?'Unarchived':'Archived')},
   {label:f.pinned?'Unpin':'Pin',icon:'Pin',hidden:!data.canEdit,onClick:()=>act({action:'pin',on:!f.pinned},f.pinned?'Unpinned':'Pinned')},
   {label:'Process again',icon:'RefreshCw',hidden:!data.canEdit,onClick:()=>act({action:'reprocess'},'Queued for processing')},
   {label:f.legal_hold?'Release legal hold':'Place legal hold',icon:'Lock',hidden:!data.isAdmin||!s.tenant.settings.legalHoldEnabled,onClick:async()=>{const r=f.legal_hold?'':await ask({title:'Place legal hold',body:'Items on legal hold cannot be deleted.',confirm:'Place hold',input:{label:'Reason',required:true}});if(r!==false)act({action:'legal-hold',on:!f.legal_hold,reason:r},f.legal_hold?'Hold released':'Legal hold placed')}},
   '-',{label:'Move to recycle bin',icon:'Trash2',danger:true,hidden:!data.canEdit,onClick:async()=>{if(await ask({title:`Delete “${f.name}”?`,body:'It moves to the recycle bin and can be restored.',confirm:'Delete',danger:true})!==false){await act({action:'delete'},'Moved to the recycle bin');onClose()}}}]}/>
  <input ref={replaceRef} type="file" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;const fd=new FormData();fd.set('file',file);fd.set('replaceId',f.id);try{await xhrUpload(fd,()=>{});toast('New version uploaded');reload();onChanged()}catch(err){toast((err as Error).message,'error')}}}/>
 </>}>
  {f.pendingAcl&&<Note tone="warn">Company-wide sharing was requested and is waiting for an administrator.{data.isAdmin&&<span className="row-gap"><Btn size="sm" variant="primary" onClick={()=>act({action:'approve-access'},'Approved')}>Approve</Btn><Btn size="sm" onClick={()=>act({action:'reject-access'},'Declined')}>Decline</Btn></span>}</Note>}
  {f.processing_status==='failed'&&<Note tone="warn">{f.processing_error||'Processing failed.'}</Note>}
  <Tabs value={tab} onChange={setTab} items={[{id:'preview',label:'Preview'},{id:'processing',label:'Summary & text'},{id:'details',label:'Details'},{id:'access',label:'Access'},{id:'versions',label:`Versions (${data.versions.length+1})`},{id:'links',label:'Links'},{id:'connected',label:'Connected'},...(data.canEdit?[{id:'activity',label:'Activity'}]:[])]}/>
  {tab==='preview'&&(deleted?<Note>Restore the file to preview it.</Note>:f.mime.startsWith('image/')?<img className="file-preview-img" src={pre} alt={f.name}/>:f.mime.startsWith('video/')?<video className="file-preview-media" controls src={pre}><track kind="captions" src={`/api/files?artifact=${f.id}&kind=vtt&download`} default/></video>:f.mime.startsWith('audio/')?<audio className="file-preview-media" controls src={pre}/>:f.mime==='application/pdf'?<iframe title={f.name} className="file-preview-pdf" src={pre} sandbox=""/>:<Empty icon={fileIcon(f.mime)} title="No preview for this type">Open the Summary & text tab, or download the file.</Empty>)}
  {tab==='processing'&&<Processing f={f} artifacts={data.artifacts} job={data.job} canEdit={data.canEdit} canDownload={data.canDownload}/>}
  {tab==='details'&&<DetailsForm f={f} canEdit={data.canEdit} onSave={v=>act({action:'update',...v},'Saved')}/>}
  {tab==='access'&&<AccessTab f={f} canEdit={data.canEdit} isAdmin={data.isAdmin} act={act}/>}
  {tab==='versions'&&<table className="plain"><thead><tr><th>Version</th><th>Size</th><th>By</th><th>When</th><th/></tr></thead><tbody><tr><td>v{f.version} <Chip tone="green">current</Chip></td><td>{bytes(f.bytes)}</td><td>{person(f.uploaded_by)?.name}</td><td className="muted">{dateTime(f.updated_at)}</td><td/></tr>{data.versions.map(v=><tr key={v.version}><td>v{v.version}</td><td>{bytes(v.bytes)}</td><td>{person(v.uploadedBy)?.name}</td><td className="muted">{dateTime(v.createdAt)}</td><td className="row-gap">{data.canDownload&&<a className="btn btn-sm" href={`/api/files?download=${f.id}&v=${v.version}`}>Download</a>}{data.canEdit&&<Btn size="sm" onClick={async()=>{if(await ask({title:`Restore version ${v.version}?`,body:'It becomes the newest version; nothing is lost.',confirm:'Restore'})!==false)act({action:'restore-version',version:v.version},`Version ${v.version} restored`)}}>Restore</Btn>}</td></tr>)}</tbody></table>}
  {tab==='connected'&&<ConnectedContext type="file" id={f.id} compact/>}
  {tab==='links'&&<LinksTab f={f} links={data.links} canEdit={data.canEdit} act={act}/>}
  {tab==='activity'&&<><h4>Who viewed, downloaded or changed it</h4><table className="plain"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>IP</th></tr></thead><tbody>{data.events.map((e,i)=><tr key={i}><td className="muted">{dateTime(e.createdAt)}</td><td>{e.who}</td><td>{e.action}</td><td className="mono small">{e.ip}</td></tr>)}</tbody></table><h4>Change history</h4><div className="mini-list">{data.history.map((h,i)=><div key={i} className="mini-row"><Icon name="History" size={14}/><span>{h.action}<small>{h.who} · {dateTime(h.createdAt)}</small></span></div>)}</div></>}
 </Inspector>;
}
function Processing({f,artifacts,job,canEdit,canDownload}:{f:FileItem,artifacts:{kind:string}[],job:Detail['job'],canEdit:boolean,canDownload:boolean}){
 const {toast}=useApp();const has=(k:string)=>artifacts.some(a=>a.kind===k);
 const sum=useApi<{content:string}>(has('summary')?`/api/files?artifact=${f.id}&kind=summary`:null);
 const tr=useApi<{content:string,meta:{language?:string,note?:string}}>(has('transcript_edit')?`/api/files?artifact=${f.id}&kind=transcript_edit`:has('transcript')?`/api/files?artifact=${f.id}&kind=transcript`:null);
 const text=useApi<{content:string,meta:{method?:string}}>(!has('transcript')&&has('text')?`/api/files?artifact=${f.id}&kind=text`:null);
 const [editing,setEditing]=useState<{start:number,end:number,text:string,speaker?:string}[]|null>(null);
 const summary=useMemo(()=>{try{return JSON.parse(sum.data?.content||'null')}catch{return null}},[sum.data]);
 const segs=useMemo(()=>{try{return JSON.parse(tr.data?.content||'[]') as {start:number,end:number,text:string,speaker?:string}[]}catch{return []}},[tr.data]);
 const mm=(s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 return <div className="processing">
  <div className="row-gap"><Chip tone={statusTone(f.processing_status)}>{statusLabel[f.processing_status||'none']}</Chip>{job&&job.status!=='done'&&<span className="muted small">Background job: {job.status}{job.stage?` · ${job.stage}`:''}{job.attempts?` · attempt ${job.attempts}`:''}</span>}{f.processing_error&&<span className="muted small">{f.processing_error}</span>}</div>
  {!artifacts.length&&!['queued','scanning','extracting','transcribing','summarizing','retrying'].includes(f.processing_status||'')&&<Empty icon="Sparkles" title="Nothing generated">{f.processing_error||'This file has not been processed.'}</Empty>}
  {summary&&<section><h4>Summary</h4><p>{summary.short}</p>{summary.detailed&&<details open><summary>Detailed notes</summary><Markdown text={String(summary.detailed)}/></details>}
   {!!summary.keyPoints?.length&&<><h5>Key points</h5><ul>{summary.keyPoints.map((k:any,i:number)=><li key={i}>{typeof k==='string'?k:k.text}{k.ref&&<Chip tone="gray">{k.ref}</Chip>}</li>)}</ul></>}
   {!!summary.decisions?.length&&<><h5>Decisions</h5><ul>{summary.decisions.map((k:string,i:number)=><li key={i}>{k}</li>)}</ul></>}
   {!!summary.actionItems?.length&&<><h5>Action items</h5><ul>{summary.actionItems.map((k:any,i:number)=><li key={i}>{k.text}{k.owner&&<small className="muted"> · {k.owner}</small>}{k.due&&<small className="muted"> · {k.due}</small>}{k.ref&&<Chip tone="gray">{k.ref}</Chip>}</li>)}</ul></>}
   {!!summary.questions?.length&&<><h5>Open questions</h5><ul>{summary.questions.map((k:string,i:number)=><li key={i}>{k}</li>)}</ul></>}
   {!!summary.chapters?.length&&<><h5>Chapters</h5><ul>{summary.chapters.map((k:any,i:number)=><li key={i}><Chip tone="gray">{k.start}</Chip> {k.title}</li>)}</ul></>}
   {!!summary.dates?.length&&<><h5>Important dates</h5><ul>{summary.dates.map((k:any,i:number)=><li key={i}><b>{k.date}</b> {k.what}{k.ref&&<Chip tone="gray">{k.ref}</Chip>}</li>)}</ul></>}
   {summary.classification&&<p className="muted small">Classification: {summary.classification}{summary.tags?.length?` · suggested tags: ${summary.tags.join(', ')}`:''}</p>}
  </section>}
  {has('transcript')&&<section><div className="between"><h4>Transcript{tr.data?.meta?.language?` (${tr.data.meta.language})`:''}{has('transcript_edit')&&<Chip tone="blue">edited</Chip>}</h4><div className="row-gap">{canDownload&&<><a className="btn btn-sm" href={`/api/files?artifact=${f.id}&kind=vtt&download`}>VTT</a><a className="btn btn-sm" href={`/api/files?artifact=${f.id}&kind=srt&download`}>SRT</a></>}{canEdit&&!editing&&<Btn size="sm" icon="Pencil" onClick={()=>setEditing(segs.map(s=>({...s})))}>Correct transcript</Btn>}</div></div>
   {tr.data?.meta?.note&&<p className="muted small">{tr.data.meta.note}</p>}
   {editing?<><div className="transcript-edit">{editing.map((sg,i)=><div key={i} className="row-gap"><span className="mono small">{mm(sg.start)}</span><input className="speaker-in" placeholder="Speaker" value={sg.speaker||''} onChange={e=>setEditing(editing.map((x,j)=>j===i?{...x,speaker:e.target.value}:x))}/><input className="grow" value={sg.text} onChange={e=>setEditing(editing.map((x,j)=>j===i?{...x,text:e.target.value}:x))}/></div>)}</div><div className="row-gap"><Btn variant="primary" onClick={async()=>{try{await api('/api/files',{action:'transcript-edit',id:f.id,segments:editing});toast('Transcript saved. The original machine transcript is kept.');setEditing(null);tr.reload()}catch(e){toast((e as Error).message,'error')}}}>Save corrections</Btn><Btn variant="ghost" onClick={()=>setEditing(null)}>Cancel</Btn></div></>:
   <div className="transcript">{segs.map((sg,i)=><p key={i}><span className="mono small muted">{mm(sg.start)}</span> {sg.speaker&&<b>{sg.speaker}: </b>}{sg.text}</p>)}</div>}</section>}
  {text.data&&<section><h4>Extracted text <small className="muted">({text.data.meta?.method})</small></h4><pre className="extracted">{text.data.content.slice(0,20000)}</pre></section>}
 </div>;
}
function DetailsForm({f,canEdit,onSave}:{f:FileItem,canEdit:boolean,onSave:(v:Record<string,unknown>)=>void}){
 const {s}=useApp();const [v,setV]=useState({name:f.name,description:f.description||'',tags:f.tags,category:f.category||''});
 return <div className="form-grid"><Field label="Name"><input disabled={!canEdit} value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Category"><select disabled={!canEdit} value={v.category} onChange={e=>setV({...v,category:e.target.value})}><option value="">—</option>{[...new Set([...(s.lookups['document-categories']||[]).map(x=>x.value),'Policy','Contract','Report','Meeting recording','Invoice','Specification',v.category].filter(Boolean))].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Tags" wide><input disabled={!canEdit} value={v.tags} onChange={e=>setV({...v,tags:e.target.value})}/></Field><Field label="Description" wide><textarea disabled={!canEdit} rows={3} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
  <KV items={[['Type',f.mime],['Size',bytes(f.bytes)],['Uploaded',dateTime(f.created_at)],['Updated',dateTime(f.updated_at)],['Department',f.department||'—']]}/>
  {canEdit&&<div className="form-actions"><Btn variant="primary" onClick={()=>onSave(v)}>Save details</Btn></div>}</div>;
}
function AccessTab({f,canEdit,isAdmin,act}:{f:FileItem,canEdit:boolean,isAdmin:boolean,act:(b:Record<string,unknown>,m:string)=>Promise<any>}){
 const {s,person}=useApp();const [acl,setAcl]=useState<Acl>(f.acl);const [owner,setOwner]=useState(f.owner_id||f.uploaded_by);
 const {data:projects}=useApi<{projects:{id:string,name:string,code:string}[]}>(s.tenant.pages?.includes('projects')?'/api/projects':null);const {data:spaces}=useApi<{spaces:{id:string,name:string,isMember:boolean}[]}>('/api/spaces');
 return <div className="form-grid">
  <div className="wide">{canEdit?<AudiencePicker value={acl} onChange={setAcl} projects={(projects?.projects||[]).map(p=>({id:p.id,name:`${p.code} · ${p.name}`}))} spaces={(spaces?.spaces||[]).map(x=>({id:x.id,name:x.name}))}/>:<Note>Visible to: {audienceShort(f.acl)}</Note>}</div>
  {canEdit&&<Field label="Editors" wide hint="People who can edit, share and delete this file besides its owner."><TagPicker values={(acl.editors||[]).map(i=>person(i)?.name||i)} options={s.people.filter(p=>p.active).map(p=>p.name)} onChange={v=>setAcl({...acl,editors:v.map(n=>s.people.find(p=>p.name===n)?.id).filter(Boolean) as string[]})} placeholder="Nobody else"/></Field>}
  {canEdit&&<div className="form-actions"><Btn variant="primary" onClick={()=>act({action:'access',acl},'Access updated')}>Save access</Btn></div>}
  {isAdmin&&<Field label="Owner"><select value={owner} onChange={e=>setOwner(e.target.value)}>{s.people.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
  {isAdmin&&owner!==(f.owner_id||f.uploaded_by)&&<div className="form-actions"><Btn onClick={()=>act({action:'owner',ownerId:owner},'Owner changed')}>Change owner</Btn></div>}
  <p className="muted small wide">Summaries, transcripts, captions and search results for this file follow exactly the same access. Company Admins can always manage it.</p>
 </div>;
}
function LinksTab({f,links,canEdit,act}:{f:FileItem,links:{entityType:string,entityId:string}[],canEdit:boolean,act:(b:Record<string,unknown>,m:string)=>Promise<any>}){
 const {ask}=useApp();const href=(t:string,id:string)=>({project:`#/projects/${id}`,task:`#/tasks/all/${id}`,ticket:`#/tickets/${id}`,asset:`#/assets/${id}`,PR:`#/purchasing/pr/${id}`,PO:`#/purchasing/po/${id}`,page:`#/spaces/page/${id}`,space:`#/spaces/${id}`,vendor:`#/purchasing/vendors/${id}`,person:`#/people/directory/${id}`,message:`#/messages`} as Record<string,string>)[t]||'#';
 return <div><div className="mini-list">{links.map(l=><div key={l.entityType+l.entityId} className="mini-row"><Icon name="Link" size={14}/><a href={href(l.entityType,l.entityId)}>{l.entityType} · {l.entityId.slice(0,8)}</a>{canEdit&&<Btn size="sm" variant="ghost" icon="X" title="Unlink" onClick={()=>act({action:'unlink',entityType:l.entityType,entityId:l.entityId},'Unlinked')}/>}</div>)}{!links.length&&<p className="muted small">Not linked to any record.</p>}</div>
  {canEdit&&<Btn size="sm" icon="Link" onClick={async()=>{const v=await ask({title:'Link to a record',body:'Paste the record’s link (for example from the address bar of a project, task, ticket, asset, PR or PO).',confirm:'Link',input:{label:'Record link',required:true}});if(v===false)return;const m=/#\/(projects|tasks\/all|tickets|assets|purchasing\/(pr|po)|spaces\/s|spaces\/page|purchasing\/vendors|people\/directory)\/([A-Za-z0-9-]{8,80})/.exec(v);if(!m){return}const type=({projects:'project','tasks/all':'task',tickets:'ticket',assets:'asset','spaces':'space','spaces/page':'page','purchasing/vendors':'vendor','people/directory':'person'} as Record<string,string>)[m[1]]||(m[2]==='pr'?'PR':'PO');act({action:'link',entityType:type,entityId:m[3]},'Linked')}}>Link to a record</Btn>}</div>;
}
function Storage(){
 const {toast}=useApp();const {data,error,reload}=useApi<any>('/api/files?usage');const [p,setP]=useState<any>(null);useEffect(()=>{if(data)setP(data.policy)},[data]);
 if(error)return <div className="page"><ErrorNote error={error}/></div>;if(!data||!p)return <div className="page"><Skeleton/></div>;
 return <div className="page"><Header icon="HardDrive" tone="amber" title="Storage & file policies" subtitle="Usage, processing status and company file policies."/>
  <div className="stats"><div className="stat"><small>Used</small><b>{bytes(data.totals.b)} of {(data.limitMb/1024).toFixed(1)} GB</b></div><div className="stat"><small>Files</small><b>{data.totals.n}</b></div><div className="stat"><small>Recycle bin</small><b>{data.bin.n} · {bytes(data.bin.b)}</b></div></div>
  <div className="split-2"><div className="card"><h3>By department</h3><table className="plain"><tbody>{data.byDept.map((d:any)=><tr key={d.department}><td>{d.department||'—'}</td><td>{d.files}</td><td>{bytes(d.bytes)}</td></tr>)}</tbody></table><h3>Processing</h3><div className="row-gap">{data.byStatus.map((x:any)=><Chip key={x.status} tone={statusTone(x.status)}>{statusLabel[x.status]||x.status}: {x.files}</Chip>)}</div><div className="row-gap">{data.queue.map((x:any)=><Chip key={x.status}>{x.status}: {x.jobs}</Chip>)}<Btn size="sm" icon="RefreshCw" onClick={async()=>{const r=await api<any>('/api/files',{action:'process-queue'});toast(`${r.processed} processed`);reload()}}>Run queue now</Btn></div></div>
   <div className="card"><h3>Policies</h3><div className="form-grid"><Field label="Recycle bin retention (days)"><input type="number" min={1} max={3650} value={p.retentionDays} onChange={e=>setP({...p,retentionDays:Number(e.target.value)})}/></Field><Field label="Company-wide sharing"><select value={p.companyWidePublishing} onChange={e=>setP({...p,companyWidePublishing:e.target.value})}><option value="everyone">Anyone may share with everyone</option><option value="admins">Staff need administrator approval</option></select></Field><label className="check wide"><input type="checkbox" checked={p.legalHoldEnabled} onChange={e=>setP({...p,legalHoldEnabled:e.target.checked})}/>Enable legal hold</label><div className="form-actions"><Btn variant="primary" onClick={async()=>{try{await api('/api/files',{action:'policy',retentionDays:p.retentionDays,companyWidePublishing:p.companyWidePublishing,legalHoldEnabled:p.legalHoldEnabled});toast('Policies saved');reload()}catch(e){toast((e as Error).message,'error')}}}>Save policies</Btn></div></div></div></div>
 </div>;
}
export {views as fileViews};
