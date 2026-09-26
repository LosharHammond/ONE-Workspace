import {researchUser,getResearch} from '../../../server/research';
import {sameOrigin,readBody,HttpError,json,failure} from '../../../server/core';
import {syncCloud} from '../../../server/research-cloud';
export async function POST(req:Request){try{const u=await researchUser(req);sameOrigin(req);const b=await readBody(req);if(typeof b.id!=='string')throw new HttpError(400,'Select a recording.');if(!await getResearch(b.id,u.tenantId))throw new HttpError(404,'Recording not found.');await syncCloud(b.id);const r=await getResearch(b.id,u.tenantId);return json({status:r?.status,error:r?.error})}catch(e){return failure(e)}}
