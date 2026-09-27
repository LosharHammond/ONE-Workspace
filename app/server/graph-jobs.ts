import {registerJob,enqueueStatement} from './jobs';
import {rebuildChunk} from './graph';

// Backfill pre-existing tenant data in resumable, idempotent batches so first-use indexing
// does not compete with interactive requests or require an operator to run SQL manually.
registerJob('graph.rebuild',async(job,progress)=>{
 const cursor=JSON.parse(job.payload_json||'{}') as {table?:number,offset?:number};
 const table=Math.max(0,Math.floor(cursor.table||0));
 const offset=Math.max(0,Math.floor(cursor.offset||0));
 const next=await rebuildChunk(job.tenant_id,table,offset);
 if(!next)return;
 await progress(`Indexed source table ${table+1}; continuing`);
 const key=`graph-rebuild:${next.table}:${next.offset}`;
 await enqueueStatement(job.tenant_id,'graph.rebuild',`${next.table}:${next.offset}`,next,{key,maxAttempts:5}).run();
});
