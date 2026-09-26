import {env} from 'cloudflare:workers';
import {sameOrigin,readBody,HttpError,json,failure,origin} from '../../../server/core';
import {researchUser,getResearch} from '../../../server/research';
import {queueCloud,getJob} from '../../../server/research-cloud';
import {processSecondary} from '../../../server/research-secondary';
export async function POST(req:Request){try{const u=await researchUser(req,'process');sameOrigin(req);const b=await readBody(req);if(typeof b.id!=='string')throw new HttpError(400,'Select a recording.');
const row=await getResearch(b.id,u.tenantId);if(!row)throw new HttpError(404,'Recording not found.');if(row.status==='Ready')return json({status:'Ready'});
const job=await getJob(b.id);
if(b.provider==='groq'||(!env.ASSEMBLYAI_API_KEY&&env.GROQ_API_KEY)||((job?.state==='Failed'||row.status==='Transcript ready')&&env.GROQ_API_KEY))await processSecondary(b.id,u);
else {try{await queueCloud(b.id,u,origin(req))}catch(e){const latest=await getJob(b.id);if(env.GROQ_API_KEY&&latest?.state==='Failed')await processSecondary(b.id,u);else throw e}}
const final=await getResearch(b.id,u.tenantId);return json({status:final?.status,error:final?.error});}catch(e){return failure(e)}}
