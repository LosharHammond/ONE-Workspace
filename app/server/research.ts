import {hasAction} from '../access-policy';
import {db,requireUser,HttpError} from './core';
import type {Member} from './policy';
export async function hasResearchAccess(u:Member){return hasAction(u,'research')}
export async function researchUser(req:Request,action='view'){const u=await requireUser(req);if(!hasAction(u,'research',action))throw new HttpError(403,'This research action has not been assigned to your account.');return u}
export type ResearchRow={id:string,title:string,context:string,filename:string,mime:string,bytes:number,file_key:string,created_by:string,created_at:string,updated_at:string,status:string,transcript:string|null,summary:string|null,error:string|null,lease_until:number,attempts:number};
// Pass the tenant for every signed-in request; only the signed webhook resolves a recording without one.
export const getResearch=(id:string,tenantId?:string)=>tenantId?db().prepare('SELECT * FROM research_recordings WHERE id=? AND tenant_id=?').bind(id,tenantId).first<ResearchRow>():db().prepare('SELECT * FROM research_recordings WHERE id=?').bind(id).first<ResearchRow>();
