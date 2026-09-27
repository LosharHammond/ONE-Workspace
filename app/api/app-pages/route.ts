import {hasAction,departmentKey} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,auditStatement,platformAuditStatement,parseJson} from '../../server/core';
import {validateLayout,filterLayout,widgetData,assertWidgetsAllowed} from '../../server/widgets';
import {PLATFORM_SCOPE} from '../../server/secrets';
import type {Layout} from '../../widgets';
import type {Member} from '../../server/policy';

// Visual page builder. Pages are JSON layouts of approved widgets, validated on every save. Each save is an
// immutable version; publishing points the page at a version; rollback republishes an older one as a new
// version. Viewers get the published version with widgets they may not see removed, and widget data is
// resolved on the server with the viewer's own permissions.
type PageRow={id:string,tenant_id:string,slug:string,title:string,description:string,icon:string,status:string,draft_json:string,draft_version:number,published_version:number|null,visibility_json:string,created_by:string,created_at:string,updated_by:string,updated_at:string};
type Visibility={roles?:string[],departments?:string[]};
const canEdit=(u:Member)=>hasAction(u,'app-pages','update')||hasAction(u,'app-pages','create');
function canView(u:Member,p:PageRow){if(!hasAction(u,'app-pages'))return false;if(canEdit(u))return true;if(p.status!=='published'||!p.published_version)return false;const v=parseJson<Visibility>(p.visibility_json,{});if(v.roles?.length&&!v.roles.includes(u.roleId||'')&&!v.roles.includes(u.role))return false;if(v.departments?.length&&!v.departments.some(d=>departmentKey(d)===departmentKey(u.department)))return false;return true}
async function load(u:Member,id:string){const p=await first<PageRow>('SELECT * FROM app_pages WHERE id=? AND tenant_id=?',id,u.tenantId);if(!p||!canView(u,p))throw new HttpError(404,'Page not found.');return p}
const summary=(p:PageRow)=>({id:p.id,slug:p.slug,title:p.title,description:p.description,icon:p.icon,status:p.status,draftVersion:p.draft_version,publishedVersion:p.published_version,visibility:parseJson(p.visibility_json,{}),updatedAt:p.updated_at,updatedBy:p.updated_by,createdBy:p.created_by,createdAt:p.created_at});
function slugOf(v:unknown){const s=str(v,'Page address',40).toLowerCase();if(!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s))throw new HttpError(400,'Use lowercase letters, numbers and dashes for the page address.');return s}
function visibilityOf(v:unknown):Visibility{const o=(v&&typeof v==='object'?v:{}) as Record<string,unknown>;const l=(x:unknown)=>Array.isArray(x)?x.map(y=>String(y).slice(0,120)).slice(0,50):[];return {roles:l(o.roles),departments:l(o.departments)}}
// A structural summary of what changed between two versions (for "compare versions").
function diff(a:Layout,b:Layout){const ws=(l:Layout)=>new Map(l.sections.flatMap(s=>[...(s.rows||[]),...(s.tabs||[]).flatMap(t=>t.rows)]).flatMap(r=>r.columns.flatMap(c=>c.widgets)).map(w=>[w.id,w]));const A=ws(a),B=ws(b);return {added:[...B.values()].filter(w=>!A.has(w.id)).map(w=>({id:w.id,type:w.type,title:w.title})),removed:[...A.values()].filter(w=>!B.has(w.id)).map(w=>({id:w.id,type:w.type,title:w.title})),changed:[...B.values()].filter(w=>A.has(w.id)&&JSON.stringify(A.get(w.id))!==JSON.stringify(w)).map(w=>({id:w.id,type:w.type,title:w.title})),sections:{before:a.sections.length,after:b.sections.length}}}

export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const id=url.searchParams.get('id'),slug=url.searchParams.get('slug');
 if(!hasAction(u,'app-pages'))throw new HttpError(403,'Custom pages are not available to you.');
 if(url.searchParams.get('view')==='templates'){if(!canEdit(u))throw new HttpError(403,'Only page editors use templates.');return {templates:await all("SELECT id,scope,name,description,created_at AS createdAt FROM page_templates WHERE tenant_id IN (?,?) ORDER BY scope DESC,name",u.tenantId,PLATFORM_SCOPE)}}
 if(id||slug){
  const p=id?await load(u,idOf(id,'Page')):await first<PageRow>('SELECT * FROM app_pages WHERE slug=? AND tenant_id=?',str(slug,'Page',40),u.tenantId);
  if(!p||!canView(u,p))throw new HttpError(404,'Page not found.');
  const editor=canEdit(u);
  const wantVersion=url.searchParams.get('version');
  if(url.searchParams.get('versions')){if(!editor)throw new HttpError(403,'Only editors see version history.');return {versions:await all('SELECT version,note,created_by AS createdBy,created_at AS createdAt FROM app_page_versions WHERE tenant_id=? AND page_id=? ORDER BY version DESC LIMIT 200',u.tenantId,p.id)}}
  if(url.searchParams.get('compare')){if(!editor)throw new HttpError(403,'Only editors compare versions.');const [a,b]=String(url.searchParams.get('compare')).split(',').map(Number);const rows=await all<{version:number,layout_json:string}>('SELECT version,layout_json FROM app_page_versions WHERE tenant_id=? AND page_id=? AND version IN (?,?)',u.tenantId,p.id,a,b);const A=rows.find(r=>r.version===a),B=rows.find(r=>r.version===b);if(!A||!B)throw new HttpError(404,'Version not found.');return {diff:diff(parseJson(A.layout_json,{sections:[]}),parseJson(B.layout_json,{sections:[]}))}}
  // Editors get the draft (or a named version); everyone else the published version.
  let layout:Layout;let version:number|null;
  if(editor&&wantVersion!=='published'){const v=wantVersion?Number(wantVersion):null;if(v){const r=await first<{layout_json:string}>('SELECT layout_json FROM app_page_versions WHERE tenant_id=? AND page_id=? AND version=?',u.tenantId,p.id,v);if(!r)throw new HttpError(404,'Version not found.');layout=parseJson(r.layout_json,{sections:[]});version=v}else{layout=parseJson(p.draft_json,{sections:[]});version=p.draft_version}}
  else{const r=p.published_version?await first<{layout_json:string}>('SELECT layout_json FROM app_page_versions WHERE tenant_id=? AND page_id=? AND version=?',u.tenantId,p.id,p.published_version):null;if(!r)throw new HttpError(404,'This page is not published yet.');layout=filterLayout(u,parseJson(r.layout_json,{sections:[]}));version=p.published_version}
  return {page:summary(p),layout,version,canEdit:editor,canPublish:hasAction(u,'app-pages','publish'),canDelete:hasAction(u,'app-pages','delete')};
 }
 const rows=await all<PageRow>("SELECT * FROM app_pages WHERE tenant_id=? AND status!='archived' OR (tenant_id=? AND status='archived' AND ?) ORDER BY title",u.tenantId,u.tenantId,canEdit(u)?1:0);
 return {pages:rows.filter(p=>canView(u,p)).map(summary),canCreate:hasAction(u,'app-pages','create')};
},{module:'builder'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,300000);const action=String(b.action||'');
 // Widget data for viewers and for the editor's live preview. Always the viewer's own permissions.
 if(action==='data'){
  if(!hasAction(u,'app-pages'))throw new HttpError(403,'Custom pages are not available to you.');
  if(b.pageId){const p=await load(u,idOf(b.pageId,'Page'));void p}
  return widgetData(u,b.widget);
 }
 if(action==='save'){
  const id=b.id?idOf(b.id,'Page'):null;
  const layout=validateLayout(b.layout);await assertWidgetsAllowed(layout);const layoutJson=JSON.stringify(layout);
  const title=str(b.title,'Title',120),description=str(b.description,'Description',300,false),icon=/^[A-Za-z0-9]{2,40}$/.test(String(b.icon))?String(b.icon):'LayoutGrid';
  const visibility=visibilityOf(b.visibility);const note=str(b.note,'Note',200,false);
  if(!id){
   if(!hasAction(u,'app-pages','create'))throw new HttpError(403,'You cannot create pages.');
   const slug=slugOf(b.slug||title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'page');
   if(await first('SELECT id FROM app_pages WHERE tenant_id=? AND slug=?',u.tenantId,slug))throw new HttpError(409,'Another page already uses this address.');
   const pid=uid();
   await batch([stmt('INSERT INTO app_pages(id,tenant_id,slug,title,description,icon,status,draft_json,draft_version,published_version,visibility_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,1,NULL,?,?,?,?,?)',pid,u.tenantId,slug,title,description,icon,'draft',layoutJson,JSON.stringify(visibility),u.name,now(),u.name,now()),stmt('INSERT INTO app_page_versions(id,tenant_id,page_id,version,layout_json,note,created_by,created_at) VALUES(?,?,?,1,?,?,?,?)',uid(),u.tenantId,pid,layoutJson,note||'Created',u.name,now()),auditStatement(u,'Custom page created',pid,'Pages',null,{title,slug})]);
   return {id:pid,version:1};
  }
  if(!hasAction(u,'app-pages','update'))throw new HttpError(403,'You cannot edit pages.');
  const p=await load(u,id);
  if(b.baseVersion!==undefined&&Number(b.baseVersion)!==p.draft_version)throw new HttpError(409,'Someone else saved this page. Reload to see their changes.');
  const v=p.draft_version+1;
  await batch([stmt("UPDATE app_pages SET title=?,description=?,icon=?,draft_json=?,draft_version=?,visibility_json=?,status=CASE WHEN status='archived' THEN 'draft' ELSE status END,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",title,description,icon,layoutJson,v,JSON.stringify(visibility),u.name,now(),p.id,u.tenantId),stmt('INSERT INTO app_page_versions(id,tenant_id,page_id,version,layout_json,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,p.id,v,layoutJson,note,u.name,now()),auditStatement(u,'Custom page edited',p.id,'Pages',{version:p.draft_version,title:p.title},{version:v,title})]);
  return {id:p.id,version:v};
 }
 if(action==='template-use'){
  if(!hasAction(u,'app-pages','create'))throw new HttpError(403,'You cannot create pages.');
  const t=await first<{layout_json:string,name:string}>('SELECT layout_json,name FROM page_templates WHERE id=? AND tenant_id IN (?,?)',idOf(b.templateId,'Template'),u.tenantId,PLATFORM_SCOPE);if(!t)throw new HttpError(404,'Template not found.');
  return {layout:validateLayout(parseJson(t.layout_json,{sections:[]}),true),name:t.name};
 }
 const p=await load(u,idOf(b.id,'Page'));
 switch(action){
  case 'publish':case 'rollback':{
   if(!hasAction(u,'app-pages','publish'))throw new HttpError(403,'You cannot publish pages.');
   let version=action==='publish'?Number(b.version||p.draft_version):Number(b.version);
   const row=await first<{layout_json:string}>('SELECT layout_json FROM app_page_versions WHERE tenant_id=? AND page_id=? AND version=?',u.tenantId,p.id,version);if(!row)throw new HttpError(404,'Version not found.');
   const s=[];
   // Rolling back republishes the old layout as a new version, so history is never rewritten.
   if(action==='rollback'){const v=p.draft_version+1;s.push(stmt('INSERT INTO app_page_versions(id,tenant_id,page_id,version,layout_json,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,p.id,v,row.layout_json,`Rolled back to version ${version}`,u.name,now()),stmt('UPDATE app_pages SET draft_json=?,draft_version=? WHERE id=? AND tenant_id=?',row.layout_json,v,p.id,u.tenantId));version=v}
   s.push(stmt("UPDATE app_pages SET published_version=?,status='published',updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",version,u.name,now(),p.id,u.tenantId),auditStatement(u,action==='publish'?'Custom page published':'Custom page rolled back',p.id,'Pages',{published:p.published_version},{published:version}));
   await batch(s);return {ok:true,version};
  }
  case 'unpublish':{if(!hasAction(u,'app-pages','publish'))throw new HttpError(403,'You cannot publish pages.');await batch([stmt("UPDATE app_pages SET status='draft',published_version=NULL,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",u.name,now(),p.id,u.tenantId),auditStatement(u,'Custom page unpublished',p.id,'Pages',{published:p.published_version},null)]);return {ok:true}}
  case 'archive':case 'restore':{if(!hasAction(u,'app-pages','update'))throw new HttpError(403,'You cannot edit pages.');await batch([stmt('UPDATE app_pages SET status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',action==='archive'?'archived':'draft',u.name,now(),p.id,u.tenantId),auditStatement(u,action==='archive'?'Custom page archived':'Custom page restored',p.id,'Pages',{status:p.status},{status:action==='archive'?'archived':'draft'})]);return {ok:true}}
  case 'delete':{if(!hasAction(u,'app-pages','delete'))throw new HttpError(403,'You cannot delete pages.');if(p.status!=='archived')throw new HttpError(409,'Archive the page before deleting it.');await batch([stmt('DELETE FROM app_page_versions WHERE tenant_id=? AND page_id=?',u.tenantId,p.id),stmt('DELETE FROM app_pages WHERE id=? AND tenant_id=?',p.id,u.tenantId),auditStatement(u,'Custom page deleted',p.id,'Pages',{title:p.title,versions:p.draft_version},null)]);return {ok:true}}
  case 'duplicate':{
   if(!hasAction(u,'app-pages','create'))throw new HttpError(403,'You cannot create pages.');
   let slug=`${p.slug}-copy`.slice(0,40);for(let i=2;await first('SELECT id FROM app_pages WHERE tenant_id=? AND slug=?',u.tenantId,slug);i++)slug=`${p.slug.slice(0,34)}-copy-${i}`;
   const nid=uid();await batch([stmt('INSERT INTO app_pages(id,tenant_id,slug,title,description,icon,status,draft_json,draft_version,published_version,visibility_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,1,NULL,?,?,?,?,?)',nid,u.tenantId,slug,`${p.title} (copy)`,p.description,p.icon,'draft',p.draft_json,p.visibility_json,u.name,now(),u.name,now()),stmt('INSERT INTO app_page_versions(id,tenant_id,page_id,version,layout_json,note,created_by,created_at) VALUES(?,?,?,1,?,?,?,?)',uid(),u.tenantId,nid,p.draft_json,`Duplicated from ${p.title}`,u.name,now()),auditStatement(u,'Custom page duplicated',nid,'Pages',null,{from:p.id})]);
   return {id:nid};
  }
  case 'save-template':{
   if(!hasAction(u,'app-pages','create'))throw new HttpError(403,'You cannot create templates.');
   // Platform templates (available to every company) can only be created by the Platform Owner.
   const platform=b.scope==='platform';if(platform&&u.platformRole!=='owner')throw new HttpError(403,'Only the Platform Owner creates platform templates.');
   const tid=uid();const name=str(b.name||p.title,'Template name',80);
   await batch([stmt('INSERT INTO page_templates(id,tenant_id,scope,name,description,layout_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',tid,platform?PLATFORM_SCOPE:u.tenantId,platform?'platform':'company',name,str(b.description,'Description',300,false),p.draft_json,u.name,now()),platform?platformAuditStatement({...u,tenantId:u.tenantId},'template.create',req,{id:tid,name}):auditStatement(u,'Page template saved',tid,'Pages',null,{name,from:p.id})]);
   return {id:tid};
  }
 }
 throw new HttpError(400,'Unknown action.');
},{module:'builder'});
