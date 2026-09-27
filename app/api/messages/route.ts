import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,tenantOf,tenantSettings,run} from '../../server/core';
import {canAccessChannel,canModerateChannel,loadProject,loadSpace,type ChannelRow} from '../../server/collab';
import {canSeeFile,type FileRow} from '../../server/entities';
import {notify} from '../../server/notify';
import type {Acl} from '../../acl';
import type {Member} from '../../server/policy';

// Company messaging. Channels: company, department, project, space, group, custom, direct (dm) and multi-person,
// plus announcement-only channels. Delivery is near real time by short polling (?since=). Attachments and voice
// notes are ordinary Files: when sent, the sender's file is shared with exactly the channel's audience.
const REACTIONS=['👍','❤️','😂','🎉','👀','🙏','✅'];
async function mine(u:Member){return new Set((await all<{channel_id:string}>('SELECT channel_id FROM channel_members WHERE tenant_id=? AND member_id=?',u.tenantId,u.id)).map(r=>r.channel_id))}
// The company channel, the member's department channel, and channels of their projects/spaces/groups exist on first use.
async function ensureDefaults(u:Member){
 const have=new Set((await all<{k:string}>("SELECT kind||':'||ref_id AS k FROM channels WHERE tenant_id=? AND kind IN ('company','department','project','group','space')",u.tenantId)).map(r=>r.k));
 const ts=now();const s:D1PreparedStatement[]=[];
 const add=(kind:string,ref:string,name:string,description:string)=>{if(!have.has(`${kind}:${ref}`)){have.add(`${kind}:${ref}`);s.push(stmt('INSERT INTO channels(id,tenant_id,kind,name,description,ref_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,kind,name,description,ref,'system',ts))}};
 add('company','','general','Everyone in the company.');
 if(u.department&&u.department!=='Platform support')add('department',u.department,u.department.toLowerCase().replace(/[^a-z0-9]+/g,'-'),`${u.department} department`);
 if(u.projectIds?.length){const ps=await all<{id:string,code:string,name:string}>(`SELECT id,code,name FROM projects WHERE tenant_id=? AND id IN (${u.projectIds.map(()=>'?').join(',')})`,u.tenantId,...u.projectIds);for(const p of ps)add('project',p.id,p.code.toLowerCase(),p.name)}
 if(u.groupIds?.length){const gs=await all<{id:string,code:string,name:string}>(`SELECT id,code,name FROM groups WHERE tenant_id=? AND status='active' AND id IN (${u.groupIds.map(()=>'?').join(',')})`,u.tenantId,...u.groupIds);for(const g of gs)add('group',g.id,g.code.toLowerCase(),g.name)}
 if(s.length)await batch(s);
}
async function loadChannel(u:Member,id:string){const c=await first<ChannelRow>('SELECT * FROM channels WHERE id=? AND tenant_id=?',id,u.tenantId);if(!c||!await canAccessChannel(u,c))throw new HttpError(404,'Channel not found.');return c}
// Audience of a channel as a content ACL (for attachments).
async function channelAcl(u:Member,c:ChannelRow):Promise<Acl>{
 switch(c.kind){case 'company':case 'announcement':return {mode:'company'};case 'department':return {mode:'department',departments:[c.ref_id]};case 'project':return {mode:'project',projectId:c.ref_id};case 'space':return {mode:'space',spaceId:c.ref_id};case 'group':return {mode:'groups',groups:[c.ref_id]}}
 return {mode:'people',people:(await all<{member_id:string}>('SELECT member_id FROM channel_members WHERE tenant_id=? AND channel_id=?',u.tenantId,c.id)).map(r=>r.member_id)};
}
async function listChannels(u:Member){
 await ensureDefaults(u);const m=await mine(u);
 const rows=await all<ChannelRow&{unread:number,last_read_at:string|null,notify:string|null}>("SELECT c.*,cm.last_read_at,cm.notify,(SELECT count(*) FROM messages x WHERE x.tenant_id=c.tenant_id AND x.channel_id=c.id AND x.deleted_at IS NULL AND x.hidden=0 AND x.thread_id IS NULL AND x.author_id!=?2 AND x.created_at>coalesce(cm.last_read_at,'')) AS unread FROM channels c LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.tenant_id=c.tenant_id AND cm.member_id=?2 WHERE c.tenant_id=?1 AND c.archived_at IS NULL ORDER BY c.last_message_at DESC",u.tenantId,u.id);
 const out=[];for(const c of rows)if(await canAccessChannel(u,c,m))out.push(c);
 // Direct messages are named after the other people in them.
 const dms=out.filter(c=>['dm','multi'].includes(c.kind));
 const names=dms.length?await all<{channel_id:string,names:string}>(`SELECT cm.channel_id,group_concat(m.name,', ') AS names FROM channel_members cm JOIN members m ON m.id=cm.member_id AND m.tenant_id=cm.tenant_id WHERE cm.tenant_id=? AND cm.member_id!=? AND cm.channel_id IN (${dms.map(()=>'?').join(',')}) GROUP BY cm.channel_id`,u.tenantId,u.id,...dms.map(c=>c.id)):[];
 const byId=new Map(names.map(n=>[n.channel_id,n.names]));
 return out.map(c=>({id:c.id,kind:c.kind,name:['dm','multi'].includes(c.kind)?byId.get(c.id)||c.name:c.name,description:c.description,refId:c.ref_id,posting:c.posting,lastMessageAt:c.last_message_at,unread:c.unread,notify:c.notify||'all',canModerate:canModerateChannel(u,c)}));
}
async function hydrate(u:Member,rows:{id:string,channel_id:string,thread_id:string|null,author_id:string,body:string,kind:string,edited_at:string|null,deleted_at:string|null,pinned:number,hidden:number,created_at:string}[],mod:boolean){
 if(!rows.length)return [];const ids=rows.map(r=>r.id);const IN=ids.map(()=>'?').join(',');
 const [reacts,files,replies,marks]=await Promise.all([
  all<{entity_id:string,emoji:string,member_id:string}>(`SELECT entity_id,emoji,member_id FROM reactions WHERE tenant_id=? AND entity_type='message' AND entity_id IN (${IN})`,u.tenantId,...ids),
  all<FileRow&{entity_id:string}>(`SELECT f.*,l.entity_id FROM file_links l JOIN files f ON f.id=l.file_id AND f.tenant_id=l.tenant_id WHERE l.tenant_id=? AND l.entity_type='message' AND l.entity_id IN (${IN}) AND f.deleted_at IS NULL`,u.tenantId,...ids),
  all<{thread_id:string,n:number,last:string}>(`SELECT thread_id,count(*) AS n,max(created_at) AS last FROM messages WHERE tenant_id=? AND deleted_at IS NULL AND thread_id IN (${IN}) GROUP BY thread_id`,u.tenantId,...ids),
  all<{message_id:string}>(`SELECT message_id FROM message_bookmarks WHERE tenant_id=? AND member_id=? AND message_id IN (${IN})`,u.tenantId,u.id,...ids),
 ]);
 const bookmarked=new Set(marks.map(m=>m.message_id));
 return rows.map(r=>{const rx:Record<string,{count:number,mine:boolean}>={};for(const x of reacts.filter(x=>x.entity_id===r.id)){rx[x.emoji]??={count:0,mine:false};rx[x.emoji].count++;if(x.member_id===u.id)rx[x.emoji].mine=true}
  const gone=!!r.deleted_at||(!!r.hidden&&!mod&&r.author_id!==u.id);
  return {id:r.id,channelId:r.channel_id,threadId:r.thread_id,authorId:r.author_id,body:gone?'':r.body,kind:r.kind,deleted:!!r.deleted_at,hidden:!!r.hidden,editedAt:r.edited_at,pinned:!!r.pinned,createdAt:r.created_at,reactions:rx,bookmarked:bookmarked.has(r.id),
   // Attachments are shown only if the viewer can open the file.
   files:gone?[]:files.filter(f=>f.entity_id===r.id&&canSeeFile(u,f)).map(f=>({id:f.id,name:f.name,mime:f.mime,bytes:f.bytes,status:f.processing_status})),
   replies:replies.find(x=>x.thread_id===r.id)?.n||0}});
}
export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const q=(k:string)=>url.searchParams.get(k);
 if(q('search')){
  const term=str(q('search'),'Search',80);if(term.length<2)return {results:[]};const list=await listChannels(u);const ids=list.map(c=>c.id);if(!ids.length)return {results:[]};
  const rows=await all<{id:string,channel_id:string,thread_id:string|null,author_id:string,body:string,created_at:string}>(`SELECT id,channel_id,thread_id,author_id,body,created_at FROM messages WHERE tenant_id=? AND deleted_at IS NULL AND hidden=0 AND body LIKE ? AND channel_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at DESC LIMIT 50`,u.tenantId,`%${term.replace(/[%_]/g,'')}%`,...ids);
  const names=new Map(list.map(c=>[c.id,c.name]));return {results:rows.map(r=>({...r,channelName:names.get(r.channel_id)}))};
 }
 if(q('bookmarks')!==null){const rows=await all<any>('SELECT x.* FROM message_bookmarks b JOIN messages x ON x.id=b.message_id AND x.tenant_id=b.tenant_id WHERE b.tenant_id=? AND b.member_id=? AND x.deleted_at IS NULL ORDER BY b.created_at DESC LIMIT 100',u.tenantId,u.id);const ok=[];for(const r of rows){const c=await first<ChannelRow>('SELECT * FROM channels WHERE id=? AND tenant_id=?',r.channel_id,u.tenantId);if(c&&await canAccessChannel(u,c))ok.push(r)}return {messages:await hydrate(u,ok,false)}}
 if(q('reports')!==null){if(u.role!=='admin')throw new HttpError(403,'Only administrators review reports.');return {reports:await all("SELECT r.id,r.reason,r.status,r.created_at AS createdAt,m.body,m.id AS messageId,m.channel_id AS channelId,a.name AS reporter FROM message_reports r JOIN messages m ON m.id=r.message_id AND m.tenant_id=r.tenant_id LEFT JOIN members a ON a.id=r.member_id WHERE r.tenant_id=? ORDER BY r.status='open' DESC,r.created_at DESC LIMIT 200",u.tenantId)}}
 const channel=q('channel');
 if(channel){
  const c=await loadChannel(u,idOf(channel,'Channel'));const mod=canModerateChannel(u,c);const thread=q('thread');const since=q('since');const before=q('before');
  const where=['tenant_id=?','channel_id=?'];const binds:unknown[]=[u.tenantId,c.id];
  if(thread){where.push('(id=? OR thread_id=?)');binds.push(idOf(thread,'Thread'),thread)}else where.push('thread_id IS NULL');
  if(since){where.push('(created_at>? OR edited_at>? OR deleted_at>?)');binds.push(since,since,since)}
  if(before){where.push('created_at<?');binds.push(before)}
  const rows=await all<any>(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 60`,...binds);
  const typing=await all<{name:string}>('SELECT m.name FROM channel_members cm JOIN members m ON m.id=cm.member_id AND m.tenant_id=cm.tenant_id WHERE cm.tenant_id=? AND cm.channel_id=? AND cm.member_id!=? AND cm.typing_until>?',u.tenantId,c.id,u.id,now());
  const members=['dm','multi','custom','announcement'].includes(c.kind)?await all('SELECT m.id,m.name,cm.role,cm.last_read_at AS lastReadAt FROM channel_members cm JOIN members m ON m.id=cm.member_id AND m.tenant_id=cm.tenant_id WHERE cm.tenant_id=? AND cm.channel_id=?',u.tenantId,c.id):[];
  const pinned=since?[]:await all<any>('SELECT * FROM messages WHERE tenant_id=? AND channel_id=? AND pinned=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20',u.tenantId,c.id);
  const settings=tenantSettings(await tenantOf(u));
  // Presence (unless the company turns it off): active in any conversation in the last 3 minutes.
  const since3=new Date(Date.now()-180000).toISOString();
  const online=settings.presence===false||!members.length?new Set<string>():new Set((await all<{member_id:string}>(`SELECT DISTINCT member_id FROM channel_members WHERE tenant_id=? AND (last_read_at>? OR typing_until>?) AND member_id IN (${(members as {id:string}[]).map(()=>'?').join(',')})`,u.tenantId,since3,since3,...(members as {id:string}[]).map(m=>m.id))).map(r=>r.member_id));
  return {channel:{id:c.id,kind:c.kind,name:c.name,description:c.description,posting:c.posting,refId:c.ref_id},messages:(await hydrate(u,rows.reverse(),mod)),pinned:await hydrate(u,pinned,mod),typing:typing.map(t=>t.name),members:(settings.readReceipts===false?members.map((m:any)=>({...m,lastReadAt:undefined})):members).map((m:any)=>({...m,online:online.has(m.id)})),presence:settings.presence!==false,canPost:c.posting!=='admins'||mod||u.role==='admin',canModerate:mod,now:now()};
 }
 return {channels:await listChannels(u),now:now()};
},{module:'messages'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,100000);const action=String(b.action||'');
 if(action==='dm'||action==='create'){
  if(!hasAction(u,'messages','create'))throw new HttpError(403,'Messaging is not available to you.');
  const ids=[...new Set((Array.isArray(b.members)?b.members:[b.memberId]).filter(Boolean).map((x:unknown)=>idOf(x,'Person')))].filter(x=>x!==u.id).slice(0,100) as string[];
  if(ids.length){const ok=new Set((await all<{id:string}>(`SELECT id FROM members WHERE tenant_id=? AND active=1 AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids)).map(r=>r.id));if(ids.some(i=>!ok.has(i)))throw new HttpError(400,'Everyone must be an active member of this company.')}
  if(action==='dm'){
   if(!ids.length)throw new HttpError(400,'Choose who to message.');
   const kind=ids.length===1?'dm':'multi';const everyone=[u.id,...ids].sort();
   // Reuse an existing conversation with exactly the same people.
   const found=await first<{id:string}>(`SELECT c.id FROM channels c WHERE c.tenant_id=? AND c.kind=? AND c.archived_at IS NULL AND (SELECT count(*) FROM channel_members cm WHERE cm.channel_id=c.id AND cm.tenant_id=c.tenant_id)=? AND NOT EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.tenant_id=c.tenant_id AND cm.member_id NOT IN (${everyone.map(()=>'?').join(',')}))`,u.tenantId,kind,everyone.length,...everyone);
   if(found)return {id:found.id};
   const id=uid();await batch([stmt('INSERT INTO channels(id,tenant_id,kind,name,created_by,created_at) VALUES(?,?,?,?,?,?)',id,u.tenantId,kind,kind==='dm'?'Direct message':'Group conversation',u.id,now()),...everyone.map(m=>stmt('INSERT INTO channel_members(id,tenant_id,channel_id,member_id,role,joined_at) VALUES(?,?,?,?,?,?)',uid(),u.tenantId,id,m,m===u.id?'owner':'member',now()))]);return {id};
  }
  const kind=oneOf(b.kind||'custom',['custom','announcement','department','project','space','group'] as const,'channel type');
  const name=str(b.name,'Channel name',60).toLowerCase().replace(/[^a-z0-9-]+/g,'-');let ref='';
  if(kind==='department'){if(u.role!=='admin')throw new HttpError(403,'Only administrators create department channels.');ref=str(b.refId,'Department',160);if(!await first('SELECT id FROM departments WHERE tenant_id=? AND name=?',u.tenantId,ref))throw new HttpError(400,'Department not found.')}
  if(kind==='project'){const p=await loadProject(u,idOf(b.refId,'Project'));ref=p.id}
  if(kind==='space'){const s=await loadSpace(u,idOf(b.refId,'Space'));ref=s.id}
  if(kind==='group'){ref=idOf(b.refId,'Group');if(!await first("SELECT id FROM groups WHERE id=? AND tenant_id=? AND status='active'",ref,u.tenantId))throw new HttpError(400,'Group not found.');if(!u.groupIds?.includes(ref)&&u.role!=='admin')throw new HttpError(403,'Only group members create its channel.')}
  if(kind==='announcement'&&u.role!=='admin')throw new HttpError(403,'Only administrators create announcement-only channels.');
  const id=uid();await batch([stmt('INSERT INTO channels(id,tenant_id,kind,name,description,ref_id,posting,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,name,str(b.description,'Description',300,false),ref,kind==='announcement'?'admins':oneOf(b.posting||'all',['all','admins'] as const,'posting'),u.id,now()),...(['custom','announcement'].includes(kind)?[u.id,...ids].map(m=>stmt('INSERT OR IGNORE INTO channel_members(id,tenant_id,channel_id,member_id,role,joined_at) VALUES(?,?,?,?,?,?)',uid(),u.tenantId,id,m,m===u.id?'owner':'member',now())):[]),auditStatement(u,'Channel created',id,u.department,null,{kind,name,ref})]);
  return {id};
 }
 if(action==='settings'){if(u.role!=='admin')throw new HttpError(403,'Only administrators change messaging policies.');const t=await tenantOf(u);const s=tenantSettings(t);const next={...s,messageRetentionDays:Math.max(0,Math.min(3650,Math.round(Number(b.retentionDays??s.messageRetentionDays??0)))),readReceipts:b.readReceipts===undefined?s.readReceipts!==false:!!b.readReceipts,presence:b.presence===undefined?s.presence!==false:!!b.presence};await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify(next),u.tenantId),auditStatement(u,'Messaging policies changed',u.tenantId,'Administration',{retention:s.messageRetentionDays,readReceipts:s.readReceipts},{retention:next.messageRetentionDays,readReceipts:next.readReceipts})]);
  // Retention: soft-deleted and expired messages are removed now; the policy is re-applied on each change.
  if(next.messageRetentionDays>0)await run('UPDATE messages SET deleted_at=coalesce(deleted_at,?),body=\'\' WHERE tenant_id=? AND created_at<? AND pinned=0',now(),u.tenantId,new Date(Date.now()-next.messageRetentionDays*86400000).toISOString());
  return {ok:true};
 }
 if(action==='resolve-report'){if(u.role!=='admin')throw new HttpError(403,'Only administrators review reports.');const id=idOf(b.id,'Report');await batch([stmt("UPDATE message_reports SET status='resolved' WHERE id=? AND tenant_id=?",id,u.tenantId),auditStatement(u,'Message report resolved',id,'Administration',null,{outcome:str(b.outcome,'Outcome',200,false)})]);return {ok:true}}
 // Channel-level actions.
 if(b.channelId&&!b.messageId){
  const c=await loadChannel(u,idOf(b.channelId,'Channel'));const mod=canModerateChannel(u,c);
  switch(action){
   case 'send':{
    if(!hasAction(u,'messages','create'))throw new HttpError(403,'Messaging is not available to you.');
    if(c.posting==='admins'&&!mod&&u.role!=='admin')throw new HttpError(403,'Only administrators post in this channel.');
    const body=str(b.body,'Message',8000,!(Array.isArray(b.fileIds)&&b.fileIds.length));const threadId=b.threadId?idOf(b.threadId,'Thread'):null;
    if(threadId&&!await first('SELECT id FROM messages WHERE id=? AND tenant_id=? AND channel_id=? AND thread_id IS NULL',threadId,u.tenantId,c.id))throw new HttpError(400,'Thread not found.');
    const fileIds=(Array.isArray(b.fileIds)?b.fileIds:[]).map((x:unknown)=>idOf(x,'File')).slice(0,10);
    const files=fileIds.length?await all<FileRow>(`SELECT * FROM files WHERE tenant_id=? AND id IN (${fileIds.map(()=>'?').join(',')}) AND deleted_at IS NULL`,u.tenantId,...fileIds):[];
    if(files.length!==fileIds.length||files.some(f=>(f.owner_id||f.uploaded_by)!==u.id&&u.role!=='admin'))throw new HttpError(403,'You can only attach your own uploads.');
    const acl=await channelAcl(u,c);const id=uid(),ts=now();
    await batch([stmt('INSERT INTO messages(id,tenant_id,channel_id,thread_id,author_id,body,kind,created_at) VALUES(?,?,?,?,?,?,?,?)',id,u.tenantId,c.id,threadId,u.id,body,b.kind==='voice'?'voice':'text',ts),stmt('UPDATE channels SET last_message_at=? WHERE id=? AND tenant_id=?',ts,c.id,u.tenantId),stmt('INSERT INTO channel_members(id,tenant_id,channel_id,member_id,last_read_at,joined_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,member_id) DO UPDATE SET last_read_at=excluded.last_read_at,typing_until=NULL',uid(),u.tenantId,c.id,u.id,ts,ts),
     // Attachments: the file's audience becomes exactly the channel's audience.
     ...files.flatMap(f=>[stmt('UPDATE files SET acl_json=?,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(acl),ts,f.id,u.tenantId),stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,'message',id,u.id,ts)]),
     ...(files.length?[auditStatement(u,'Files shared in a message',id,u.department,null,{files:fileIds,channel:c.id})]:[])]);
    // Mentions (@First Last) notify people who can read the channel; the notification carries no message text.
    const mentioned=[...body.matchAll(/@([A-Za-zÀ-ÿ'-]+(?: [A-Za-zÀ-ÿ'-]+)?)/g)].map(m=>m[1].toLowerCase());
    if(mentioned.length){const people=await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=? AND active=1',u.tenantId);const targets=people.filter(p=>p.id!==u.id&&mentioned.some(m=>p.name.toLowerCase().startsWith(m)));const reach=[];for(const p of targets){const m=await first<Member>('SELECT id,role,department,active,tenant_id AS tenantId FROM members WHERE id=?',p.id);if(m&&(['company','announcement'].includes(c.kind)||await first('SELECT id FROM channel_members WHERE tenant_id=? AND channel_id=? AND member_id=?',u.tenantId,c.id,p.id)||(c.kind==='department'&&m.department.toLowerCase()===c.ref_id.toLowerCase())))reach.push(p.id)}if(reach.length)await notify(u,reach,{kind:'mention',title:`${u.name} mentioned you in #${c.name}`,link:`#/messages/${c.id}`},req)}
    if(['dm','multi'].includes(c.kind)){const others=(await all<{member_id:string,notify:string}>("SELECT member_id,notify FROM channel_members WHERE tenant_id=? AND channel_id=? AND member_id!=? AND notify!='none'",u.tenantId,c.id,u.id)).map(r=>r.member_id);if(others.length)await notify(u,others,{kind:'message',title:`New message from ${u.name}`,link:`#/messages/${c.id}`},req)}
    return {id,createdAt:ts};
   }
   case 'read':{await stmt('INSERT INTO channel_members(id,tenant_id,channel_id,member_id,last_read_at,joined_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,member_id) DO UPDATE SET last_read_at=excluded.last_read_at',uid(),u.tenantId,c.id,u.id,now(),now()).run();return {ok:true}}
   case 'typing':{await stmt('INSERT INTO channel_members(id,tenant_id,channel_id,member_id,typing_until,joined_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,member_id) DO UPDATE SET typing_until=excluded.typing_until',uid(),u.tenantId,c.id,u.id,new Date(Date.now()+6000).toISOString(),now()).run();return {ok:true}}
   case 'notify':{await stmt('INSERT INTO channel_members(id,tenant_id,channel_id,member_id,notify,joined_at) VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,member_id) DO UPDATE SET notify=excluded.notify',uid(),u.tenantId,c.id,u.id,oneOf(b.level,['all','mentions','none'] as const,'notification level'),now()).run();return {ok:true}}
   case 'members':{if(!['custom','multi','announcement'].includes(c.kind))throw new HttpError(409,'Membership of this channel follows its department, project, space or group.');if(!mod&&c.created_by!==u.id)throw new HttpError(403,'Only the channel owner changes members.');const add=(Array.isArray(b.add)?b.add:[]).map((x:unknown)=>idOf(x,'Person'));const remove=(Array.isArray(b.remove)?b.remove:[]).map((x:unknown)=>idOf(x,'Person'));await batch([...add.map((m:string)=>stmt('INSERT OR IGNORE INTO channel_members(id,tenant_id,channel_id,member_id,joined_at) SELECT ?,?,?,id,? FROM members WHERE id=? AND tenant_id=? AND active=1',uid(),u.tenantId,c.id,now(),m,u.tenantId)),...remove.map((m:string)=>stmt('DELETE FROM channel_members WHERE tenant_id=? AND channel_id=? AND member_id=?',u.tenantId,c.id,m)),auditStatement(u,'Channel members changed',c.id,u.department,{removed:remove},{added:add})]);return {ok:true}}
   case 'archive':{if(!mod&&c.created_by!==u.id)throw new HttpError(403,'Only moderators archive channels.');if(['company'].includes(c.kind))throw new HttpError(409,'The company channel cannot be archived.');await batch([stmt('UPDATE channels SET archived_at=? WHERE id=? AND tenant_id=?',now(),c.id,u.tenantId),auditStatement(u,'Channel archived',c.id,u.department,null,null)]);return {ok:true}}
   case 'export':{if(u.role!=='admin'&&!hasAction(u,'messages','export'))throw new HttpError(403,'Exporting messages is not part of your role.');const rows=await all('SELECT x.created_at AS createdAt,m.name AS author,x.body,x.thread_id AS threadId,x.deleted_at AS deletedAt FROM messages x LEFT JOIN members m ON m.id=x.author_id WHERE x.tenant_id=? AND x.channel_id=? ORDER BY x.created_at LIMIT 20000',u.tenantId,c.id);await auditStatement(u,'Channel exported',c.id,u.department,null,{messages:rows.length}).run();return {messages:rows}}
  }
  throw new HttpError(400,'Unknown action.');
 }
 // Message-level actions.
 const m=await first<{id:string,channel_id:string,author_id:string,body:string,deleted_at:string|null,pinned:number,hidden:number}>('SELECT * FROM messages WHERE id=? AND tenant_id=?',idOf(b.messageId,'Message'),u.tenantId);
 if(!m)throw new HttpError(404,'Message not found.');const c=await loadChannel(u,m.channel_id);const mod=canModerateChannel(u,c);
 switch(action){
  case 'edit':{if(m.author_id!==u.id)throw new HttpError(403,'You can only edit your own messages.');if(m.deleted_at)throw new HttpError(409,'This message was deleted.');await batch([stmt('UPDATE messages SET body=?,edited_at=? WHERE id=? AND tenant_id=?',str(b.body,'Message',8000),now(),m.id,u.tenantId),auditStatement(u,'Message edited',m.id,u.department,null,{channel:c.id})]);return {ok:true}}
  case 'delete':{if(m.author_id!==u.id&&!mod)throw new HttpError(403,'You can only delete your own messages.');await batch([stmt('UPDATE messages SET deleted_at=?,deleted_by=? WHERE id=? AND tenant_id=?',now(),u.id,m.id,u.tenantId),auditStatement(u,m.author_id===u.id?'Message deleted':'Message removed by a moderator',m.id,u.department,null,{channel:c.id})]);return {ok:true}}
  case 'hide':{if(!mod)throw new HttpError(403,'Only moderators hide messages.');await batch([stmt('UPDATE messages SET hidden=? WHERE id=? AND tenant_id=?',b.on===false?0:1,m.id,u.tenantId),auditStatement(u,b.on===false?'Message unhidden':'Message hidden by a moderator',m.id,u.department,null,{channel:c.id})]);return {ok:true}}
  case 'pin':{if(!mod&&!['dm','multi','custom'].includes(c.kind))throw new HttpError(403,'Only moderators pin messages here.');await batch([stmt('UPDATE messages SET pinned=? WHERE id=? AND tenant_id=?',b.on===false?0:1,m.id,u.tenantId),auditStatement(u,b.on===false?'Message unpinned':'Message pinned',m.id,u.department,null,{channel:c.id})]);return {ok:true}}
  case 'react':{const emoji=oneOf(b.emoji,REACTIONS,'reaction');const had=await first("SELECT id FROM reactions WHERE tenant_id=? AND entity_type='message' AND entity_id=? AND member_id=? AND emoji=?",u.tenantId,m.id,u.id,emoji);await stmt(had?"DELETE FROM reactions WHERE tenant_id=? AND entity_type='message' AND entity_id=? AND member_id=? AND emoji=?":"INSERT INTO reactions(tenant_id,entity_type,entity_id,member_id,emoji,id,created_at) VALUES(?,'message',?,?,?,?,?)",...(had?[u.tenantId,m.id,u.id,emoji]:[u.tenantId,m.id,u.id,emoji,uid(),now()])).run();return {ok:true}}
  case 'bookmark':{await stmt(b.on===false?'DELETE FROM message_bookmarks WHERE tenant_id=? AND message_id=? AND member_id=?':'INSERT OR IGNORE INTO message_bookmarks(tenant_id,message_id,member_id,id,created_at) VALUES(?,?,?,?,?)',...(b.on===false?[u.tenantId,m.id,u.id]:[u.tenantId,m.id,u.id,uid(),now()])).run();return {ok:true}}
  case 'report':{await batch([stmt('INSERT INTO message_reports(id,tenant_id,message_id,member_id,reason,created_at) VALUES(?,?,?,?,?,?)',uid(),u.tenantId,m.id,u.id,str(b.reason,'Reason',300),now()),auditStatement(u,'Message reported',m.id,u.department,null,{channel:c.id})]);const admins=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND role='admin' AND active=1",u.tenantId)).map(r=>r.id);await notify(u,admins,{kind:'moderation',title:`A message in #${c.name} was reported`,link:'#/messages/reports'},req);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
},{module:'messages'});
