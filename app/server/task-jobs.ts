import {first,run,now} from './core';
import {registerJob} from './jobs';
import {notify} from './notify';
// Task reminders: at the reminder time, the assignees and owner of an unfinished task are notified.
registerJob('task.remind',async job=>{
 const t=await first<{id:string,title:string,status:string,owner_id:string,deleted_at:string|null,due_date:string|null,reminder_at:string|null}>('SELECT id,title,status,owner_id,deleted_at,due_date,reminder_at FROM tasks WHERE id=? AND tenant_id=?',job.ref_id,job.tenant_id);
 if(!t||t.deleted_at||['Done','Cancelled'].includes(t.status))return;
 const people=[t.owner_id,...(await (await import('./core')).all<{member_id:string}>("SELECT member_id FROM task_assignees WHERE tenant_id=? AND task_id=? AND kind='assignee'",job.tenant_id,t.id)).map(r=>r.member_id)];
 await notify({id:'system',tenantId:job.tenant_id},[...new Set(people)],{kind:'task',title:`⏰ Reminder: ${t.title}`,body:t.due_date?`Due ${t.due_date}`:'',link:`#/tasks/all/${t.id}`,email:true});
 await run('UPDATE tasks SET reminded_at=? WHERE id=? AND tenant_id=?',now(),t.id,job.tenant_id);
});
