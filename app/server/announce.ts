import {first} from './core';
import {aclOf,audienceMembers} from './acl';
import {pageLive,type PageRow} from './entities';
import {registerJob} from './jobs';
import {notify} from './notify';
import type {Acl} from '../acl';

// Scheduled announcements notify their audience when they go live.
registerJob('announcement.publish',async job=>{
 const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',job.ref_id,job.tenant_id);
 if(!p||p.deleted_at||!pageLive(p))return;
 await announce({id:p.author_id,tenantId:job.tenant_id},p);
});
export async function announce(u:{id:string,tenantId:string},p:PageRow|{id:string,title:string,department:string,acl_json?:string|null,priority?:string,requires_ack?:number}){
 const acl:Acl=p.acl_json?aclOf(p.acl_json):p.department?{mode:'department',departments:[p.department]}:{mode:'company'};
 // The notification carries only the title; the content stays behind the page's own access check.
 const ids=(await audienceMembers(u.tenantId,acl)).filter(id=>id!==u.id).slice(0,5000);
 const urgent=(p as {priority?:string}).priority==='Urgent'||(p as {priority?:string}).priority==='High';
 for(let i=0;i<ids.length;i+=80)await notify(u,ids.slice(i,i+80),{kind:'announcement',title:`${urgent?'⚠️':'📣'} ${p.title}`,body:(p as {requires_ack?:number}).requires_ack?'Please read and acknowledge.':'New announcement',link:`#/spaces/page/${p.id}`,email:urgent});
}

