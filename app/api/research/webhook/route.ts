import {db,hash,HttpError,json,failure,readBody} from '../../../server/core';
import {getJob,syncCloud} from '../../../server/research-cloud';
export async function POST(req:Request){try{
 const id=new URL(req.url).searchParams.get('recording'),token=req.headers.get('X-OWS-Webhook')||req.headers.get('X-Procus-Webhook');
 if(!id||!token||token.length>200)throw new HttpError(401,'Invalid callback.');
 const job=await getJob(id);if(!job||await hash(token)!==job.token_hash)throw new HttpError(401,'Invalid callback.');
 const b=await readBody(req);if(typeof b.transcript_id!=='string'||!/^[a-zA-Z0-9-]{1,160}$/.test(b.transcript_id))throw new HttpError(400,'Invalid job reference.');
 if(job.provider_id&&job.provider_id!==b.transcript_id)throw new HttpError(403,'Job reference mismatch.');
 // A valid per-job secret also recovers a submission whose response was lost.
 if(!job.provider_id)await db().prepare("UPDATE research_cloud_jobs SET provider_id=?,state='Queued',lease_until=0 WHERE recording_id=? AND token_hash=? AND provider_id IS NULL").bind(b.transcript_id,id,job.token_hash).run();
 await syncCloud(id,true);return json({ok:true});
 }catch(e){return failure(e)}}
