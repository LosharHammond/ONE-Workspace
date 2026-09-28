import {HttpError} from './core';

// Calls another module's own API handler with the SAME signed-in session (cookie) and origin, so every rule,
// permission check, validation, audit entry and domain event of the source module applies unchanged. Used by
// the Universal Work Inbox and the request-to-outcome lifecycle instead of re-implementing module logic.
const MODULES={
 projects:()=>import('../api/projects/route'),purchasing:()=>import('../api/purchasing/route'),tasks:()=>import('../api/tasks/route'),tickets:()=>import('../api/tickets/route'),
 maintenance:()=>import('../api/maintenance/route'),pages:()=>import('../api/pages/route'),messages:()=>import('../api/messages/route'),comments:()=>import('../api/comments/route'),
 studioRecords:()=>import('../api/studio/records/route'),studio:()=>import('../api/studio/route'),agents:()=>import('../api/agents/route'),fabric:()=>import('../api/connectors/fabric/route'),
 business:()=>import('../api/business/route'),assets:()=>import('../api/assets/route'),files:()=>import('../api/files/route'),
} as const;
export type ModuleName=keyof typeof MODULES;
export async function dispatch<T=Record<string,unknown>>(req:Request,module:ModuleName,body:Record<string,unknown>):Promise<T>{
 const url=new URL(req.url);const mod=await MODULES[module]();
 const handler=(mod as unknown as {POST:(r:Request)=>Promise<Response>}).POST;
 const headers=new Headers({'Content-Type':'application/json',Origin:url.origin});for(const h of ['cookie','cf-connecting-ip','x-forwarded-for','user-agent'])if(req.headers.get(h))headers.set(h,req.headers.get(h)!);
 const res=await handler(new Request(new URL(`/api/${module}`,url.origin),{method:'POST',headers,body:JSON.stringify(body)}));
 const data=await res.json().catch(()=>({})) as T&{error?:string};
 if(!res.ok)throw new HttpError(res.status,data.error||'The action could not be completed.');
 return data;
}
