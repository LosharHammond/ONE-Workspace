'use client';
import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {api,go,useApi,ago,cx,dateTime} from './lib';
import {useApp,Btn,Chip,Header,Field,ErrorNote,Skeleton,Empty,Icon,Note,Tabs,Modal,Card,TagPicker} from './kit';
import {TableView,RecordForm,ReportView,FieldInput} from './studio-runtime';
import {FIELD_LABELS,FIELD_TYPES,TRIGGERS,ACTIONS,CHARTS,RELATION_TYPES,validateApp,validateWorkflow,emptyApp,type AppDef,type FieldType,type StudioField,type StudioTable,type StudioWorkflow,type WfTransition,type Automation,type WfAction,type Cond,type ApprovalStage,type Approver,type StudioReport,type Issue} from '../studio-def';

// Workspace Studio: no-code builder for company apps. Everything built here is metadata that the server
// validates, versions and runs with each user's permissions. Drafts never affect users until published.
type AppSum={id:string,slug:string,name:string,description:string,icon:string,status:string,draftVersion:number,publishedVersion:number|null,approvalStatus:string,disabledReason:string|null,paused:string[],updatedAt:string,updatedBy:string};
type AppData={app:AppSum,definition:AppDef,version:number,canManage:boolean,versions:{version:number,note:string,createdBy:string,createdAt:string}[],issues?:Issue[]};
const key=(s:string,taken:string[]=[])=>{const k=s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').replace(/^[^a-z]+/,'').slice(0,36)||'item';let n=k,i=2;while(taken.includes(n))n=`${k}_${i++}`;return n};
const rid=()=>Math.random().toString(36).slice(2,9);
const statusTone=(s:string)=>s==='published'?'green':s==='archived'?'gray':s==='deprecated'?'orange':'amber';
const SECTIONS=[{id:'data',label:'Data',icon:'Database'},{id:'forms',label:'Forms',icon:'ClipboardPen'},{id:'workflows',label:'Workflows',icon:'Workflow'},{id:'automations',label:'Automations',icon:'Zap'},{id:'reports',label:'Reports',icon:'ChartPie'},{id:'nav',label:'Pages & navigation',icon:'PanelsTopLeft'},{id:'permissions',label:'Permissions',icon:'ShieldCheck'},{id:'versions',label:'Versions',icon:'History'},{id:'preview',label:'Preview',icon:'Eye'}] as const;

export default function Studio({parts=[]}:{parts?:string[]}){
 const [view,id,tab]=parts;
 if(view==='apps'&&id)return <Builder id={id} tab={tab||'data'}/>;
 if(view==='templates')return <Templates/>;
 if(view==='widgets')return <Widgets/>;
 if(view==='extensions')return <Extensions/>;
 if(view==='approvals')return <Approvals/>;
 if(view==='usage')return <Usage/>;
 if(view==='pages')return <Redirect to="pages"/>;
 if(view==='published')return <Redirect to="apps"/>;
 if(view&&SECTIONS.some(s=>s.id===view))return <AppList section={view}/>;
 return <AppList/>;
}

function Redirect({to}:{to:string}){useEffect(()=>{go(to)},[to]);return null}
function AppList({section}:{section?:string}){
 const {data,error,reload}=useApi<{apps:AppSum[],canCreate:boolean}>('/api/studio');const [creating,setCreating]=useState(false);
 const sec=SECTIONS.find(s=>s.id===section);
 return <div className="page">
  <Header icon="PanelsTopLeft" tone="violet" title={sec?`${sec.label} · choose an app`:'Workspace Studio'} subtitle="Build company apps without code: data tables, forms, workflows with approvals, automations, reports and pages. Every app runs with each person’s own permissions." actions={data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>New app</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.apps.length?<Empty icon="PanelsTopLeft" title="No Studio apps yet" action={data.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>Create your first app</Btn>}>Start blank, from a template, or describe what you need.</Empty>:
   <div className="lb-table"><table className="plain"><thead><tr><th>App</th><th>Status</th><th>Published</th><th>Draft</th><th>Updated</th></tr></thead><tbody>{data.apps.map(a=><tr key={a.id}><td><a href={data.canCreate?`#/studio/apps/${a.id}/${section||'data'}`:`#/apps/${a.slug}`}><b>{a.name}</b></a><br/><small className="muted">#/apps/{a.slug}</small>{a.disabledReason&&<><br/><Chip tone="red">Disabled by platform</Chip></>}</td><td><Chip tone={statusTone(a.status)}>{a.status}</Chip>{a.approvalStatus==='pending'&&<> <Chip tone="amber">awaiting approval</Chip></>}</td><td>{a.publishedVersion?`v${a.publishedVersion}`:'—'}</td><td>v{a.draftVersion}</td><td className="muted">{ago(a.updatedAt)}</td></tr>)}</tbody></table></div>}
  {creating&&<CreateApp onClose={()=>setCreating(false)}/>}
 </div>;
}
function CreateApp({onClose,templateId}:{onClose:()=>void,templateId?:string}){
 const {toast}=useApp();const [name,setName]=useState('');const [description,setDescription]=useState('');const [tpl,setTpl]=useState(templateId||'');const [busy,setBusy]=useState(false);
 const {data}=useApi<{templates:{id:string,name:string,description:string,scope:string,tables:number,workflows:number,automations:number}[]}>('/api/studio?view=templates');
 const create=async()=>{setBusy(true);try{const blank:AppDef={...emptyApp(),tables:[{key:'records',name:'Records',fields:[{key:'title',label:'Title',type:'text',required:true}],titleField:'title',permissions:{view:[],create:[],edit:[],delete:['admin'],scope:'all'},numbering:{prefix:'REC'}}],forms:[{key:'new_record',name:'New record',table:'records',sections:[{title:'',fields:['title']}],allowDraft:true}]};
  const r=await api<{id:string}>('/api/studio',tpl?{action:'use-template',templateId:tpl,name,description}:{action:'create',name,description,definition:blank});toast('App created as a draft');onClose();go(`studio/apps/${r.id}/data`)}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}};
 return <Modal open onClose={onClose} title="New Studio app" subtitle="Apps start as drafts. Nobody sees them until you publish." footer={<Btn variant="primary" busy={busy} disabled={!name.trim()} onClick={create}>Create</Btn>}>
  <Field label="Name"><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Contract approvals"/></Field>
  <Field label="Description"><input value={description} onChange={e=>setDescription(e.target.value)}/></Field>
  <Field label="Start from"><select value={tpl} onChange={e=>setTpl(e.target.value)}><option value="">A blank app</option>{(data?.templates||[]).map(t=><option key={t.id} value={t.id}>{t.name}{t.scope==='platform'?' (platform)':''} — {t.tables} tables, {t.workflows} workflows</option>)}</select></Field>
 </Modal>;
}

// ── Builder ──
function Builder({id,tab}:{id:string,tab:string}){
 const {toast,ask}=useApp();
 const {data,error,reload}=useApi<AppData>(`/api/studio?id=${encodeURIComponent(id)}`);
 const [def,setDef]=useState<AppDef|null>(null);const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState('');const [meta,setMeta]=useState({name:'',description:'',icon:''});const [serverIssues,setServerIssues]=useState<Issue[]>([]);
 useEffect(()=>{if(data){setDef(data.definition);setMeta({name:data.app.name,description:data.app.description,icon:data.app.icon});setDirty(false)}},[data]);
 useEffect(()=>{const f=(e:BeforeUnloadEvent)=>{if(dirty)e.preventDefault()};window.addEventListener('beforeunload',f);return()=>window.removeEventListener('beforeunload',f)},[dirty]);
 const issues=useMemo(()=>def?validateApp(def):[],[def]);
 const change=useCallback((f:(d:AppDef)=>void)=>{setDef(d=>{const n=JSON.parse(JSON.stringify(d)) as AppDef;f(n);return n});setDirty(true)},[]);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data||!def)return <div className="page"><Skeleton rows={10}/></div>;
 const a=data.app;
 const call=async(action:string,extra:Record<string,unknown>={},msg?:string)=>{setBusy(action);setServerIssues([]);try{const r=await api<{issues?:Issue[],version?:number,report?:{passed:boolean,errors:number,warnings:number}}>('/api/studio',{action,id:a.id,...extra});if(r.issues)setServerIssues(r.issues);if(msg)toast(msg);if(action==='test')toast(r.report?.passed?`Checks passed (${r.report.warnings} warnings)`:`${r.report?.errors} errors found`,r.report?.passed?'ok':'error');reload();return r}catch(e){const m=(e as Error).message;try{const j=JSON.parse(m) as {message:string,issues:Issue[]};setServerIssues(j.issues);toast(j.message,'error')}catch{toast(m,'error')}return null}finally{setBusy('')}};
 const save=()=>call('save',{definition:def,baseVersion:data.version,...meta},'Draft saved');
 const errors=issues.filter(i=>i.level==='error');
 return <div className="page studio-builder">
  <Header icon={a.icon||'PanelsTopLeft'} tone="violet" title={a.name} subtitle={<span className="row-gap"><Chip tone={statusTone(a.status)}>{a.status}</Chip><span>Draft v{a.draftVersion}{a.publishedVersion?` · live v${a.publishedVersion}`:' · not published'}</span>{dirty&&<Chip tone="amber">unsaved</Chip>}{a.approvalStatus!=='none'&&<Chip tone={a.approvalStatus==='approved'?'green':a.approvalStatus==='rejected'?'red':'amber'}>approval {a.approvalStatus}</Chip>}</span>}
   actions={<div className="row-gap"><Btn icon="Save" busy={busy==='save'} disabled={!dirty} onClick={save}>Save draft</Btn><Btn icon="FlaskConical" busy={busy==='test'} onClick={()=>call('test',{definition:def})}>Test</Btn>
    {def.settings.requiresApproval&&a.approvalStatus!=='approved'?<Btn variant="primary" icon="Send" busy={busy==='submit-for-approval'} disabled={dirty||!!errors.length||a.approvalStatus==='pending'} onClick={()=>call('submit-for-approval',{},'Submitted for approval')}>Submit for approval</Btn>
    :<Btn variant="primary" icon="Rocket" busy={busy==='publish'} disabled={dirty||!!errors.length} title={dirty?'Save the draft first':errors.length?'Fix errors first':''} onClick={async()=>{const note=await ask({title:'Publish this version?',body:'People with access will use it immediately. Previous versions stay available for rollback.',input:{label:'Version note'},confirm:'Publish'});if(note!==false)call('publish',{note},'Published')}}>Publish</Btn>}
    {a.publishedVersion&&<Btn icon="ExternalLink" onClick={()=>go(`apps/${a.slug}`)}>Open app</Btn>}</div>}/>
  {a.disabledReason&&<Note tone="warn">Disabled by the Platform Owner: {a.disabledReason}</Note>}
  {a.approvalStatus==='pending'&&<Note>Waiting for another administrator to approve publishing. <button className="link" onClick={()=>call('approve-publish',{},'Approved')}>Approve</button> · <button className="link" onClick={()=>call('reject-publish',{},'Rejected')}>Reject</button></Note>}
  <IssueList issues={[...errors,...serverIssues.filter(s=>!errors.some(e=>e.message===s.message)),...issues.filter(i=>i.level==='warning')]}/>
  <nav className="app-nav">{SECTIONS.map(s=><a key={s.id} href={`#/studio/apps/${a.id}/${s.id}`} className={cx('app-nav-link',tab===s.id&&'on')}><Icon name={s.icon} size={15}/>{s.label}</a>)}</nav>
  {tab==='data'&&<DataTab def={def} change={change}/>}
  {tab==='forms'&&<FormsTab def={def} change={change}/>}
  {tab==='workflows'&&<WorkflowsTab def={def} change={change}/>}
  {tab==='automations'&&<AutomationsTab app={a} def={def} change={change} dirty={dirty} save={save} reload={reload}/>}
  {tab==='reports'&&<ReportsTab def={def} change={change}/>}
  {tab==='nav'&&<NavTab def={def} change={change} meta={meta} setMeta={m=>{setMeta(m);setDirty(true)}}/>}
  {tab==='permissions'&&<PermissionsTab def={def} change={change}/>}
  {tab==='versions'&&<VersionsTab data={data} call={call}/>}
  {tab==='preview'&&<PreviewTab app={a} def={def} dirty={dirty}/>}
 </div>;
}
function IssueList({issues}:{issues:Issue[]}){if(!issues.length)return null;return <details className="issues" open={issues.some(i=>i.level==='error')}><summary><Icon name={issues.some(i=>i.level==='error')?'CircleAlert':'TriangleAlert'} size={15}/> {issues.filter(i=>i.level==='error').length} errors · {issues.filter(i=>i.level==='warning').length} warnings</summary><ul>{issues.map((i,n)=><li key={n} className={i.level}><b>{i.where}</b>: {i.message}</li>)}</ul></details>}
type Change=(f:(d:AppDef)=>void)=>void;

// Data: tables and fields (all field types), statuses, numbering, retention.
function DataTab({def,change}:{def:AppDef,change:Change}){
 const [ti,setTi]=useState(0);const t=def.tables[ti];const [fi,setFi]=useState<number|null>(null);const [nf,setNf]=useState<FieldType>('text');
 const addTable=()=>{const k=key('table',def.tables.map(x=>x.key));change(d=>{d.tables.push({key:k,name:'New table',fields:[{key:'title',label:'Title',type:'text',required:true}],titleField:'title',permissions:{view:[],create:[],edit:[],delete:['admin'],scope:'all'},numbering:{prefix:k.slice(0,3).toUpperCase()}})});setTi(def.tables.length)};
 return <div className="studio-split">
  <aside className="studio-list">{def.tables.map((x,i)=><button key={x.key} className={cx('studio-item',i===ti&&'on')} onClick={()=>{setTi(i);setFi(null)}}><Icon name="Table2" size={15}/>{x.name}<small>{x.fields.length} fields</small></button>)}<Btn size="sm" icon="Plus" onClick={addTable}>Add table</Btn></aside>
  {!t?<Empty icon="Database" title="No tables yet" action={<Btn icon="Plus" onClick={addTable}>Add table</Btn>}/>:<div className="studio-main">
   <div className="form-grid"><Field label="Table name"><input value={t.name} onChange={e=>change(d=>{d.tables[ti].name=e.target.value})}/></Field><Field label="Key" hint="Used in addresses and automations."><input value={t.key} onChange={e=>change(d=>{d.tables[ti].key=e.target.value})}/></Field>
    <Field label="Record title field"><select value={t.titleField} onChange={e=>change(d=>{d.tables[ti].titleField=e.target.value})}>{t.fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
    <Field label="Number prefix"><input value={t.numbering?.prefix||''} onChange={e=>change(d=>{d.tables[ti].numbering=e.target.value?{prefix:e.target.value.toUpperCase().slice(0,8)}:undefined})}/></Field>
    <Field label="Workflow"><select value={t.workflow||''} onChange={e=>change(d=>{d.tables[ti].workflow=e.target.value||undefined})}><option value="">None</option>{def.workflows.filter(w=>w.table===t.key).map(w=><option key={w.key} value={w.key}>{w.name}</option>)}</select></Field>
    <Field label="Delete records after (days)" hint="Empty keeps records."><input type="number" min={1} value={t.retentionDays||''} onChange={e=>change(d=>{d.tables[ti].retentionDays=e.target.value?Number(e.target.value):undefined})}/></Field></div>
   <h3>Fields</h3>
   <div className="lb-table"><table className="plain"><thead><tr><th>Label</th><th>Type</th><th>Required</th><th>Conditional</th><th/></tr></thead><tbody>{t.fields.map((f,i)=><tr key={f.key} className={cx(fi===i&&'on')}><td><button className="link" onClick={()=>setFi(i)}>{f.label}</button> <small className="muted">{f.key}</small></td><td>{FIELD_LABELS[f.type]}</td><td>{f.required?'Yes':''}</td><td>{f.showIf?`if ${f.showIf.field} ${f.showIf.op} ${f.showIf.value??''}`:''}</td><td className="row-gap"><Btn size="sm" variant="ghost" icon="ArrowUp" title="Move up" disabled={!i} onClick={()=>change(d=>{const l=d.tables[ti].fields;[l[i-1],l[i]]=[l[i],l[i-1]]})}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove field" onClick={()=>{change(d=>{d.tables[ti].fields.splice(i,1)});setFi(null)}}/></td></tr>)}</tbody></table></div>
   <div className="row-gap"><select aria-label="New field type" value={nf} onChange={e=>setNf(e.target.value as FieldType)}>{FIELD_TYPES.map(x=><option key={x} value={x}>{FIELD_LABELS[x]}</option>)}</select><Btn size="sm" icon="Plus" onClick={()=>{const type=nf;change(d=>{const l=d.tables[ti].fields;const f:StudioField={key:key(FIELD_LABELS[type],l.map(x=>x.key)),label:FIELD_LABELS[type],type};if(['select','multiselect','radio'].includes(type))f.options=['Option 1','Option 2'];if(type==='relationship')f.relation='project';if(type==='lookup')f.lookupTable=d.tables.find(x=>x.key!==t.key)?.key||t.key;if(type==='formula')f.formula='0';if(type==='repeating')f.subfields=[{key:'item',label:'Item',type:'text'},{key:'qty',label:'Quantity',type:'number'}];l.push(f)});setFi(t.fields.length)}}>Add field</Btn></div>
   {fi!==null&&t.fields[fi]&&<FieldEditor f={t.fields[fi]} table={t} def={def} onChange={nf=>change(d=>{d.tables[ti].fields[fi]=nf})}/>}
  </div>}
 </div>;
}
function CondEditor({value,fields,onChange}:{value?:Cond,fields:StudioField[],onChange:(c?:Cond)=>void}){
 const c=value||{field:'',op:'eq' as const,value:''};
 return <div className="row-gap cond"><select aria-label="Field" value={c.field} onChange={e=>onChange(e.target.value?{...c,field:e.target.value}:undefined)}><option value="">— always —</option>{fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select>{c.field&&<><select aria-label="Operator" value={c.op} onChange={e=>onChange({...c,op:e.target.value as Cond['op']})}>{['eq','neq','gt','gte','lt','lte','contains','empty','notEmpty','in'].map(o=><option key={o}>{o}</option>)}</select>{!['empty','notEmpty'].includes(c.op)&&<input aria-label="Value" value={String(c.value??'')} onChange={e=>onChange({...c,value:e.target.value})}/>}</>}</div>;
}
function FieldEditor({f,table,def,onChange}:{f:StudioField,table:StudioTable,def:AppDef,onChange:(f:StudioField)=>void}){
 const {s}=useApp();const set=(p:Partial<StudioField>)=>onChange({...f,...p});const roles=[...s.roles.map(r=>r.id),'admin','manager','employee','viewer'];
 return <Card title={`Field: ${f.label}`} className="field-editor"><div className="form-grid">
  <Field label="Label"><input value={f.label} onChange={e=>set({label:e.target.value})}/></Field>
  <Field label="Key"><input value={f.key} onChange={e=>set({key:e.target.value})}/></Field>
  <Field label="Type"><select value={f.type} onChange={e=>set({type:e.target.value as FieldType})}>{FIELD_TYPES.map(x=><option key={x} value={x}>{FIELD_LABELS[x]}</option>)}</select></Field>
  <Field label="Help text"><input value={f.help||''} onChange={e=>set({help:e.target.value||undefined})}/></Field>
  <label className="check"><input type="checkbox" checked={!!f.required} onChange={e=>set({required:e.target.checked})}/>Required</label>
  <label className="check"><input type="checkbox" checked={!!f.unique} onChange={e=>set({unique:e.target.checked})}/>Unique</label>
  {['select','multiselect','radio'].includes(f.type)&&<Field label="Options (one per line)" wide><textarea rows={4} value={(f.options||[]).join('\n')} onChange={e=>set({options:e.target.value.split('\n').map(x=>x.trim()).filter(Boolean)})}/></Field>}
  {['number','currency','percent','rating'].includes(f.type)&&<><Field label="Minimum"><input type="number" value={f.min??''} onChange={e=>set({min:e.target.value===''?undefined:Number(e.target.value)})}/></Field><Field label="Maximum"><input type="number" value={f.max??''} onChange={e=>set({max:e.target.value===''?undefined:Number(e.target.value)})}/></Field></>}
  {f.type==='currency'&&<Field label="Currency"><input value={f.currency||''} onChange={e=>set({currency:e.target.value.toUpperCase().slice(0,3)})}/></Field>}
  {f.type==='text'&&<Field label="Pattern (regular expression)"><input value={f.pattern||''} onChange={e=>set({pattern:e.target.value||undefined})}/></Field>}
  {f.type==='formula'&&<Field label="Formula" wide hint={`Use field keys: ${table.fields.filter(x=>x.key!==f.key).map(x=>x.key).join(', ')}. Functions: round, min, max, abs, if, concat.`}><input value={f.formula||''} onChange={e=>set({formula:e.target.value})}/></Field>}
  {f.type==='lookup'&&<Field label="Looks up table"><select value={f.lookupTable||''} onChange={e=>set({lookupTable:e.target.value})}>{def.tables.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>}
  {f.type==='relationship'&&<Field label="Linked record type" hint="Creates a Work Graph relationship."><select value={f.relation||''} onChange={e=>set({relation:e.target.value})}>{RELATION_TYPES.map(r=><option key={r}>{r}</option>)}</select></Field>}
  {f.type==='repeating'&&<Field label="Sub-fields (key:type per line)" wide><textarea rows={4} value={(f.subfields||[]).map(x=>`${x.key}:${x.type}`).join('\n')} onChange={e=>set({subfields:e.target.value.split('\n').map(l=>l.split(':').map(x=>x.trim())).filter(([k])=>k).map(([k,ty])=>({key:k,label:k.replace(/_/g,' '),type:((FIELD_TYPES as readonly string[]).includes(ty)?ty:'text') as FieldType}))})}/></Field>}
  {!['formula','autonumber','repeating','signature','file'].includes(f.type)&&<Field label="Default value"><FieldInput f={{...f,required:false}} value={f.default} app="" data={{}} onChange={v=>set({default:v===''?undefined:v})}/></Field>}
  <Field label="Show only when" wide><CondEditor value={f.showIf} fields={table.fields.filter(x=>x.key!==f.key)} onChange={c=>set({showIf:c})}/></Field>
  <Field label="Who can read" hint="Empty = everyone with table access."><TagPicker values={f.readRoles||[]} options={roles} onChange={v=>set({readRoles:v.length?v:undefined})} placeholder="Everyone"/></Field>
  <Field label="Who can change"><TagPicker values={f.writeRoles||[]} options={roles} onChange={v=>set({writeRoles:v.length?v:undefined})} placeholder="Everyone who can edit"/></Field>
 </div></Card>;
}

// Forms: sections and field order; conditional display comes from each field's rule.
function FormsTab({def,change}:{def:AppDef,change:Change}){
 const [fi,setFi]=useState(0);const f=def.forms[fi];const t=f&&def.tables.find(x=>x.key===f.table);
 const add=()=>{const tb=def.tables[0];if(!tb)return;change(d=>{d.forms.push({key:key(`${tb.key}_form`,d.forms.map(x=>x.key)),name:`New ${tb.name}`,table:tb.key,sections:[{title:'',fields:tb.fields.filter(x=>!['formula','autonumber'].includes(x.type)).map(x=>x.key)}],allowDraft:true})});setFi(def.forms.length)};
 return <div className="studio-split">
  <aside className="studio-list">{def.forms.map((x,i)=><button key={x.key} className={cx('studio-item',i===fi&&'on')} onClick={()=>setFi(i)}><Icon name="ClipboardPen" size={15}/>{x.name}</button>)}<Btn size="sm" icon="Plus" disabled={!def.tables.length} onClick={add}>Add form</Btn></aside>
  {!f?<Empty icon="ClipboardPen" title="No forms yet" action={<Btn icon="Plus" disabled={!def.tables.length} onClick={add}>Add form</Btn>}>Forms collect records for a table.</Empty>:<div className="studio-main">
   <div className="form-grid"><Field label="Form name"><input value={f.name} onChange={e=>change(d=>{d.forms[fi].name=e.target.value})}/></Field><Field label="Table"><select value={f.table} onChange={e=>change(d=>{d.forms[fi].table=e.target.value})}>{def.tables.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}</select></Field><Field label="Submit button"><input value={f.submitLabel||''} placeholder="Submit" onChange={e=>change(d=>{d.forms[fi].submitLabel=e.target.value||undefined})}/></Field><label className="check"><input type="checkbox" checked={f.allowDraft!==false} onChange={e=>change(d=>{d.forms[fi].allowDraft=e.target.checked})}/>Allow saving drafts</label>
    <Btn size="sm" variant="ghost" icon="Trash2" onClick={()=>{change(d=>{d.forms.splice(fi,1)});setFi(0)}}>Delete form</Btn></div>
   {f.sections.map((sec,si)=><Card key={si} title={<input aria-label="Section title" value={sec.title} placeholder="Section title" onChange={e=>change(d=>{d.forms[fi].sections[si].title=e.target.value})}/>} actions={<Btn size="sm" variant="ghost" icon="Trash2" title="Remove section" onClick={()=>change(d=>{d.forms[fi].sections.splice(si,1)})}/>}>
    <ul className="field-order">{sec.fields.map((k,i)=><li key={k}><Icon name="GripVertical" size={14}/>{t?.fields.find(x=>x.key===k)?.label||k}<span className="spacer"/><Btn size="sm" variant="ghost" icon="ArrowUp" title="Move up" disabled={!i} onClick={()=>change(d=>{const l=d.forms[fi].sections[si].fields;[l[i-1],l[i]]=[l[i],l[i-1]]})}/><Btn size="sm" variant="ghost" icon="X" title="Remove from form" onClick={()=>change(d=>{d.forms[fi].sections[si].fields.splice(i,1)})}/></li>)}</ul>
    <select aria-label="Add a field" value="" onChange={e=>{const k=e.target.value;if(k)change(d=>{d.forms[fi].sections[si].fields.push(k)})}}><option value="">+ Add a field…</option>{t?.fields.filter(x=>!f.sections.some(s=>s.fields.includes(x.key))).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select>
   </Card>)}
   <Btn size="sm" icon="Plus" onClick={()=>change(d=>{d.forms[fi].sections.push({title:'Section',fields:[]})})}>Add section</Btn>
  </div>}
 </div>;
}

// Workflows: states, transitions, approvals; drawn as a live state diagram and validated as you edit.
function Diagram({w}:{w:StudioWorkflow}){
 const cols=Math.min(5,Math.max(1,w.states.length));const pos=new Map(w.states.map((s,i)=>[s.id,{x:20+(i%cols)*150,y:20+Math.floor(i/cols)*90}]));const H=40+Math.ceil(w.states.length/cols)*90;
 return <svg className="wf-diagram" viewBox={`0 0 ${cols*150+20} ${H}`} role="img" aria-label="Workflow diagram"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="wf-arrow"/></marker></defs>
  {w.transitions.map(t=>{const a=pos.get(t.from),b=pos.get(t.to);if(!a||!b)return null;const x1=a.x+60,y1=a.y+18,x2=b.x+60,y2=b.y+18;const self=t.from===t.to;return <g key={t.id}>{self?<path d={`M${x1+40},${y1} c30,-30 30,30 0,10`} className="wf-edge" markerEnd="url(#arr)"/>:<line x1={x1} y1={y1} x2={x2+(x2>x1?-60:x2<x1?60:0)} y2={y2+(y2>y1?-18:y2<y1?18:0)} className={cx('wf-edge',!!t.approval?.stages?.length&&'approval')} markerEnd="url(#arr)"/>}<text x={(x1+x2)/2} y={(y1+y2)/2-4} className="wf-label">{t.label}{t.approval?.stages?.length?' ✓':''}</text></g>})}
  {w.states.map(s=>{const p=pos.get(s.id)!;return <g key={s.id}><rect x={p.x} y={p.y} width="120" height="36" rx="18" className={cx('wf-node',s.kind)}/><text x={p.x+60} y={p.y+22} textAnchor="middle" className="wf-node-text">{s.name}</text></g>})}
 </svg>;
}
function ApproverEditor({value,onChange}:{value:Approver[],onChange:(v:Approver[])=>void}){
 const {s}=useApp();
 return <div>{value.map((a,i)=><div key={i} className="row-gap"><select aria-label="Approver kind" value={a.kind} onChange={e=>onChange(value.map((x,j)=>j===i?{kind:e.target.value as Approver['kind']}:x))}>{['person','role','group','department_head','department','manager'].map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}</select>
  {a.kind==='person'&&<select aria-label="Person" value={a.value||''} onChange={e=>onChange(value.map((x,j)=>j===i?{...x,value:e.target.value}:x))}><option value="">Choose…</option>{s.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}
  {a.kind==='role'&&<select aria-label="Role" value={a.value||''} onChange={e=>onChange(value.map((x,j)=>j===i?{...x,value:e.target.value}:x))}><option value="">Choose…</option>{['admin','manager','employee',...s.roles.map(r=>r.id)].map(r=><option key={r}>{r}</option>)}</select>}
  {a.kind==='department'&&<select aria-label="Department" value={a.value||''} onChange={e=>onChange(value.map((x,j)=>j===i?{...x,value:e.target.value}:x))}><option value="">Choose…</option>{s.departments.map(d=><option key={d.name}>{d.name}</option>)}</select>}
  {a.kind==='group'&&<input aria-label="Group id" value={a.value||''} placeholder="Group id" onChange={e=>onChange(value.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/>}
  <Btn size="sm" variant="ghost" icon="X" title="Remove approver" onClick={()=>onChange(value.filter((_,j)=>j!==i))}/></div>)}
  <Btn size="sm" icon="Plus" onClick={()=>onChange([...value,{kind:'manager'}])}>Add approver</Btn></div>;
}
function StagesEditor({stages,fields,onChange}:{stages:ApprovalStage[],fields:StudioField[],onChange:(s:ApprovalStage[])=>void}){
 return <div className="stages">{stages.map((st,i)=><Card key={i} title={<input aria-label="Stage name" value={st.name} onChange={e=>onChange(stages.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>} actions={<Btn size="sm" variant="ghost" icon="Trash2" title="Remove stage" onClick={()=>onChange(stages.filter((_,j)=>j!==i))}/>}>
  <div className="form-grid"><Field label="Decision"><select value={st.mode} onChange={e=>onChange(stages.map((x,j)=>j===i?{...x,mode:e.target.value as ApprovalStage['mode']}:x))}><option value="any">Any one approver</option><option value="all">Everyone</option><option value="quorum">A quorum</option></select></Field>
   {st.mode==='quorum'&&<Field label="Quorum"><input type="number" min={1} value={st.quorum||1} onChange={e=>onChange(stages.map((x,j)=>j===i?{...x,quorum:Number(e.target.value)}:x))}/></Field>}
   <Field label="Escalate after (hours)"><input type="number" min={1} value={st.escalateAfterHours||''} onChange={e=>onChange(stages.map((x,j)=>j===i?{...x,escalateAfterHours:e.target.value?Number(e.target.value):undefined,escalateTo:x.escalateTo||{kind:'department_head'}}:x))}/></Field>
   <Field label="Only when" wide><CondEditor value={st.when} fields={fields} onChange={c=>onChange(stages.map((x,j)=>j===i?{...x,when:c}:x))}/></Field>
   <Field label="Approvers" wide><ApproverEditor value={st.approvers} onChange={v=>onChange(stages.map((x,j)=>j===i?{...x,approvers:v}:x))}/></Field></div></Card>)}
  <Btn size="sm" icon="Plus" onClick={()=>onChange([...stages,{name:`Stage ${stages.length+1}`,mode:'any',approvers:[{kind:'manager'}]}])}>Add approval stage</Btn></div>;
}
function WorkflowsTab({def,change}:{def:AppDef,change:Change}){
 const [wi,setWi]=useState(0);const w=def.workflows[wi];const t=w&&def.tables.find(x=>x.key===w.table);const [tri,setTri]=useState<number|null>(null);
 const add=()=>{const tb=def.tables[0];if(!tb)return;const k=key(`${tb.key}_flow`,def.workflows.map(x=>x.key));change(d=>{d.workflows.push({key:k,name:`${tb.name} workflow`,table:tb.key,states:[{id:'draft',name:'Draft',kind:'start'},{id:'review',name:'In review',kind:'normal'},{id:'approved',name:'Approved',kind:'end'},{id:'rejected',name:'Rejected',kind:'end'}],transitions:[{id:'submit',from:'draft',to:'review',label:'Submit'},{id:'approve',from:'review',to:'approved',label:'Approve',approval:{stages:[{name:'Manager approval',mode:'any',approvers:[{kind:'manager'}]}]}},{id:'reject',from:'review',to:'rejected',label:'Reject'}]});const tt=d.tables.find(x=>x.key===tb.key);if(tt&&!tt.workflow)tt.workflow=k});setWi(def.workflows.length)};
 const issues=w?validateWorkflow(w,t):[];const tr=w&&tri!==null?w.transitions[tri]:null;
 const setTr=(p:Partial<WfTransition>)=>change(d=>{Object.assign(d.workflows[wi].transitions[tri!],p)});
 return <div className="studio-split">
  <aside className="studio-list">{def.workflows.map((x,i)=><button key={x.key} className={cx('studio-item',i===wi&&'on')} onClick={()=>{setWi(i);setTri(null)}}><Icon name="Workflow" size={15}/>{x.name}</button>)}<Btn size="sm" icon="Plus" disabled={!def.tables.length} onClick={add}>Add workflow</Btn></aside>
  {!w?<Empty icon="Workflow" title="No workflows yet" action={<Btn icon="Plus" disabled={!def.tables.length} onClick={add}>Add workflow</Btn>}>Workflows move records through states with rules, approvals and actions.</Empty>:<div className="studio-main">
   <div className="form-grid"><Field label="Name"><input value={w.name} onChange={e=>change(d=>{d.workflows[wi].name=e.target.value})}/></Field><Field label="Table"><select value={w.table} onChange={e=>change(d=>{d.workflows[wi].table=e.target.value})}>{def.tables.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}</select></Field></div>
   <Diagram w={w}/>
   {issues.length>0?<IssueList issues={issues}/>:<Note tone="ok">This workflow is valid: every state is reachable and every path can finish.</Note>}
   <h3>States</h3>
   <div className="lb-table"><table className="plain"><tbody>{w.states.map((st,i)=><tr key={i}><td><input aria-label="State name" value={st.name} onChange={e=>change(d=>{d.workflows[wi].states[i].name=e.target.value})}/></td><td><input aria-label="State id" value={st.id} onChange={e=>change(d=>{const old=d.workflows[wi].states[i].id;d.workflows[wi].states[i].id=e.target.value;for(const x of d.workflows[wi].transitions){if(x.from===old)x.from=e.target.value;if(x.to===old)x.to=e.target.value}})}/></td><td><select aria-label="State kind" value={st.kind} onChange={e=>change(d=>{d.workflows[wi].states[i].kind=e.target.value as 'start'})}><option value="start">Start</option><option value="normal">Step</option><option value="end">End</option></select></td><td><Btn size="sm" variant="ghost" icon="Trash2" title="Remove state" onClick={()=>change(d=>{d.workflows[wi].states.splice(i,1)})}/></td></tr>)}</tbody></table></div>
   <Btn size="sm" icon="Plus" onClick={()=>change(d=>{d.workflows[wi].states.push({id:`state_${rid()}`,name:'New state',kind:'normal'})})}>Add state</Btn>
   <h3>Transitions</h3>
   <ul className="mini-list">{w.transitions.map((x,i)=><li key={x.id}><button className={cx('mini-row',tri===i&&'on')} onClick={()=>setTri(i)}><b>{x.label}</b><span>{w.states.find(s=>s.id===x.from)?.name||x.from} → {w.states.find(s=>s.id===x.to)?.name||x.to}{x.approval?.stages?.length?` · ${x.approval.stages.length} approval stage(s)`:''}{x.actions?.length?` · ${x.actions.length} action(s)`:''}{x.timerHours?` · after ${x.timerHours}h`:''}</span></button></li>)}</ul>
   <Btn size="sm" icon="Plus" onClick={()=>{change(d=>{const s=d.workflows[wi].states;d.workflows[wi].transitions.push({id:`t_${rid()}`,from:s[0]?.id||'',to:s[1]?.id||'',label:'Next'})});setTri(w.transitions.length)}}>Add transition</Btn>
   {tr&&<Card title={`Transition: ${tr.label}`} actions={<Btn size="sm" variant="ghost" icon="Trash2" onClick={()=>{change(d=>{d.workflows[wi].transitions.splice(tri!,1)});setTri(null)}}>Remove</Btn>}><div className="form-grid">
    <Field label="Button label"><input value={tr.label} onChange={e=>setTr({label:e.target.value})}/></Field>
    <Field label="From"><select value={tr.from} onChange={e=>setTr({from:e.target.value})}>{w.states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <Field label="To"><select value={tr.to} onChange={e=>setTr({to:e.target.value})}>{w.states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
    <Field label="Automatic after (hours)" hint="Timer transitions run on their own."><input type="number" min={1} value={tr.timerHours||''} onChange={e=>setTr({timerHours:e.target.value?Number(e.target.value):undefined})}/></Field>
    <Field label="Branch"><select value={tr.branch||'default'} onChange={e=>setTr({branch:e.target.value as 'default'})}><option value="default">When condition holds</option><option value="else">Otherwise (else)</option></select></Field>
    <Field label="Who can use it"><TagPicker values={tr.roles||[]} options={['admin','manager','employee','viewer','__owner__']} onChange={v=>setTr({roles:v.length?v:undefined})} placeholder="Anyone who can edit"/></Field>
    <Field label="Condition" wide><CondEditor value={tr.condition} fields={t?.fields||[]} onChange={c=>setTr({condition:c})}/></Field>
    <Field label="Required fields" wide><TagPicker values={tr.requiredFields||[]} options={(t?.fields||[]).map(f=>f.key)} onChange={v=>setTr({requiredFields:v})} placeholder="None"/></Field>
    <Field label="Approval" wide><StagesEditor stages={tr.approval?.stages||[]} fields={t?.fields||[]} onChange={s=>setTr({approval:s.length?{stages:s}:undefined})}/></Field>
    <Field label="Actions when it happens" wide><ActionsEditor actions={tr.actions||[]} def={def} onChange={a=>setTr({actions:a})}/></Field>
   </div></Card>}
  </div>}
 </div>;
}

// Automation actions shared by workflows and automations.
function ActionsEditor({actions,def,onChange}:{actions:WfAction[],def:AppDef,onChange:(a:WfAction[])=>void}){
 const {s}=useApp();const agents=useApi<{agents:{id:string,name:string}[]}>('/api/agents');const cons=useApi<{connectors:{id:string,name:string}[]}>('/api/connectors');
 const set=(i:number,p:Record<string,unknown>)=>onChange(actions.map((a,j)=>j===i?{...a,...p}:a));
 return <div className="actions-ed">{actions.map((a,i)=><div key={i} className="action-row"><select aria-label="Action" value={a.type} onChange={e=>onChange(actions.map((x,j)=>j===i?{type:e.target.value as WfAction['type']}:x))}>{ACTIONS.map(x=><option key={x} value={x}>{x.replace(/_/g,' ')}</option>)}</select>
  {a.type==='notify'&&<><select aria-label="Notify" value={String(a.to||'owner')} onChange={e=>set(i,{to:e.target.value})}><option value="owner">Record owner</option><option value="manager">Owner’s manager</option><option value="department_head">Department head</option><option value="role:admin">Administrators</option>{s.people.map(p=><option key={p.id} value={`person:${p.id}`}>{p.name}</option>)}</select><input aria-label="Message" placeholder="Message ({{title}} is replaced)" value={String(a.message||'')} onChange={e=>set(i,{message:e.target.value})}/></>}
  {(a.type==='create_record'||a.type==='update_record')&&<><select aria-label="Table" value={String(a.table||'')} onChange={e=>set(i,{table:e.target.value})}><option value="">Table…</option>{def.tables.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select><input aria-label="Values" placeholder='Values as JSON, e.g. {"title":"{{title}}"}' value={typeof a.values==='string'?a.values:JSON.stringify(a.values||{})} onChange={e=>{try{set(i,{values:JSON.parse(e.target.value)})}catch{set(i,{values:e.target.value})}}}/></>}
  {a.type==='set_status'&&<input aria-label="Status" placeholder="State id" value={String(a.status||'')} onChange={e=>set(i,{status:e.target.value})}/>}
  {a.type==='create_task'&&<><input aria-label="Task title" placeholder="Task title ({{title}})" value={String(a.title||'')} onChange={e=>set(i,{title:e.target.value})}/><select aria-label="Assign to" value={String(a.assignee||'owner')} onChange={e=>set(i,{assignee:e.target.value})}><option value="owner">Record owner</option><option value="manager">Owner’s manager</option>{s.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label="Due in days" type="number" min={0} placeholder="Due in days" value={String(a.dueDays??'')} onChange={e=>set(i,{dueDays:e.target.value?Number(e.target.value):undefined})}/></>}
  {a.type==='post_message'&&<><input aria-label="Channel id" placeholder="Channel id" value={String(a.channelId||'')} onChange={e=>set(i,{channelId:e.target.value})}/><input aria-label="Message" placeholder="Message" value={String(a.message||'')} onChange={e=>set(i,{message:e.target.value})}/></>}
  {a.type==='connector_action'&&<><select aria-label="Connector" value={String(a.connectorId||'')} onChange={e=>set(i,{connectorId:e.target.value})}><option value="">Connector…</option>{(cons.data?.connectors||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input aria-label="Connector action" placeholder="Action id (e.g. send_mail)" value={String(a.action||'')} onChange={e=>set(i,{action:e.target.value})}/><input aria-label="Input" placeholder="Input as JSON" value={typeof a.input==='string'?a.input:JSON.stringify(a.input||{})} onChange={e=>{try{set(i,{input:JSON.parse(e.target.value)})}catch{set(i,{input:e.target.value})}}}/></>}
  {a.type==='run_agent'&&<><select aria-label="Agent" value={String(a.agentId||'')} onChange={e=>set(i,{agentId:e.target.value})}><option value="">Agent…</option>{(agents.data?.agents||[]).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><input aria-label="Instruction" placeholder="What should the agent do?" value={String(a.prompt||'')} onChange={e=>set(i,{prompt:e.target.value})}/></>}
  {a.type==='request_approval'&&<StagesEditor stages={(a.stages as ApprovalStage[])||[]} fields={[]} onChange={st=>set(i,{stages:st})}/>}
  {a.type==='add_relationship'&&<><input aria-label="Related type" placeholder="Record type (project, asset…)" value={String(a.toType||'')} onChange={e=>set(i,{toType:e.target.value})}/><input aria-label="Related id field" placeholder="Field holding the id" value={String(a.toField||'')} onChange={e=>set(i,{toField:e.target.value})}/><input aria-label="Relationship" placeholder="related_to" value={String(a.relationship||'')} onChange={e=>set(i,{relationship:e.target.value})}/></>}
  <Btn size="sm" variant="ghost" icon="X" title="Remove action" onClick={()=>onChange(actions.filter((_,j)=>j!==i))}/></div>)}
  <Btn size="sm" icon="Plus" onClick={()=>onChange([...actions,{type:'notify',to:'owner',message:'{{title}} was updated'}])}>Add action</Btn></div>;
}

// Automations: trigger → conditions → actions. Natural-language drafting creates DISABLED drafts only.
function AutomationsTab({app,def,change,dirty,save,reload}:{app:AppSum,def:AppDef,change:Change,dirty:boolean,save:()=>Promise<unknown>,reload:()=>void}){
 const {toast}=useApp();const [ai,setAi]=useState('');const [busy,setBusy]=useState('');const [drafts,setDrafts]=useState<{automation:Automation,diagram:string[],permissions:string[]}[]|null>(null);const [ai_note,setNote]=useState('');
 const [sel,setSel]=useState<number|null>(null);const [dry,setDry]=useState<{conditions:{condition:string,passed:boolean}[],wouldRun:boolean,log:unknown[]}|null>(null);const [sample,setSample]=useState('{"title":"Sample","amount":6000}');
 const runs=useApi<{runs:{id:string,automationId:string,version:number,trigger:string,status:string,dryRun:boolean,error:string,attempts:number,startedAt:string,output:unknown}[]}>(`/api/studio?view=runs&app=${app.id}`);
 const au=sel!==null?def.automations[sel]:null;const table=def.tables.find(t=>t.key===au?.trigger.table)||def.tables[0];
 const setAu=(p:Partial<Automation>)=>change(d=>{Object.assign(d.automations[sel!],p)});
 const generate=async()=>{setBusy('ai');try{const r=await api<{drafts:typeof drafts,note:string}>('/api/studio',{action:'generate-automation',id:app.id,text:ai});setDrafts(r.drafts);setNote(r.note)}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}};
 return <div>
  <Card title="Describe an automation" actions={<Chip tone="violet">AI drafts are disabled until you publish</Chip>}>
   <div className="row-gap"><input className="grow" value={ai} onChange={e=>setAi(e.target.value)} placeholder="When a purchase request above 5,000 is submitted, ask the department head, then finance, and notify the requester after approval."/><Btn icon="Sparkles" busy={busy==='ai'} disabled={ai.trim().length<10} onClick={generate}>Draft it</Btn></div>
   {drafts&&<div className="ai-drafts">{ai_note&&<Note>{ai_note}</Note>}{drafts.map((d,i)=><Card key={i} title={d.automation.name} actions={<Btn size="sm" variant="primary" icon="Plus" onClick={()=>{change(x=>{x.automations.push({...d.automation,enabled:false})});setDrafts(ds=>ds!.filter((_,j)=>j!==i));toast('Added as a disabled draft. Review and save.')}}>Add as draft</Btn>}>
    <ol className="wf-steps vertical">{d.diagram.map((s,j)=><li key={j}>{s}</li>)}</ol>{d.automation.explanation&&<p className="muted small">{d.automation.explanation}</p>}<small className="muted">Needs: {d.permissions.join(' · ')}</small></Card>)}</div>}
  </Card>
  <div className="studio-split">
   <aside className="studio-list">{def.automations.map((x,i)=><button key={x.id} className={cx('studio-item',i===sel&&'on')} onClick={()=>{setSel(i);setDry(null)}}><Icon name="Zap" size={15}/>{x.name}<small>{x.enabled?(app.paused.includes(x.id)?'paused':'on'):'draft (off)'}{x.generatedBy==='ai'?' · AI':''}</small></button>)}
    <Btn size="sm" icon="Plus" onClick={()=>{change(d=>{d.automations.push({id:`a_${rid()}`,name:'New automation',trigger:{type:'record_created',table:def.tables[0]?.key},conditions:[],actions:[{type:'notify',to:'owner',message:'{{title}} was created'}],enabled:false,generatedBy:'human'})});setSel(def.automations.length)}}>Add automation</Btn></aside>
   {!au?<Empty icon="Zap" title="Choose or create an automation">Automations run when something happens (a record, approval, file, connector, schedule or date) and perform actions with the workflow’s identity.</Empty>:<div className="studio-main">
    <div className="form-grid"><Field label="Name"><input value={au.name} onChange={e=>setAu({name:e.target.value})}/></Field>
     <label className="check"><input type="checkbox" checked={au.enabled} onChange={e=>setAu({enabled:e.target.checked})}/>Enabled when published</label>
     {app.publishedVersion&&<Btn size="sm" icon={app.paused.includes(au.id)?'Play':'Pause'} onClick={async()=>{try{await api('/api/studio',{action:app.paused.includes(au.id)?'resume-automation':'pause-automation',id:app.id,automationId:au.id});toast('Updated');reload()}catch(e){toast((e as Error).message,'error')}}}>{app.paused.includes(au.id)?'Resume in live app':'Pause in live app'}</Btn>}
     <Btn size="sm" variant="ghost" icon="Trash2" onClick={()=>{change(d=>{d.automations.splice(sel!,1)});setSel(null)}}>Delete</Btn></div>
    <h3>When</h3><div className="form-grid"><Field label="Trigger"><select value={au.trigger.type} onChange={e=>setAu({trigger:{...au.trigger,type:e.target.value as Automation['trigger']['type']}})}>{TRIGGERS.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}</select></Field>
     {['record_created','record_updated','status_changed','date_reached'].includes(au.trigger.type)&&<Field label="Table"><select value={au.trigger.table||''} onChange={e=>setAu({trigger:{...au.trigger,table:e.target.value}})}>{def.tables.map(t=><option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>}
     {au.trigger.type==='status_changed'&&<Field label="To status"><input value={au.trigger.toStatus||''} onChange={e=>setAu({trigger:{...au.trigger,toStatus:e.target.value||undefined}})}/></Field>}
     {au.trigger.type==='schedule'&&<Field label="Every"><select value={au.trigger.schedule||'daily'} onChange={e=>setAu({trigger:{...au.trigger,schedule:e.target.value as 'daily'}})}><option value="hourly">Hour</option><option value="daily">Day</option><option value="weekly">Week</option></select></Field>}
     {au.trigger.type==='date_reached'&&<Field label="Date field"><select value={au.trigger.field||''} onChange={e=>setAu({trigger:{...au.trigger,field:e.target.value}})}>{table?.fields.filter(f=>['date','datetime'].includes(f.type)).map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>}
     {au.trigger.type==='module_event'&&<><Field label="Module"><input value={au.trigger.module||''} placeholder="e.g. Purchasing" onChange={e=>setAu({trigger:{...au.trigger,module:e.target.value}})}/></Field><Field label="Action contains"><input value={au.trigger.action||''} onChange={e=>setAu({trigger:{...au.trigger,action:e.target.value}})}/></Field></>}
     {au.trigger.type==='budget_threshold'&&<Field label="Percent of budget"><input type="number" value={au.trigger.percent||80} onChange={e=>setAu({trigger:{...au.trigger,percent:Number(e.target.value)}})}/></Field>}
     {['connector_event','webhook_received'].includes(au.trigger.type)&&<Field label="Connector id"><input value={au.trigger.connectorId||''} onChange={e=>setAu({trigger:{...au.trigger,connectorId:e.target.value}})}/></Field>}
     {au.trigger.type==='approval_completed'&&<Field label="After automation (optional)"><select value={au.trigger.automationId||''} onChange={e=>setAu({trigger:{...au.trigger,automationId:e.target.value||undefined}})}><option value="">Any approval</option>{def.automations.filter(x=>x.id!==au.id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
    </div>
    <h3>Only if</h3>{au.conditions.map((c,i)=><div key={i} className="row-gap"><CondEditor value={c} fields={[...(table?.fields||[]),{key:'amount',label:'amount',type:'number'},{key:'department',label:'department',type:'text'}]} onChange={nc=>setAu({conditions:nc?au.conditions.map((x,j)=>j===i?nc:x):au.conditions.filter((_,j)=>j!==i)})}/></div>)}<Btn size="sm" icon="Plus" onClick={()=>setAu({conditions:[...au.conditions,{field:table?.fields[0]?.key||'amount',op:'gt',value:''}]})}>Add condition</Btn>
    <h3>Then</h3><ActionsEditor actions={au.actions} def={def} onChange={a=>setAu({actions:a})}/>
    <Card title="Dry run" actions={<Btn size="sm" icon="Play" busy={busy==='dry'} onClick={async()=>{if(dirty)await save();setBusy('dry');try{setDry(await api('/api/studio',{action:'dry-run',id:app.id,automationId:au.id,sample:JSON.parse(sample)}))}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}}}>Test with sample</Btn>}>
     <Field label="Sample record (JSON)"><textarea rows={3} value={sample} onChange={e=>setSample(e.target.value)}/></Field>
     {dry&&<><ul>{dry.conditions.map((c,i)=><li key={i}>{c.passed?'✓':'✗'} {c.condition}</li>)}</ul><p><b>{dry.wouldRun?'Would run':'Would not run'}</b> — nothing was changed.</p>{dry.log.length>0&&<pre className="code small">{JSON.stringify(dry.log,null,1)}</pre>}</>}</Card>
   </div>}
  </div>
  <Card title="Run history" actions={<Btn size="sm" variant="ghost" icon="RefreshCw" onClick={runs.reload}>Refresh</Btn>}>{!runs.data?<Skeleton rows={3}/>:!runs.data.runs.length?<p className="muted small">No runs yet.</p>:<div className="lb-table"><table className="plain"><thead><tr><th>When</th><th>Automation</th><th>Trigger</th><th>Status</th><th>Attempts</th><th/></tr></thead><tbody>{runs.data.runs.slice(0,50).map(r=><tr key={r.id}><td>{dateTime(r.startedAt)}</td><td>{def.automations.find(x=>x.id===r.automationId)?.name||r.automationId} <small className="muted">v{r.version}</small></td><td>{r.trigger}{r.dryRun&&' (dry run)'}</td><td><Chip tone={r.status==='succeeded'?'green':r.status==='failed'?'red':'amber'}>{r.status}</Chip>{r.error&&<small className="muted"> {r.error}</small>}</td><td>{r.attempts}</td><td>{['failed','blocked'].includes(r.status)&&<Btn size="sm" icon="RotateCcw" onClick={async()=>{try{await api('/api/studio',{action:'retry-run',runId:r.id});toast('Retry queued');runs.reload()}catch(e){toast((e as Error).message,'error')}}}>Retry</Btn>}</td></tr>)}</tbody></table></div>}</Card>
 </div>;
}

function ReportsTab({def,change}:{def:AppDef,change:Change}){
 const [ri,setRi]=useState(0);const r=def.reports[ri];const t=r?.source.kind==='table'?def.tables.find(x=>x.key===r.source.id):undefined;
 const set=(p:Partial<StudioReport>)=>change(d=>{Object.assign(d.reports[ri],p)});
 return <div className="studio-split">
  <aside className="studio-list">{def.reports.map((x,i)=><button key={x.key} className={cx('studio-item',i===ri&&'on')} onClick={()=>setRi(i)}><Icon name="ChartPie" size={15}/>{x.name}<small>{x.chart}</small></button>)}<Btn size="sm" icon="Plus" onClick={()=>{change(d=>{d.reports.push({key:key('report',d.reports.map(x=>x.key)),name:'New report',source:{kind:'table',id:d.tables[0]?.key||''},groupBy:'status',measure:{op:'count'},chart:'bar'})});setRi(def.reports.length)}}>Add report</Btn></aside>
  {!r?<Empty icon="ChartPie" title="No reports yet">Reports and dashboard charts over app tables or company modules, with the viewer’s permissions.</Empty>:<div className="studio-main"><div className="form-grid">
   <Field label="Name"><input value={r.name} onChange={e=>set({name:e.target.value})}/></Field>
   <Field label="Source"><select value={`${r.source.kind}:${r.source.id}`} onChange={e=>{const [kind,id]=e.target.value.split(':');set({source:{kind:kind as 'table',id}})}}>{def.tables.map(x=><option key={x.key} value={`table:${x.key}`}>App table: {x.name}</option>)}{['tickets','assets','requisitions','orders','work_orders','inventory','projects','tasks','people','files'].map(m=><option key={m} value={`module:${m}`}>Module: {m}</option>)}</select></Field>
   <Field label="Chart"><select value={r.chart} onChange={e=>set({chart:e.target.value as StudioReport['chart']})}>{CHARTS.map(c=><option key={c}>{c}</option>)}</select></Field>
   <Field label="Group by"><input list="rep-fields" value={r.groupBy||''} onChange={e=>set({groupBy:e.target.value||undefined})}/></Field>
   {r.chart==='pivot'&&<Field label="Columns"><input list="rep-fields" value={r.column||''} onChange={e=>set({column:e.target.value||undefined})}/></Field>}
   {['line','area','timeline','calendar'].includes(r.chart)&&<Field label="Date field"><input list="rep-fields" value={r.dateField||''} onChange={e=>set({dateField:e.target.value||undefined})}/></Field>}
   <Field label="Measure"><select value={r.measure.op} onChange={e=>set({measure:{...r.measure,op:e.target.value as 'count'}})}><option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option></select></Field>
   {r.measure.op!=='count'&&<Field label="Of field"><input list="rep-fields" value={r.measure.field||''} onChange={e=>set({measure:{...r.measure,field:e.target.value}})}/></Field>}
   <datalist id="rep-fields">{(t?.fields||[]).map(f=><option key={f.key} value={f.key}/>)}<option value="status"/><option value="department"/><option value="priority"/><option value="category"/></datalist>
   <Field label="Who can see"><TagPicker values={r.roles||[]} options={['admin','manager','employee','viewer']} onChange={v=>set({roles:v.length?v:undefined})} placeholder="Everyone with app access"/></Field>
   <Field label="Who can export"><TagPicker values={r.exportRoles||[]} options={['admin','manager','employee']} onChange={v=>set({exportRoles:v.length?v:undefined})} placeholder="Admins and managers"/></Field>
   <Field label="Email a summary"><select value={r.schedule?.frequency||''} onChange={e=>set({schedule:e.target.value?{frequency:e.target.value as 'daily',recipients:r.schedule?.recipients||[{kind:'role',value:'admin'}]}:undefined})}><option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>
   <Field label="Filters" wide>{(r.filters||[]).map((c,i)=><CondEditor key={i} value={c} fields={t?.fields||[]} onChange={nc=>set({filters:nc?(r.filters||[]).map((x,j)=>j===i?nc:x):(r.filters||[]).filter((_,j)=>j!==i)})}/>)}<Btn size="sm" icon="Plus" onClick={()=>set({filters:[...(r.filters||[]),{field:t?.fields[0]?.key||'status',op:'eq',value:''}]})}>Add filter</Btn></Field>
   <Btn size="sm" variant="ghost" icon="Trash2" onClick={()=>{change(d=>{d.reports.splice(ri,1)});setRi(0)}}>Delete report</Btn>
  </div><Note>Publish the app to see live results; the Preview tab shows the draft with sample data you create.</Note></div>}
 </div>;
}
function NavTab({def,change,meta,setMeta}:{def:AppDef,change:Change,meta:{name:string,description:string,icon:string},setMeta:(m:{name:string,description:string,icon:string})=>void}){
 const pages=useApi<{pages:{id:string,title:string,status:string}[]}>('/api/app-pages');
 const targets=[...def.tables.map(t=>({kind:'table' as const,ref:t.key,label:t.name})),...def.forms.map(f=>({kind:'form' as const,ref:f.key,label:f.name})),...def.reports.map(r=>({kind:'report' as const,ref:r.key,label:r.name})),...(pages.data?.pages||[]).map(p=>({kind:'page' as const,ref:p.id,label:`Page: ${p.title}`}))];
 return <div className="studio-main">
  <div className="form-grid"><Field label="App name"><input value={meta.name} onChange={e=>setMeta({...meta,name:e.target.value})}/></Field><Field label="Description"><input value={meta.description} onChange={e=>setMeta({...meta,description:e.target.value})}/></Field><Field label="Icon"><input value={meta.icon} onChange={e=>setMeta({...meta,icon:e.target.value})}/></Field></div>
  <h3>Navigation</h3><p className="muted small">Order of the app’s menu. Pages link to page-builder pages (build them in <a href="#/pages">Pages</a> with Studio form, table and report widgets).</p>
  <ul className="field-order">{def.nav.map((n,i)=><li key={i}><input aria-label="Menu label" value={n.label} onChange={e=>change(d=>{d.nav[i].label=e.target.value})}/><small className="muted">{n.kind}: {n.ref}</small><span className="spacer"/><Btn size="sm" variant="ghost" icon="ArrowUp" disabled={!i} title="Move up" onClick={()=>change(d=>{[d.nav[i-1],d.nav[i]]=[d.nav[i],d.nav[i-1]]})}/><Btn size="sm" variant="ghost" icon="X" title="Remove" onClick={()=>change(d=>{d.nav.splice(i,1)})}/></li>)}</ul>
  <select aria-label="Add menu item" value="" onChange={e=>{const t=targets.find(x=>`${x.kind}:${x.ref}`===e.target.value);if(t)change(d=>{d.nav.push({label:t.label.replace(/^Page: /,''),kind:t.kind,ref:t.ref});if(t.kind==='page'&&!d.pages.some(p=>p.id===t.ref))d.pages.push({id:t.ref,title:t.label.replace(/^Page: /,'')})})}}><option value="">+ Add a menu item…</option>{targets.map(t=><option key={`${t.kind}:${t.ref}`} value={`${t.kind}:${t.ref}`}>{t.label}</option>)}</select>
 </div>;
}
function PermissionsTab({def,change}:{def:AppDef,change:Change}){
 const {s}=useApp();const roles=[...new Set(['admin','manager','employee','viewer',...s.roles.map(r=>r.id),'__owner__'])];
 return <div className="studio-main">
  <div className="form-grid"><Field label="Who can use the app" hint="Empty = everyone with Studio access."><TagPicker values={def.permissions.use} options={roles} onChange={v=>change(d=>{d.permissions.use=v})} placeholder="Everyone"/></Field>
   <Field label="App administrators"><TagPicker values={def.permissions.admin} options={roles} onChange={v=>change(d=>{d.permissions.admin=v})} placeholder="Workspace administrators"/></Field>
   <label className="check"><input type="checkbox" checked={!!def.settings.requiresApproval} onChange={e=>change(d=>{d.settings.requiresApproval=e.target.checked})}/>Publishing requires approval by another administrator</label></div>
  {def.tables.map((t,ti)=><Card key={t.key} title={`Table: ${t.name}`}><div className="form-grid">{(['view','create','edit','delete'] as const).map(p=><Field key={p} label={`Can ${p}`}><TagPicker values={t.permissions[p]} options={roles} onChange={v=>change(d=>{d.tables[ti].permissions[p]=v})} placeholder="Everyone with app access"/></Field>)}
   <Field label="Record scope"><select value={t.permissions.scope} onChange={e=>change(d=>{d.tables[ti].permissions.scope=e.target.value as 'all'})}><option value="all">All records</option><option value="department">Own department</option><option value="own">Only their own</option></select></Field></div></Card>)}
 </div>;
}
function VersionsTab({data,call}:{data:AppData,call:(a:string,x?:Record<string,unknown>,m?:string)=>Promise<unknown>}){
 const {ask}=useApp();const a=data.app;
 return <div className="studio-main">
  <div className="row-gap">{a.status!=='deprecated'&&a.status!=='archived'&&a.publishedVersion&&<Btn icon="CircleSlash" onClick={()=>call('deprecate',{},'Deprecated')}>Deprecate</Btn>}{a.status!=='archived'?<Btn icon="Archive" onClick={async()=>{if(await ask({title:'Archive this app?',body:'People can no longer use it. Records are kept and it can be restored.',confirm:'Archive',danger:true})!==false)call('archive',{},'Archived')}}>Archive</Btn>:<Btn icon="ArchiveRestore" onClick={()=>call('restore',{},'Restored')}>Restore</Btn>}
   <Btn icon="LayoutTemplate" onClick={async()=>{const name=await ask({title:'Save as a company template',input:{label:'Template name',required:true},confirm:'Save'});if(name)call('save-template',{name},'Template saved')}}>Save as template</Btn></div>
  <div className="lb-table"><table className="plain"><thead><tr><th>Version</th><th>Note</th><th>Published</th><th/></tr></thead><tbody>{data.versions.map(v=><tr key={v.version}><td>v{v.version}{v.version===a.publishedVersion&&<> <Chip tone="green">live</Chip></>}</td><td>{v.note}</td><td>{dateTime(v.createdAt)}</td><td>{v.version!==a.publishedVersion&&<Btn size="sm" icon="RotateCcw" onClick={async()=>{if(await ask({title:`Roll back to v${v.version}?`,body:'This publishes a new version with that definition. Records are kept.',confirm:'Roll back'})!==false)call('rollback',{version:v.version},'Rolled back')}}>Roll back</Btn>}</td></tr>)}{!data.versions.length&&<tr><td colSpan={4} className="muted">Not published yet.</td></tr>}</tbody></table></div>
 </div>;
}
function PreviewTab({app,def,dirty}:{app:AppSum,def:AppDef,dirty:boolean}){
 const [t,setT]=useState(def.tables[0]?.key||'');const [f,setF]=useState<string>('');
 return <div className="studio-main">{dirty&&<Note tone="warn">Save the draft to preview your latest changes.</Note>}<Note>Preview runs the saved draft with your permissions. Records created here are stored as preview records of this app.</Note>
  <div className="row-gap"><select aria-label="Table" value={t} onChange={e=>setT(e.target.value)}>{def.tables.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}</select><select aria-label="Form" value={f} onChange={e=>setF(e.target.value)}><option value="">Table view</option>{def.forms.map(x=><option key={x.key} value={x.key}>Form: {x.name}</option>)}</select></div>
  {f?(()=>{const form=def.forms.find(x=>x.key===f)!;const tb=def.tables.find(x=>x.key===form.table)!;return <Card title={form.name}><RecordForm app={app.id} def={def} form={form} table={tb} preview onDone={()=>setF('')}/></Card>})():t&&<TableView app={app.id} def={def} tableKey={t} preview/>}
  {def.reports.map(r=><div key={r.key}>{app.publishedVersion&&<ReportView app={app.id} reportKey={r.key}/>}</div>)}
 </div>;
}

// ── Templates, reusable widgets, module extensions, approvals, usage ──
function Templates(){
 const {toast,ask}=useApp();const {data,reload}=useApi<{templates:{id:string,name:string,description:string,scope:string,tables:number,workflows:number,automations:number,createdAt:string}[]}>('/api/studio?view=templates');const [use,setUse]=useState<string|null>(null);
 return <div className="page"><Header icon="LayoutTemplate" tone="violet" title="Studio templates" subtitle="Reusable app definitions from your company and the platform."/>
  {!data?<Skeleton/>:!data.templates.length?<Empty icon="LayoutTemplate" title="No templates yet">Save any app as a template from its Versions tab.</Empty>:<div className="module-grid">{data.templates.map(t=><div key={t.id} className="module-card"><Icon name="LayoutTemplate" size={20}/><div><b>{t.name} {t.scope==='platform'&&<Chip tone="violet">Platform</Chip>}</b><small>{t.description||'—'}</small><small className="muted">{t.tables} tables · {t.workflows} workflows · {t.automations} automations</small><div className="row-gap"><Btn size="sm" variant="primary" onClick={()=>setUse(t.id)}>Use</Btn>{t.scope==='company'&&<Btn size="sm" variant="ghost" icon="Trash2" onClick={async()=>{if(await ask({title:`Delete template ${t.name}?`,confirm:'Delete',danger:true})!==false){await api('/api/studio',{action:'delete-template',id:t.id}).catch(e=>toast((e as Error).message,'error'));reload()}}}/>}</div></div></div>)}</div>}
  {use&&<CreateApp templateId={use} onClose={()=>setUse(null)}/>}</div>;
}
function Widgets(){
 const {toast}=useApp();const {data,reload}=useApi<{widgets:{id:string,name:string,description:string,baseType:string,config:Record<string,unknown>}[],registry:{type:string,label:string,category:string,description:string,fields:string[]}[]}>('/api/studio?view=widgets');
 const [edit,setEdit]=useState<{id?:string,name:string,description:string,baseType:string,config:string}|null>(null);
 return <div className="page"><Header icon="Puzzle" tone="violet" title="Reusable widgets" subtitle="Preset widgets (approved types with saved settings) that page builders can drop onto any page." actions={<Btn variant="primary" icon="Plus" onClick={()=>setEdit({name:'',description:'',baseType:'table',config:'{"source":"tickets","limit":5}'})}>New preset</Btn>}/>
  {!data?<Skeleton/>:<><div className="module-grid">{data.widgets.map(w=><div key={w.id} className="module-card"><Icon name="Puzzle" size={18}/><div><b>{w.name}</b><small>{w.description||w.baseType}</small><div className="row-gap"><Btn size="sm" onClick={()=>setEdit({id:w.id,name:w.name,description:w.description,baseType:w.baseType,config:JSON.stringify(w.config)})}>Edit</Btn><Btn size="sm" variant="ghost" icon="Trash2" onClick={async()=>{await api('/api/studio',{action:'widget-delete',id:w.id});reload()}}/></div></div></div>)}{!data.widgets.length&&<p className="muted">No presets yet.</p>}</div>
   <Card title="Approved widget types">{[...new Set(data.registry.map(r=>r.category))].map(c=><div key={c}><p className="rail-section">{c}</p><div className="row-gap wrap">{data.registry.filter(r=>r.category===c).map(r=><Chip key={r.type} tone="gray">{r.label}</Chip>)}</div></div>)}</Card></>}
  {edit&&<Modal open onClose={()=>setEdit(null)} title={edit.id?'Edit preset':'New widget preset'} footer={<Btn variant="primary" onClick={async()=>{try{await api('/api/studio',{action:'widget-save',id:edit.id,name:edit.name,description:edit.description,baseType:edit.baseType,config:JSON.parse(edit.config)});toast('Saved');setEdit(null);reload()}catch(e){toast((e as Error).message,'error')}}}>Save</Btn>}>
   <Field label="Name"><input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></Field><Field label="Description"><input value={edit.description} onChange={e=>setEdit({...edit,description:e.target.value})}/></Field>
   <Field label="Widget type"><select value={edit.baseType} onChange={e=>setEdit({...edit,baseType:e.target.value})}>{data?.registry.map(r=><option key={r.type} value={r.type}>{r.label}</option>)}</select></Field>
   <Field label="Settings (JSON)" hint={`Keys: ${data?.registry.find(r=>r.type===edit.baseType)?.fields.join(', ')}`}><textarea rows={5} value={edit.config} onChange={e=>setEdit({...edit,config:e.target.value})}/></Field></Modal>}
 </div>;
}
const EXT_TYPES=[['ticket','Tickets'],['asset','Assets'],['project','Projects'],['task','Tasks'],['PR','Requisitions'],['PO','Purchase orders'],['vendor','Vendors'],['person','People'],['work_order','Work orders']];
function Extensions(){
 const {toast}=useApp();const {data,reload}=useApi<{extensions:{entityType:string,fields:StudioField[],stages:string[],version:number,updatedAt:string}[],canEdit:boolean}>('/api/studio?view=extensions');
 const [type,setType]=useState('asset');const cur=data?.extensions.find(e=>e.entityType===type);const [fields,setFields]=useState<StudioField[]>([]);const [stages,setStages]=useState('');const [fi,setFi]=useState<number|null>(null);
 useEffect(()=>{setFields(cur?.fields||[]);setStages((cur?.stages||[]).join('\n'));setFi(null)},[cur,type]);
 const table:StudioTable={key:'ext',name:'Extension',fields,titleField:fields[0]?.key||'',permissions:{view:[],create:[],edit:[],delete:[],scope:'all'}};
 return <div className="page"><Header icon="Blocks" tone="violet" title="Custom fields for built-in modules" subtitle="Add fields and stages to tickets, assets, projects, tasks, purchasing, vendors, people and work orders. They appear on each record page and in the Work Graph."/>
  <div className="row-gap"><select aria-label="Module" value={type} onChange={e=>setType(e.target.value)}>{EXT_TYPES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>{cur&&<small className="muted">v{cur.version} · {ago(cur.updatedAt)}</small>}</div>
  <div className="lb-table"><table className="plain"><tbody>{fields.map((f,i)=><tr key={i}><td><button className="link" onClick={()=>setFi(i)}>{f.label}</button></td><td>{FIELD_LABELS[f.type]}</td><td><Btn size="sm" variant="ghost" icon="Trash2" onClick={()=>setFields(fields.filter((_,j)=>j!==i))}/></td></tr>)}</tbody></table></div>
  <div className="row-gap"><Btn size="sm" icon="Plus" onClick={()=>{setFields([...fields,{key:key('field',fields.map(f=>f.key)),label:'New field',type:'text'}]);setFi(fields.length)}}>Add field</Btn></div>
  {fi!==null&&fields[fi]&&<FieldEditor f={fields[fi]} table={table} def={emptyApp()} onChange={nf=>setFields(fields.map((x,j)=>j===fi?nf:x))}/>}
  <Field label="Custom stages (one per line)" hint="Optional lifecycle stages shown alongside the module’s own status."><textarea rows={3} value={stages} onChange={e=>setStages(e.target.value)}/></Field>
  {data?.canEdit&&<Btn variant="primary" onClick={async()=>{try{await api('/api/studio',{action:'extension-save',entityType:type,fields,stages:stages.split('\n').map(x=>x.trim()).filter(Boolean)});toast('Saved');reload()}catch(e){toast((e as Error).message,'error')}}}>Save custom fields</Btn>}
 </div>;
}
function Approvals(){
 const {data,error,reload}=useApi<{approvals:{id:string,title:string,stage:string,link:string,since:string,dueAt:string|null}[]}>('/api/studio/records?view=approvals');
 return <div className="page"><Header icon="Stamp" tone="violet" title="App approvals" subtitle="Studio records waiting for your decision."/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.approvals.length?<Empty icon="Stamp" title="Nothing waiting for you"/>:<ul className="mini-list">{data.approvals.map(a=><li key={a.id}><a className="mini-row" href={a.link}><b>{a.title}</b><span>{a.stage} · since {ago(a.since)}{a.dueAt?` · due ${dateTime(a.dueAt)}`:''}</span></a></li>)}</ul>}</div>;
}
function Usage(){
 const {data,error}=useApi<{automationRuns:{used:number,limit:number},apps:number,records:number,byStatus:{status:string,n:number}[]}>('/api/studio?view=usage');
 return <div className="page"><Header icon="Gauge" tone="violet" title="Studio usage" subtitle="Apps, records and automation runs this month."/><ErrorNote error={error}/>
  {data&&<div className="stat-row"><Card title="Apps"><b className="big">{data.apps}</b></Card><Card title="Records"><b className="big">{data.records}</b></Card><Card title="Automation runs this month"><b className="big">{data.automationRuns.used}</b><small className="muted"> of {data.automationRuns.limit}</small></Card></div>}
  {data&&<Card title="Runs by status"><ul>{data.byStatus.map(s=><li key={s.status}>{s.status}: <b>{s.n}</b></li>)}</ul></Card>}</div>;
}
export type {ReactNode};
