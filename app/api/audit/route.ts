import {canActOn,hasAction} from '../../access-policy';
import {route,all,HttpError} from '../../server/core';
// Workspace activity log. Managers see their department; administrators see everything.
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'audit'))throw new HttpError(403,'The activity log is not available to your account.');
 const url=new URL(req.url),q=(url.searchParams.get('q')||'').slice(0,80),before=url.searchParams.get('before')||'9999';
 const rows=await all<{id:string,action:string,actor:string,department:string,recordId:string,createdAt:string,before:string|null,after:string|null}>("SELECT id,action,actor,department,record_id AS recordId,created_at AS createdAt,before_json AS before,after_json AS after FROM audit WHERE tenant_id=? AND created_at<? AND (?='' OR action LIKE ? OR record_id LIKE ?) ORDER BY created_at DESC LIMIT 300",u.tenantId,before,q,`%${q}%`,`%${q}%`);
 const visible=rows.filter(r=>canActOn(u,'audit','view',r.department,r.actor));
 return {events:visible.slice(0,150),more:rows.length===300};
});
