import {route} from '../../server/core';
import {searchWorkspace} from '../../server/search';
// One query box across the workspace. Every hit passes the same visibility rules as its module
// (see server/search.ts, which the AI assistant also uses).
export const GET=route(async(req,u)=>{
 const q=(new URL(req.url).searchParams.get('q')||'').trim().slice(0,80);
 if(q.length<2)return {results:[]};
 const hits=await searchWorkspace(u,[q],8);
 return {results:hits.map(({type,id,title,sub,link})=>({type,id,title,sub,link}))};
});
