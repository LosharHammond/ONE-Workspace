import {route,readBody,all,run,now,idOf,str} from '../../server/core';
export const GET=route(async(_req,u)=>({notifications:await all('SELECT id,kind,title,body,link,read_at AS readAt,created_at AS createdAt FROM notifications WHERE member_id=? AND tenant_id=? ORDER BY created_at DESC LIMIT 80',u.id,u.tenantId)}));
export const POST=route(async(req,u)=>{
 const b=await readBody(req);
 if(b.action==='read-all')await run('UPDATE notifications SET read_at=? WHERE member_id=? AND read_at IS NULL',now(),u.id);
 else if(b.action==='read')await run('UPDATE notifications SET read_at=? WHERE id=? AND member_id=?',now(),idOf(b.id,'Notification'),u.id);
 else if(b.action==='email-preference')await run('UPDATE members SET notify_email=? WHERE id=?',b.enabled?1:0,u.id);
 else if(b.action==='profile')await run('UPDATE members SET phone=?,title=? WHERE id=? AND tenant_id=?',str(b.phone,'Phone',40,false),str(b.title,'Job title',120,false),u.id,u.tenantId);
 return {ok:true};
});
