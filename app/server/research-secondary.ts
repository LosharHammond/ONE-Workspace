import {env} from 'cloudflare:workers';
import {db,HttpError,auditStatement} from './core';
import type {Member} from './policy';
import {getResearch} from './research';
import {getJob} from './research-cloud';
import {groqTranscribe,groqSummary,GROQ_TRANSCRIPTION_MODEL,GROQ_SUMMARY_MODEL} from './groq-provider';
export async function processSecondary(id:string,u:Member){
 if(!env.GROQ_API_KEY)throw new HttpError(503,'Add GROQ_API_KEY to the site secrets to enable secondary processing.');
 const job=await getJob(id);if(job&&['Queued','Transcribing','Submitting','Unknown'].includes(job.state))throw new HttpError(409,'An AssemblyAI job is still active or awaiting confirmation.');
 const locked=await db().prepare("UPDATE research_recordings SET status=CASE WHEN transcript IS NULL THEN 'Transcribing' ELSE 'Summarizing' END,lease_until=?,error=NULL,updated_at=? WHERE id=? AND status!='Ready' AND lease_until<?").bind(Date.now()+420000,new Date().toISOString(),id,Date.now()).run();
 if(!locked.meta.changes)throw new HttpError(409,'This recording is already processing or complete.');
 try{const r=(await getResearch(id))!;let text=r.transcript;
  if(!text){const obj=await env.BUCKET?.get(r.file_key);if(!obj)throw Error('Original recording unavailable.');text=await groqTranscribe(env.GROQ_API_KEY,new File([await obj.arrayBuffer()],r.filename,{type:r.mime}));await db().prepare("UPDATE research_recordings SET transcript=?,transcription_model=?,status='Summarizing',updated_at=? WHERE id=?").bind(text,GROQ_TRANSCRIPTION_MODEL,new Date().toISOString(),id).run()}
  const summary=await groqSummary(env.GROQ_API_KEY,text,r.title,r.context);
  await db().batch([db().prepare("UPDATE research_recordings SET summary=?,summary_model=?,status='Ready',error=NULL,lease_until=0,updated_at=? WHERE id=?").bind(summary,GROQ_SUMMARY_MODEL,new Date().toISOString(),id),auditStatement(u,'Research secondary analysis completed',id,'Consumer Research',null,{provider:'Groq'})]);
 }catch(e){await db().prepare("UPDATE research_recordings SET status=CASE WHEN transcript IS NULL THEN 'Failed' ELSE 'Transcript ready' END,error=?,lease_until=0,updated_at=? WHERE id=?").bind((e instanceof Error?e.message:'Groq processing failed.').slice(0,400),new Date().toISOString(),id).run();throw e}
}
