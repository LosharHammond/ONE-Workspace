import {canActOn,actionScope,hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement} from '../../server/core';
import {canSeePage,canEditPage,type PageRow} from '../../server/entities';
import {notify} from '../../server/notify';
import type {Member} from '../../server/policy';
import {pageKinds} from '../../data';

// Department spaces: an intranet page tree per department plus company-wide pages ('' department).
const canCreateIn=(u:Member,department:string)=>department?canActOn(u,'knowledge','create',department,u.id):actionScope(u,'knowledge','create')==='all';
const canPublish=(u:Member,p:{department:string,author_id:string})=>u.role==='admin'||(!!p.department&&canActOn(u,'knowledge','publish',p.department,p.author_id));
async function load(u:Member,id:string){const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',id,u.tenantId);if(!p||!canSeePage(u,p))throw new HttpError(404,'Page not found.');return p}

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'knowledge'))throw new HttpError(403,'Department spaces are not available to your account.');
 const id=new URL(req.url).searchParams.get('id');
 if(id){const p=await load(u,idOf(id,'Page'));const [comments,children]=await Promise.all([all("SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='page' AND entity_id=? ORDER BY created_at",u.tenantId,p.id),all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND parent_id=? ORDER BY title',u.tenantId,p.id)]);return {page:p,comments,children:children.filter(c=>canSeePage(u,c)).map(c=>({id:c.id,title:c.title,icon:c.icon,status:c.status})),canEdit:canEditPage(u,p),canPublish:canPublish(u,p)}}
 const rows=await all<PageRow>('SELECT * FROM pages WHERE tenant_id=? ORDER BY pinned DESC,updated_at DESC LIMIT 3000',u.tenantId);
 const spaces=(await all<{name:string}>('SELECT name FROM departments WHERE tenant_id=?',u.tenantId)).map(d=>d.name);
 return {pages:rows.filter(p=>canSeePage(u,p)).map(({body,...p})=>({...p,excerpt:body.replace(/[#*_>`[\]()-]/g,'').slice(0,220)})),canCreate:Object.fromEntries(['',...spaces].map(s=>[s,canCreateIn(u,s)]))};
},{module:'spaces'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,300000);const action=String(b.action||'save');
 if(action==='save'){
  const department=str(b.department,'Space',160,false),kind=oneOf(b.kind||'page',pageKinds,'page type');
  const parentId=b.parentId?idOf(b.parentId,'Parent page'):null;if(parentId&&!await first('SELECT id FROM pages WHERE id=? AND tenant_id=?',parentId,u.tenantId))throw new HttpError(400,'Parent page not found.');
  const v={title:str(b.title,'Title',200),body:str(b.body,'Content',200000,false),icon:str(b.icon,'Icon',40,false),pinned:b.pinned?1:0};
  if(b.id){
   const p=await load(u,idOf(b.id,'Page'));if(!canEditPage(u,p))throw new HttpError(403,'You cannot edit this page.');
   if(b.version!==undefined&&b.version!==p.version)throw new HttpError(409,'Someone else saved this page. Copy your changes, refresh and try again.');
   if(department!==p.department&&!canCreateIn(u,department))throw new HttpError(403,'You cannot move pages into that space.');
   const res=await batch([stmt('UPDATE pages SET title=?,body=?,icon=?,pinned=?,department=?,kind=?,parent_id=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?',v.title,v.body,v.icon,v.pinned,department,kind,parentId===p.id?null:parentId,u.id,now(),p.id,u.tenantId,p.version),auditStatement(u,'Page edited',p.id,department,{title:p.title,version:p.version},{title:v.title,version:p.version+1})]);
   if(!res[0].meta.changes)throw new HttpError(409,'Someone else saved this page. Refresh and try again.');
   return {id:p.id};
  }
  if(!canCreateIn(u,department))throw new HttpError(403,department?`You cannot write pages in the ${department} space.`:'Only administrators write company-wide pages.');
  const id=uid(),status=b.publish&&canPublish(u,{department,author_id:u.id})?'Published':'Draft';
  await batch([stmt('INSERT INTO pages(id,tenant_id,department,parent_id,kind,title,body,icon,status,pinned,author_id,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,department,parentId,kind,v.title,v.body,v.icon,status,v.pinned,u.id,u.id,now(),now()),auditStatement(u,'Page created',id,department,null,{title:v.title,status})]);
  if(status==='Published'&&kind==='announcement')await announce(u,{id,title:v.title,department},req);
  return {id,status};
 }
 const p=await load(u,idOf(b.id,'Page'));
 if(action==='status'){
  const status=oneOf(b.status,['Draft','Published','Archived'] as const,'status');
  if(!canPublish(u,p))throw new HttpError(403,'Publishing in this space is for department heads and administrators.');
  await batch([stmt('UPDATE pages SET status=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',status,u.id,now(),p.id,u.tenantId),auditStatement(u,`Page ${status.toLowerCase()}`,p.id,p.department,{status:p.status},{status})]);
  if(status==='Published'&&p.status!=='Published'){if(p.kind==='announcement')await announce(u,p,req);else await notify(u,[p.author_id],{kind:'page',title:`“${p.title}” was published`,link:`#/spaces/page/${p.id}`},req)}
  return {ok:true};
 }
 if(action==='delete'){
  if(!canEditPage(u,p))throw new HttpError(403,'You cannot delete this page.');
  await batch([stmt('UPDATE pages SET parent_id=? WHERE parent_id=? AND tenant_id=?',p.parent_id,p.id,u.tenantId),stmt('DELETE FROM pages WHERE id=? AND tenant_id=?',p.id,u.tenantId),stmt("DELETE FROM comments WHERE tenant_id=? AND entity_type='page' AND entity_id=?",u.tenantId,p.id),auditStatement(u,'Page deleted',p.id,p.department,{title:p.title},null)]);
  return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
},{module:'spaces'});

// Announcements reach everyone in the space (or the whole company) in-app; email is left to the digest.
async function announce(u:Member,p:{id:string,title:string,department:string},req:Request){
 const people=await all<{id:string,department:string}>('SELECT id,department FROM members WHERE tenant_id=? AND active=1',u.tenantId);
 const ids=people.filter(x=>!p.department||x.department.toLowerCase()===p.department.toLowerCase()).map(x=>x.id).slice(0,2000);
 for(let i=0;i<ids.length;i+=80)await notify(u,ids.slice(i,i+80),{kind:'announcement',title:`📣 ${p.title}`,body:p.department?`${p.department} announcement`:'Company announcement',link:`#/spaces/page/${p.id}`,email:false},req);
}
