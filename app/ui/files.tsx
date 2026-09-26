'use client';
import {useEffect,useMemo,useState} from 'react';
import {api,useApi,go,ago,bytes,dateTime,cx} from './lib';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,Who,ErrorNote,Skeleton,Empty,KV,Icon,Note,Menu,type Col} from './kit';

type Folder={id:string,parent_id:string|null,name:string,department:string,visibility:string,created_by:string};
type FileItem={id:string,folder_id:string|null,name:string,mime:string,bytes:number,department:string,visibility:string,tags:string,description:string,version:number,uploaded_by:string,created_at:string,updated_at:string};
type Data={folders:Folder[],files:FileItem[],canUpload:boolean};
// Rail and page share one request per change via a tiny module-level cache.
const cache:{data:Data|null,subs:Set<()=>void>,loading:boolean}={data:null,subs:new Set(),loading:false};
async function refreshFiles(){cache.loading=true;try{cache.data=await api<Data>('/api/files')}finally{cache.loading=false;cache.subs.forEach(f=>f())}}
export function useFolders(){const [,tick]=useState(0);useEffect(()=>{const f=()=>tick(x=>x+1);cache.subs.add(f);if(!cache.data&&!cache.loading)refreshFiles().catch(()=>{});return()=>{cache.subs.delete(f)}},[]);return {data:cache.data,reload:refreshFiles}}

const icon=(m:string)=>m.startsWith('image/')?'FileImage':m==='application/pdf'?'FileText':/sheet|excel|csv/.test(m)?'FileSpreadsheet':/word/.test(m)?'FileType':/presentation|powerpoint/.test(m)?'Presentation':/zip/.test(m)?'FileArchive':m.startsWith('video/')?'FileVideo':m.startsWith('audio/')?'FileAudio':'File';
const tone=(m:string)=>m.startsWith('image/')?'pink':m==='application/pdf'?'red':/sheet|excel|csv/.test(m)?'green':/word/.test(m)?'blue':/presentation/.test(m)?'orange':'gray';
const visLabel:Record<string,string>={company:'Everyone',department:'Department',private:'Only me & admins'};

export default function Files({parts}:{parts:string[]}){
 const {s,person}=useApp();const {data,reload}=useFolders();const [err,setErr]=useState('');
 const place=parts[0]||'root',openId=parts[1]&&parts[1]!=='upload'?parts[1]:undefined,upload=parts[1]==='upload';
 const [newFolder,setNewFolder]=useState(false),[dragOver,setDragOver]=useState(false),[dropped,setDropped]=useState<File[]|null>(null);
 useEffect(()=>{reload().catch(e=>setErr(e.message))},[reload]);
 const folders=data?.folders||[];const folder=folders.find(f=>f.id===place);
 const crumbs=useMemo(()=>{const out:Folder[]=[];let f=folder;while(f){out.unshift(f);f=folders.find(x=>x.id===f!.parent_id)}return out},[folder,folders]);
 const files=(data?.files||[]).filter(f=>place==='recent'?true:place==='mine'?f.uploaded_by===s.user.id:place==='root'?!f.folder_id:f.folder_id===place).slice(0,place==='recent'?60:5000);
 const sub=folders.filter(f=>(place==='root'?!f.parent_id:f.parent_id===place));
 const cols:Col<FileItem>[]=[
  {key:'name',label:'Name',render:f=><span className="file-name"><span className={`file-icon tone-${tone(f.mime)}`}><Icon name={icon(f.mime)} size={16}/></span><span><b>{f.name}</b>{f.description&&<small>{f.description}</small>}</span></span>},
  {key:'visibility',label:'Shared with',width:150,render:f=><span className="muted small"><Icon name={f.visibility==='private'?'Lock':f.visibility==='department'?'Users':'Globe'} size={13}/> {f.visibility==='department'?f.department:visLabel[f.visibility]}</span>},
  {key:'owner',label:'Uploaded by',width:170,render:f=><Who id={f.uploaded_by}/>,value:f=>person(f.uploaded_by)?.name||''},
  {key:'bytes',label:'Size',width:90,align:'right',render:f=><span className="muted">{bytes(f.bytes)}</span>,value:f=>f.bytes},
  {key:'version',label:'Ver.',width:60,align:'right',render:f=><span className="muted">v{f.version}</span>},
  {key:'updated_at',label:'Updated',width:110,render:f=><span className="muted">{ago(f.updated_at)}</span>},
  {key:'tags',label:'Tags',hide:true},
 ];
 const title=place==='recent'?'Recent files':place==='mine'?'My uploads':folder?.name||'All files';
 return <div className={cx('page files-page',dragOver&&'drag-over')} onDragOver={e=>{if(data?.canUpload&&e.dataTransfer.types.includes('Files')){e.preventDefault();setDragOver(true)}}} onDragLeave={e=>{if(e.currentTarget===e.target)setDragOver(false)}} onDrop={e=>{e.preventDefault();setDragOver(false);if(e.dataTransfer.files.length)setDropped([...e.dataTransfer.files])}}>
  <Header icon="FolderClosed" tone="amber" title={title} subtitle={crumbs.length>1?<span className="crumb-path">{crumbs.map((c,i)=><a key={c.id} href={`#/files/${c.id}`}>{i?' / ':''}{c.name}</a>)}</span>:folder?`${visLabel[folder.visibility]} · ${folder.department}`:'Policies, templates, reports and shared documents. Drag files anywhere on this page to upload.'} actions={<>{data?.canUpload&&!['recent','mine'].includes(place)&&<Btn icon="FolderPlus" onClick={()=>setNewFolder(true)}>New folder</Btn>}{data?.canUpload&&<Btn variant="primary" icon="Upload" onClick={()=>go(`files/${place}/upload`)}>Upload</Btn>}</>}/>
  <ErrorNote error={err}/>
  {!data?<Skeleton/>:<>
   {sub.length>0&&<div className="folder-grid">{sub.map(f=><a key={f.id} href={`#/files/${f.id}`} className="folder-tile"><Icon name="Folder" size={22}/><span><b>{f.name}</b><small>{(data.files.filter(x=>x.folder_id===f.id).length)} files · {f.visibility==='department'?f.department:visLabel[f.visibility]}</small></span></a>)}</div>}
   <Grid id="files" rows={files} cols={cols} onOpen={f=>go(`files/${place}/${f.id}`)} activeId={openId} initialSort={['updated_at','desc']} empty={<Empty icon="FileUp" title={sub.length?'No files at this level':'This folder is empty'} action={data.canUpload&&<Btn icon="Upload" onClick={()=>go(`files/${place}/upload`)}>Upload files</Btn>}>Drag and drop files here, up to 25 MB each.</Empty>}/>
  </>}
  {dragOver&&<div className="drop-hint"><Icon name="Upload" size={34}/><b>Drop to upload to {title}</b></div>}
  {(upload||dropped)&&<UploadDialog folder={folder} initial={dropped||[]} onClose={()=>{setDropped(null);if(upload)go(`files/${place}`)}} onDone={()=>{setDropped(null);reload();if(upload)go(`files/${place}`)}}/>}
  {newFolder&&<NewFolder parent={folder} onClose={()=>setNewFolder(false)} onDone={()=>{setNewFolder(false);reload()}}/>}
  {openId&&<FilePanel id={openId} folders={folders} onClose={()=>go(`files/${place}`)} onChanged={reload}/>}
 </div>;
}

function UploadDialog({folder,initial,onClose,onDone}:{folder?:Folder,initial:File[],onClose:()=>void,onDone:()=>void}){
 const {s,toast}=useApp();const [files,setFiles]=useState<File[]>(initial),[vis,setVis]=useState(folder?.visibility||'company'),[dept,setDept]=useState(folder?.department||s.user.department),[desc,setDesc]=useState(''),[tags,setTags]=useState(''),[progress,setProgress]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
 async function go_(){setBusy(true);let ok=0;for(const f of files){setProgress(p=>({...p,[f.name]:'uploading'}));const fd=new FormData();fd.set('file',f);if(folder)fd.set('folderId',folder.id);fd.set('visibility',vis);fd.set('department',dept);fd.set('description',desc);fd.set('tags',tags);try{await api('/api/files',fd);ok++;setProgress(p=>({...p,[f.name]:'done'}))}catch(e){setProgress(p=>({...p,[f.name]:(e as Error).message}))}}setBusy(false);if(ok){toast(`${ok} file${ok>1?'s':''} uploaded`);if(ok===files.length)onDone()}}
 return <Modal open wide onClose={onClose} title={`Upload to ${folder?.name||'All files'}`} footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn variant="primary" icon="Upload" busy={busy} disabled={!files.length} onClick={go_}>Upload {files.length||''}</Btn></>}>
  <label className={cx('dropzone',files.length>0&&'has-file')}><input type="file" multiple onChange={e=>setFiles([...files,...(e.target.files?[...e.target.files]:[])])}/><Icon name="CloudUpload" size={28}/><b>{files.length?`${files.length} file${files.length>1?'s':''} selected`:'Choose files or drop them here'}</b><small>PDF, Office, CSV, images, ZIP, MP3/MP4 · up to 25 MB each</small></label>
  {files.length>0&&<ul className="upload-list">{files.map((f,i)=><li key={i}><Icon name={icon(f.type||'')} size={15}/><span>{f.name}</span><small>{bytes(f.size)}</small><em className={progress[f.name]==='done'?'text-green':progress[f.name]&&progress[f.name]!=='uploading'?'text-red':'muted'}>{progress[f.name]==='uploading'?'Uploading…':progress[f.name]==='done'?'Uploaded':progress[f.name]||''}</em>{!busy&&<button className="link" onClick={()=>setFiles(files.filter((_,j)=>j!==i))}><Icon name="X" size={14}/></button>}</li>)}</ul>}
  <div className="form-grid"><Field label="Who can see these"><select value={vis} onChange={e=>setVis(e.target.value)}><option value="company">Everyone in the company</option><option value="department">My department only</option><option value="private">Only me and administrators</option></select></Field><Field label="Department"><DeptSelect value={dept} onChange={setDept}/></Field><Field label="Description"><input value={desc} onChange={e=>setDesc(e.target.value)}/></Field><Field label="Tags"><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="policy, 2026, template"/></Field></div>
 </Modal>;
}
function NewFolder({parent,onClose,onDone}:{parent?:Folder,onClose:()=>void,onDone:()=>void}){const {s,toast}=useApp();const [v,setV]=useState({name:'',visibility:parent?.visibility||'company',department:parent?.department||s.user.department});return <Modal open onClose={onClose} title={parent?`New folder in ${parent.name}`:'New folder'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!v.name.trim()} onClick={async()=>{try{await api('/api/files',{action:'folder',parentId:parent?.id||null,...v});onDone()}catch(e){toast((e as Error).message,'error')}}}>Create folder</Btn></>}><div className="form-grid"><Field label="Name" wide><input autoFocus value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Visible to"><select value={v.visibility} onChange={e=>setV({...v,visibility:e.target.value})}><option value="company">Everyone</option><option value="department">Department</option><option value="private">Only me & admins</option></select></Field><Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field></div></Modal>}

function FilePanel({id,folders,onClose,onChanged}:{id:string,folders:Folder[],onClose:()=>void,onChanged:()=>void}){
 const {toast,ask}=useApp();const {data,error,reload}=useApi<{file:FileItem,versions:{version:number,bytes:number,uploadedBy:string,createdAt:string}[],canEdit:boolean}>('/api/files?id='+encodeURIComponent(id));const [edit,setEdit]=useState(false);
 const f=data?.file;const previewable=f&&(/^image\/(png|jpeg|gif|webp)$/.test(f.mime)||f.mime==='application/pdf');
 async function newVersion(file:File){const fd=new FormData();fd.set('file',file);fd.set('replaceId',id);try{await api('/api/files',fd);toast('New version uploaded');reload();onChanged()}catch(e){toast((e as Error).message,'error')}}
 return <Inspector open onClose={onClose} width={620} eyebrow={f?`v${f.version} · ${bytes(f.bytes)}`:''} title={f?.name||'Loading…'} actions={f&&<><Btn size="sm" icon="Download" href={`/api/files?download=${id}`}>Download</Btn>{data?.canEdit&&<Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:'Edit details',icon:'Pencil',onClick:()=>setEdit(true)},{label:'Upload new version',icon:'Upload',onClick:()=>{const i=document.createElement('input');i.type='file';i.onchange=()=>i.files?.[0]&&newVersion(i.files[0]);i.click()}},'-',{label:'Delete file',icon:'Trash2',danger:true,onClick:async()=>{if(await ask({title:`Delete ${f.name}?`,body:'All versions are removed permanently.',confirm:'Delete',danger:true})===false)return;try{await api('/api/files',{action:'delete',id});toast('File deleted');onChanged();onClose()}catch(e){toast((e as Error).message,'error')}}}]}/>}</>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!f?<Skeleton/>:<>
   {previewable&&<div className="file-preview">{f.mime==='application/pdf'?<iframe title={f.name} src={`/api/files?preview=${id}`}/>:<img alt={f.name} src={`/api/files?preview=${id}`}/>}</div>}
   <KV items={[['Shared with',f.visibility==='department'?`${f.department} department`:visLabel[f.visibility]],['Folder',folders.find(x=>x.id===f.folder_id)?.name||'All files'],['Uploaded by',<Who key="u" id={f.uploaded_by}/>],['Uploaded',dateTime(f.created_at)],['Updated',ago(f.updated_at)],['Tags',f.tags&&<span key="t">{f.tags.split(',').map(t=><Chip key={t} tone="gray">{t.trim()}</Chip>)}</span>],['Description',f.description]]}/>
   {data.versions.length>0&&<><h4 className="section-title">Earlier versions</h4><div className="mini-list">{data.versions.map(v=><a key={v.version} href={`/api/files?download=${id}&v=${v.version}`}><Icon name="History" size={15}/><span>Version {v.version}<small>{bytes(v.bytes)} · {dateTime(v.createdAt)}</small></span><Who id={v.uploadedBy}/></a>)}</div></>}
  </>}
  {edit&&f&&<EditFile f={f} folders={folders} onClose={()=>setEdit(false)} onSaved={()=>{setEdit(false);reload();onChanged()}}/>}
 </Inspector>;
}
function EditFile({f,folders,onClose,onSaved}:{f:FileItem,folders:Folder[],onClose:()=>void,onSaved:()=>void}){const {toast}=useApp();const [v,setV]=useState({name:f.name,description:f.description,tags:f.tags,visibility:f.visibility,department:f.department,folderId:f.folder_id||''});return <Modal open onClose={onClose} title="Edit file details" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={async()=>{try{await api('/api/files',{action:'update',id:f.id,...v,folderId:v.folderId||null});toast('Saved');onSaved()}catch(e){toast((e as Error).message,'error')}}}>Save</Btn></>}><div className="form-grid"><Field label="Name" wide><input value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Folder"><select value={v.folderId} onChange={e=>setV({...v,folderId:e.target.value})}><option value="">All files (top level)</option>{folders.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Visible to"><select value={v.visibility} onChange={e=>setV({...v,visibility:e.target.value})}><option value="company">Everyone</option><option value="department">Department</option><option value="private">Only uploader & admins</option></select></Field><Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field><Field label="Tags"><input value={v.tags} onChange={e=>setV({...v,tags:e.target.value})}/></Field><Field label="Description" wide><textarea rows={2} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></div><Note>Visibility controls who can find and open the file.</Note></Modal>}
