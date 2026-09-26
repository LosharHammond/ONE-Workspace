import {env} from 'cloudflare:workers';
import {db,hash,HttpError,auditStatement} from './core';
import {getResearch} from './research';
import type {Member} from './policy';
import {AssemblyError,uploadAssembly,submitAssembly,fetchAssembly,assemblyResult} from './assembly-provider';
type Job={recording_id:string,provider_id:string|null,token_hash:string,state:string,lease_until:number,attempts:number};
export const cloudReady=()=>!!env.ASSEMBLYAI_API_KEY;
export const getJob=(id:string)=>db().prepare('SELECT * FROM research_cloud_jobs WHERE recording_id=?').bind(id).first<Job>();
export async function syncCloud(id:string,force=false){
 const job=await getJob(id);if(!job?.provider_id||!['Queued','Transcribing','Submitting','Unknown'].includes(job.state))return;
 if(!env.ASSEMBLYAI_API_KEY)throw new HttpError(503,'AssemblyAI is not configured.');
 if(job.lease_until>Date.now()){if(force)throw new HttpError(503,'A status refresh is in progress. Retry callback.');return;}
 const lock=await db().prepare('UPDATE research_cloud_jobs SET lease_until=? WHERE recording_id=? AND token_hash=? AND lease_until<=?').bind(Date.now()+10000,id,job.token_hash,Date.now()).run();if(!lock.meta.changes){if(force)throw new HttpError(503,'A status refresh is in progress. Retry callback.');return;}
 try{
  const d=await fetchAssembly(env.ASSEMBLYAI_API_KEY,job.provider_id);if(d.id!==job.provider_id)throw new HttpError(502,'Cloud job reference mismatch.');
  const result=assemblyResult(d),now=new Date().toISOString();
  await db().batch([
   db().prepare('UPDATE research_recordings SET status=?,transcript=COALESCE(?,transcript),summary=COALESCE(?,summary),error=?,updated_at=?,lease_until=0,transcription_model=COALESCE(?,transcription_model),summary_model=? WHERE id=? AND EXISTS(SELECT 1 FROM research_cloud_jobs WHERE recording_id=? AND token_hash=?)').bind(result.status,result.transcript,result.summary,result.error,now,result.model,result.summary?'AssemblyAI Speech Understanding (beta)':null,id,id,job.token_hash),
   db().prepare('UPDATE research_cloud_jobs SET state=?,lease_until=? WHERE recording_id=? AND token_hash=?').bind(result.status,Date.now()+15000,id,job.token_hash)
  ]);
 }catch(e){await db().prepare('UPDATE research_cloud_jobs SET lease_until=0 WHERE recording_id=? AND token_hash=?').bind(id,job.token_hash).run();throw e}
}
export async function queueCloud(id:string,u:Member,callbackOrigin:string){
 if(!env.ASSEMBLYAI_API_KEY)throw new HttpError(503,'AssemblyAI setup is required. The administrator must add ASSEMBLYAI_API_KEY to the site secrets and publish the configuration.');
 const record=await getResearch(id);if(!record)throw new HttpError(404,'Recording not found.');if(record.status==='Ready')return;if(record.lease_until>Date.now())throw new HttpError(409,'This recording is already processing.');
 const existing=await getJob(id);
 if(existing&&['Queued','Transcribing','Submitting','Unknown'].includes(existing.state)){
  if(existing.provider_id){await syncCloud(id);return}
  if(existing.state==='Unknown')throw new HttpError(409,'Cloud submission is awaiting confirmation. Check the AssemblyAI dashboard before requesting another job.');
  throw new HttpError(409,'This recording is already being submitted or awaiting confirmation. Check the cloud job before retrying.');
 }
 const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hash(token);
 const lock=await db().prepare("INSERT INTO research_cloud_jobs(recording_id,provider_id,token_hash,state,lease_until,attempts) VALUES(?,NULL,?,'Submitting',?,1) ON CONFLICT(recording_id) DO UPDATE SET provider_id=NULL,token_hash=excluded.token_hash,state='Submitting',lease_until=excluded.lease_until,attempts=research_cloud_jobs.attempts+1 WHERE research_cloud_jobs.state IN ('Failed','Transcript ready')").bind(id,tokenHash,Date.now()+180000).run();
 if(!lock.meta.changes)throw new HttpError(409,'Another request is already processing this recording.');
 await db().prepare("UPDATE research_recordings SET status='Submitting',error=NULL,updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();
 let submitting=false;
 try{
  const obj=await env.BUCKET?.get(record.file_key);if(!obj)throw new HttpError(404,'Original recording unavailable.');
  const uploaded=await uploadAssembly(env.ASSEMBLYAI_API_KEY,await obj.arrayBuffer());
  const callback=new URL('/api/research/webhook',callbackOrigin);callback.searchParams.set('recording',id);
  if(callback.protocol!=='https:')throw new HttpError(503,'Cloud callbacks require a published HTTPS site.');
  submitting=true;
  const providerId=await submitAssembly(env.ASSEMBLYAI_API_KEY,uploaded,callback.toString(),token);
  await db().batch([
   db().prepare("UPDATE research_cloud_jobs SET provider_id=?,state='Queued',lease_until=0 WHERE recording_id=? AND token_hash=? AND state IN ('Submitting','Unknown')").bind(providerId,id,tokenHash),
   db().prepare("UPDATE research_recordings SET status='Queued',error=NULL,lease_until=0,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM research_cloud_jobs WHERE recording_id=? AND token_hash=? AND state='Queued')").bind(new Date().toISOString(),id,id,tokenHash),
   auditStatement(u,'Research cloud processing requested',id,'Consumer Research',null,{provider:'AssemblyAI'})
  ]);
 }catch(e){const uncertain=submitting&&(!(e instanceof AssemblyError)||e.uncertain);const message=e instanceof Error?e.message:'Cloud submission failed.';await db().batch([
  db().prepare('UPDATE research_cloud_jobs SET state=?,lease_until=0 WHERE recording_id=? AND token_hash=? AND provider_id IS NULL').bind(uncertain?'Unknown':'Failed',id,tokenHash),
  db().prepare('UPDATE research_recordings SET status=?,error=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM research_cloud_jobs WHERE recording_id=? AND token_hash=? AND provider_id IS NULL)').bind(uncertain?'Awaiting confirmation':'Failed',message.slice(0,400),new Date().toISOString(),id,id,tokenHash)
 ]);throw e}
}
