import {route,readBody,HttpError,stmt,batch,uid,now,str,oneOf,idOf,all} from '../../server/core';
import {visibleEntity,canWorkTicket,type TicketRow} from '../../server/entities';
import {notify} from '../../server/notify';
// Conversation threads on tickets, assets, purchase documents and pages. @mentions notify people by name.
export const POST=route(async(req,u)=>{
 const b=await readBody(req);
 const type=oneOf(b.type,['ticket','asset','PR','PO','page','task','project'] as const,'item type'),id=idOf(b.id,'Item'),body=str(b.body,'Comment',6000);
 const e=await visibleEntity(u,type,id);
 let internal=0;
 if(b.internal&&type==='ticket'){const t=(await all<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',id,u.tenantId))[0];if(!canWorkTicket(u,t))throw new HttpError(403,'Only the resolving team can add internal notes.');internal=1}
 const cid=uid();
 await batch([stmt('INSERT INTO comments(id,tenant_id,entity_type,entity_id,author_id,body,internal,created_at) VALUES(?,?,?,?,?,?,?,?)',cid,u.tenantId,type,id,u.id,body,internal,now()),stmt("UPDATE tickets SET updated_at=? WHERE id=? AND tenant_id=?",now(),id,u.tenantId)]);
 const mentioned=[...body.matchAll(/@([A-Za-z][\w.'-]*(?: [A-Z][\w.'-]*)?)/g)].map(m=>m[1].toLowerCase());
 const people=mentioned.length?(await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=? AND active=1',u.tenantId)).filter(p=>mentioned.some(m=>p.name.toLowerCase().startsWith(m))).map(p=>p.id):[];
 const recipients=internal?people:[...e.notifyIds,...people];
 await notify(u,recipients,{kind:'comment',title:`${u.name} commented on ${e.title}`,body:body.slice(0,400),link:e.link},req);
 return {id:cid};
});
// Reading a thread requires the same visibility as the item itself (internal ticket notes are never listed here).
export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const type=oneOf(url.searchParams.get('type'),['asset','PR','PO','page','task','project'] as const,'item type'),id=idOf(url.searchParams.get('id'),'Item');
 await visibleEntity(u,type,id);
 return {comments:await all('SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type=? AND entity_id=? AND internal=0 ORDER BY created_at',u.tenantId,type,id)};
});
