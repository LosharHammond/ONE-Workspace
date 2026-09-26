import {sameOrigin,sessionToken,hash,db,origin,failure,clearSessionCookies,now} from '../../../server/core';
export async function POST(req:Request){try{
 sameOrigin(req);const token=sessionToken(req);
 if(token){const h=await hash(token);
  // Signing out also closes any open support session started from this browser session.
  await db().batch([db().prepare('UPDATE support_sessions SET ended_at=? WHERE ended_at IS NULL AND id=(SELECT support_session_id FROM sessions WHERE token_hash=?)').bind(now(),h),db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(h)]);
 }
 const headers=new Headers({Location:origin(req),'Cache-Control':'no-store'});for(const c of clearSessionCookies())headers.append('Set-Cookie',c);return new Response(null,{status:303,headers});
}catch(e){return failure(e)}}
