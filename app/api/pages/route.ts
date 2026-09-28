import {canActOn,actionScope,hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement} from '../../server/core';
import {canSeePage,canEditPage,pageLive,type PageRow} from '../../server/entities';
import {aclOf,validateAcl,audienceMembers} from '../../server/acl';
import {loadSpace} from '../../server/collab';
import {enqueueStatement,kick} from '../../server/jobs';
import {announce} from '../../server/announce';
import {notify} from '../../server/notify';
import type {Acl} from '../../acl';
import type {Member} from '../../server/policy';
import {pageKinds} from '../../data';

// Space pages and announcements. Announcements target an audience (company, departments, locations, roles,
// groups, project team, space members or people), can be scheduled and expire, be pinned, carry a priority,
// require acknowledgement, collect read receipts and reactions, and go through approval when the author may
// not publish. Every save keeps a revision; deletion goes to a recycle bin.
const canCreateIn=(u:Member,department:string)=>department?canActOn(u,'knowledge','create',department,u.id):actionScope(u,'knowledge','create')==='all'||hasAction(u,'knowledge','create');
const canPublish=(u:Member,p:{department:string,author_id:string})=>u.role==='admin'||(!!p.department&&canActOn(u,'knowledge','publish',p.department,p.author_id))||(!p.department&&actionScope(u,'knowledge','publish')==='all');
async function load(u:Member,id:string,deleted=false){const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',id,u.tenantId);if(!p)throw new HttpError(404,'Page not found.');if(p.deleted_at){if(deleted&&(u.role==='admin'||p.author_id===u.id))return p;throw new HttpError(404,'Page not found.')}if(!canSeePage(u,p))throw new HttpError(404,'Page not found.');return p}
const revision=(u:Member,p:{id:string,version:number,title:string,body:string,acl_json?:string|null})=>stmt('INSERT INTO page_revisions(id,tenant_id,page_id,version,title,body,acl_json,edited_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,p.id,p.version,p.title,p.body,p.acl_json||null,u.id,now());
const iso=(v:unknown,label:string)=>{if(v===undefined||v===null||v==='')return null;const d=new Date(String(v));if(!Number.isFinite(d.getTime()))throw new HttpError(400,`${label} must be a valid date and time.`);return d.toISOString()};

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'knowledge'))throw new HttpError(403,'Spaces are not available to your account.');
 const url=new URL(req.url);const id=url.searchParams.get('id');
 if(url.searchParams.get('view')==='recycle'){const rows=await all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500',u.tenantId);return {pages:rows.filter(p=>u.role==='admin'||p.author_id===u.id).map(({body,...p})=>({...p,excerpt:body.slice(0,160)}))}}
 if(url.searchParams.get('view')==='approvals'){if(u.role!=='admin'&&!hasAction(u,'knowledge','publish'))return {pages:[]};const rows=await all<PageRow>("SELECT * FROM pages WHERE tenant_id=? AND approval_status='pending' AND deleted_at IS NULL ORDER BY updated_at",u.tenantId);return {pages:rows.filter(p=>canPublish(u,p)).map(({body,...p})=>({...p,excerpt:body.slice(0,200)}))}}
 if(id){
  const p=await load(u,idOf(id,'Page'),true);const editor=canEditPage(u,p);
  const [comments,children,revisions,reactions,receipt,files]=await Promise.all([
   all("SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='page' AND entity_id=? ORDER BY created_at",u.tenantId,p.id),
   all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND parent_id=? AND deleted_at IS NULL ORDER BY title',u.tenantId,p.id),
   editor?all('SELECT r.version,r.title,r.created_at AS createdAt,m.name AS who FROM page_revisions r LEFT JOIN members m ON m.id=r.edited_by WHERE r.tenant_id=? AND r.page_id=? ORDER BY r.version DESC LIMIT 100',u.tenantId,p.id):[],
   all<{emoji:string,member_id:string}>("SELECT emoji,member_id FROM reactions WHERE tenant_id=? AND entity_type='page' AND entity_id=?",u.tenantId,p.id),
   first<{read_at:string|null,acked_at:string|null}>('SELECT read_at,acked_at FROM announcement_receipts WHERE tenant_id=? AND page_id=? AND member_id=?',u.tenantId,p.id,u.id),
   all("SELECT f.id,f.name,f.mime,f.bytes FROM file_links l JOIN files f ON f.id=l.file_id AND f.tenant_id=l.tenant_id WHERE l.tenant_id=? AND l.entity_type='page' AND l.entity_id=? AND f.deleted_at IS NULL",u.tenantId,p.id),
  ]);
  // Reading records a receipt (for announcements).
  if(p.kind==='announcement'&&!receipt?.read_at)await stmt('INSERT INTO announcement_receipts(id,tenant_id,page_id,member_id,read_at) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,page_id,member_id) DO UPDATE SET read_at=coalesce(read_at,excluded.read_at)',uid(),u.tenantId,p.id,u.id,now()).run();
  let receipts=null;
  if(editor&&p.kind==='announcement'){const audience=await audienceMembers(u.tenantId,p.acl_json?aclOf(p.acl_json):p.department?{mode:'department',departments:[p.department]}:{mode:'company'});const rows=await all<{member_id:string,read_at:string|null,acked_at:string|null}>('SELECT member_id,read_at,acked_at FROM announcement_receipts WHERE tenant_id=? AND page_id=?',u.tenantId,p.id);const by=new Map(rows.map(r=>[r.member_id,r]));receipts={audience:audience.length,read:audience.filter(a=>by.get(a)?.read_at).length,acknowledged:audience.filter(a=>by.get(a)?.acked_at).length,pending:audience.filter(a=>p.requires_ack&&!by.get(a)?.acked_at).slice(0,500)}}
  const tally:Record<string,{count:number,mine:boolean}>={};for(const r of reactions){tally[r.emoji]??={count:0,mine:false};tally[r.emoji].count++;if(r.member_id===u.id)tally[r.emoji].mine=true}
  return {page:{...p,acl:p.acl_json?aclOf(p.acl_json):null},comments,files,children:children.filter(c=>canSeePage(u,c)).map(c=>({id:c.id,title:c.title,icon:c.icon,status:c.status})),revisions,reactions:tally,receipt:{read:!!receipt?.read_at||p.kind==='announcement',acknowledged:!!receipt?.acked_at},receipts,canEdit:editor,canPublish:canPublish(u,p),isAdmin:u.role==='admin'};
 }
 const space=url.searchParams.get('space');const sp=space?await loadSpace(u,idOf(space,'Space')):null;
 const rows=await all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND deleted_at IS NULL ORDER BY pinned DESC,updated_at DESC LIMIT 3000',u.tenantId);
 const inSpace=(p:PageRow)=>!sp||p.space_id===sp.id||(!p.space_id&&(sp.kind==='company'?!p.department:sp.kind==='department'&&p.department.toLowerCase()===sp.department.toLowerCase()));
 const acks=new Set((await all<{page_id:string}>('SELECT page_id FROM announcement_receipts WHERE tenant_id=? AND member_id=? AND acked_at IS NOT NULL',u.tenantId,u.id)).map(r=>r.page_id));
 const spaces=(await all<{name:string}>('SELECT name FROM departments WHERE tenant_id=?',u.tenantId)).map(d=>d.name);
 return {pages:rows.filter(p=>canSeePage(u,p)&&inSpace(p)).map(({body,...p})=>({...p,live:pageLive(p as PageRow),acknowledged:acks.has(p.id),excerpt:body.replace(/[#*_>`[\]()-]/g,'').slice(0,220)})),canCreate:Object.fromEntries(['',...spaces].map(s=>[s,canCreateIn(u,s)]))};
},{module:'spaces'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,300000);const action=String(b.action||'save');
 if(action==='save'){
  const kind=oneOf(b.kind||'page',pageKinds,'page type');
  const sp=b.spaceId?await loadSpace(u,idOf(b.spaceId,'Space')):null;
  const department=sp?sp.kind==='department'?sp.department:'':str(b.department,'Space',160,false);
  const parentId=b.parentId?idOf(b.parentId,'Parent page'):null;if(parentId&&!await first('SELECT id FROM pages WHERE id=? AND tenant_id=? AND deleted_at IS NULL',parentId,u.tenantId))throw new HttpError(400,'Parent page not found.');
  const v={title:str(b.title,'Title',200),body:str(b.body,'Content',200000,false),icon:str(b.icon,'Icon',40,false),pinned:b.pinned?1:0,priority:oneOf(b.priority||'Normal',['Low','Normal','High','Urgent'] as const,'priority'),requiresAck:b.requiresAck?1:0,publishAt:iso(b.publishAt,'Publish time'),expiresAt:iso(b.expiresAt,'Expiry')};
  if(v.expiresAt&&v.publishAt&&v.expiresAt<=v.publishAt)throw new HttpError(400,'The expiry must be after the publish time.');
  // Audience: explicit, or the space's department (or company) as before.
  const fallback:Acl=department?{mode:'department',departments:[department]}:sp?.kind==='custom'||sp?.kind==='project'?{mode:'space',spaceId:sp.id}:{mode:'company'};
  const {acl,needsApproval:aclNeedsApproval}=b.acl?await validateAcl(u,b.acl):{acl:fallback,needsApproval:false};
  const may=canPublish(u,{department,author_id:u.id});
  const wantsPublish=!!b.publish;
  if(b.id){
   const p=await load(u,idOf(b.id,'Page'));if(!canEditPage(u,p))throw new HttpError(403,'You cannot edit this page.');
   if(b.version!==undefined&&b.version!==p.version)throw new HttpError(409,'Someone else saved this page. Copy your changes, refresh and try again.');
   if(department!==p.department&&!canCreateIn(u,department))throw new HttpError(403,'You cannot move pages into that space.');
   const res=await batch([revision(u,p),stmt('UPDATE pages SET title=?,body=?,icon=?,pinned=?,department=?,kind=?,parent_id=?,acl_json=?,space_id=?,priority=?,requires_ack=?,publish_at=?,expires_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?',v.title,v.body,v.icon,u.role==='admin'||may?v.pinned:p.pinned,department,kind,parentId===p.id?null:parentId,JSON.stringify(acl),sp?.id||p.space_id||null,v.priority,v.requiresAck,v.publishAt,v.expiresAt,u.id,now(),p.id,u.tenantId,p.version),auditStatement(u,'Page edited',p.id,department,{title:p.title,version:p.version,acl:p.acl_json?aclOf(p.acl_json):null},{title:v.title,version:p.version+1,acl})]);
   if(!res[1].meta.changes)throw new HttpError(409,'Someone else saved this page. Refresh and try again.');
   return {id:p.id};
  }
  if(!canCreateIn(u,department))throw new HttpError(403,department?`You cannot write pages in the ${department} space.`:'You cannot write company-wide pages.');
  const id=uid();
  // Authors who may publish go live now (or at the scheduled time); others submit for approval.
  const scheduled=!!v.publishAt&&v.publishAt>now();
  const status=wantsPublish&&may&&!aclNeedsApproval?'Published':'Draft';
  const approval=wantsPublish&&(!may||aclNeedsApproval)?'pending':'none';
  await batch([stmt('INSERT INTO pages(id,tenant_id,department,parent_id,kind,title,body,icon,status,pinned,author_id,updated_by,created_at,updated_at,acl_json,space_id,priority,requires_ack,publish_at,expires_at,approval_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,department,parentId,kind,v.title,v.body,v.icon,status,may?v.pinned:0,u.id,u.id,now(),now(),JSON.stringify(acl),sp?.id||null,v.priority,v.requiresAck,v.publishAt,v.expiresAt,approval),auditStatement(u,approval==='pending'?'Page submitted for approval':'Page created',id,department,null,{title:v.title,status,acl,publishAt:v.publishAt}),...(status==='Published'&&kind==='announcement'&&scheduled?[enqueueStatement(u.tenantId,'announcement.publish',id,{},{key:`announce:${id}`,delaySec:Math.ceil((Date.parse(v.publishAt!)-Date.now())/1000)})]:[])]);
  if(approval==='pending'){const approvers=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND (role='admin' OR (role='manager' AND lower(department)=lower(?)))",u.tenantId,department)).map(r=>r.id);await notify(u,approvers,{kind:'approval',title:`${u.name} submitted “${v.title}” for approval`,link:`#/spaces/page/${id}`},req)}
  if(status==='Published'&&kind==='announcement'&&!scheduled)await announce(u,{id,title:v.title,department,acl_json:JSON.stringify(acl),priority:v.priority,requires_ack:v.requiresAck});
  if(scheduled)kick();
  return {id,status,approval,scheduled};
 }
 const p=await load(u,idOf(b.id,'Page'),['restore','purge'].includes(action));
 switch(action){
  case 'status':case 'approve':case 'reject':{
   if(!canPublish(u,p))throw new HttpError(403,'Publishing in this space is for department heads and administrators.');
   const status=action==='approve'?'Published':action==='reject'?'Draft':oneOf(b.status,['Draft','Published','Archived'] as const,'status');
   const scheduled=status==='Published'&&!!p.publish_at&&p.publish_at>now();
   await batch([stmt("UPDATE pages SET status=?,approval_status=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",status,action==='approve'?'approved':action==='reject'?'rejected':p.approval_status,u.id,now(),p.id,u.tenantId),auditStatement(u,action==='approve'?'Page approved and published':action==='reject'?'Page approval declined':`Page ${status.toLowerCase()}`,p.id,p.department,{status:p.status},{status,note:str(b.note,'Note',300,false)}),...(scheduled&&p.kind==='announcement'?[enqueueStatement(u.tenantId,'announcement.publish',p.id,{},{key:`announce:${p.id}:${p.version}`,delaySec:Math.ceil((Date.parse(p.publish_at!)-Date.now())/1000)})]:[])]);
   if(action!=='status')await notify(u,[p.author_id],{kind:'approval',title:`“${p.title}” was ${action==='approve'?'approved and published':'sent back'}`,link:`#/spaces/page/${p.id}`},req);
   if(status==='Published'&&p.status!=='Published'&&!scheduled){if(p.kind==='announcement')await announce(u,p);else await notify(u,[p.author_id],{kind:'page',title:`“${p.title}” was published`,link:`#/spaces/page/${p.id}`},req)}
   if(scheduled)kick();
   return {ok:true};
  }
  case 'pin':{if(!canPublish(u,p))throw new HttpError(403,'Only publishers pin content.');await batch([stmt('UPDATE pages SET pinned=? WHERE id=? AND tenant_id=?',b.on===false?0:1,p.id,u.tenantId),auditStatement(u,b.on===false?'Page unpinned':'Page pinned',p.id,p.department,null,null)]);return {ok:true}}
  case 'ack':{await (await import('../../server/inbox')).inboxEventStatement(u.tenantId,'page',p.id).run();await stmt('INSERT INTO announcement_receipts(id,tenant_id,page_id,member_id,read_at,acked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,page_id,member_id) DO UPDATE SET acked_at=excluded.acked_at,read_at=coalesce(read_at,excluded.read_at)',uid(),u.tenantId,p.id,u.id,now(),now()).run();return {ok:true}}
  case 'react':{const emoji=oneOf(b.emoji,['👍','❤️','🎉','👏','😮','🙏'] as const,'reaction');const had=await first('SELECT id FROM reactions WHERE tenant_id=? AND entity_type=? AND entity_id=? AND member_id=? AND emoji=?',u.tenantId,'page',p.id,u.id,emoji);await stmt(had?'DELETE FROM reactions WHERE tenant_id=? AND entity_type=? AND entity_id=? AND member_id=? AND emoji=?':'INSERT INTO reactions(tenant_id,entity_type,entity_id,member_id,emoji,id,created_at) VALUES(?,?,?,?,?,?,?)',...(had?[u.tenantId,'page',p.id,u.id,emoji]:[u.tenantId,'page',p.id,u.id,emoji,uid(),now()])).run();return {ok:true}}
  case 'restore-revision':{
   if(!canEditPage(u,p))throw new HttpError(403,'You cannot edit this page.');
   const r=await first<{title:string,body:string,acl_json:string|null}>('SELECT title,body,acl_json FROM page_revisions WHERE tenant_id=? AND page_id=? AND version=?',u.tenantId,p.id,Number(b.version));if(!r)throw new HttpError(404,'Revision not found.');
   await batch([revision(u,p),stmt('UPDATE pages SET title=?,body=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',r.title,r.body,u.id,now(),p.id,u.tenantId),auditStatement(u,`Revision ${b.version} restored`,p.id,p.department,{version:p.version},{from:b.version})]);return {ok:true};
  }
  case 'delete':{
   if(!canEditPage(u,p))throw new HttpError(403,'You cannot delete this page.');
   await batch([stmt('UPDATE pages SET deleted_at=?,deleted_by=? WHERE id=? AND tenant_id=?',now(),u.id,p.id,u.tenantId),auditStatement(u,'Page moved to the recycle bin',p.id,p.department,{title:p.title},null)]);return {ok:true};
  }
  case 'restore':{await batch([stmt('UPDATE pages SET deleted_at=NULL,deleted_by=NULL WHERE id=? AND tenant_id=?',p.id,u.tenantId),auditStatement(u,'Page restored',p.id,p.department,null,{title:p.title})]);return {ok:true}}
  case 'purge':{
   if(u.role!=='admin')throw new HttpError(403,'Only administrators permanently delete content.');if(!p.deleted_at)throw new HttpError(409,'Move it to the recycle bin first.');if(String(b.confirm||'')!==p.title)throw new HttpError(400,`Type the title “${p.title}” to confirm.`);
   await batch([stmt('UPDATE pages SET parent_id=? WHERE parent_id=? AND tenant_id=?',p.parent_id,p.id,u.tenantId),stmt('DELETE FROM page_revisions WHERE tenant_id=? AND page_id=?',u.tenantId,p.id),stmt('DELETE FROM announcement_receipts WHERE tenant_id=? AND page_id=?',u.tenantId,p.id),stmt("DELETE FROM reactions WHERE tenant_id=? AND entity_type='page' AND entity_id=?",u.tenantId,p.id),stmt("DELETE FROM comments WHERE tenant_id=? AND entity_type='page' AND entity_id=?",u.tenantId,p.id),stmt('DELETE FROM pages WHERE id=? AND tenant_id=?',p.id,u.tenantId),auditStatement(u,'Page permanently deleted',p.id,p.department,{title:p.title},null)]);return {ok:true};
  }
 }
 throw new HttpError(400,'Unknown action.');
},{module:'spaces'});
