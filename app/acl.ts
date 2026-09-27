// Content access control shared by files, folders, announcements, pages, projects, tasks and channels.
// The server is the source of truth (server/acl.ts); the browser uses these types to build audience pickers.
export type Audience='private'|'department'|'departments'|'people'|'roles'|'groups'|'locations'|'project'|'space'|'company';
export type Acl={mode:Audience,departments?:string[],people?:string[],roles?:string[],groups?:string[],locations?:string[],projectId?:string|null,spaceId?:string|null,editors?:string[]};
export const audienceLabels:Record<Audience,string>={private:'Only me',department:'My department',departments:'Selected departments',people:'Selected people',roles:'Selected roles',groups:'Selected groups',locations:'Selected locations',project:'Project team',space:'Space members',company:'Everyone in the company'};
export const contentPermissions=['view','comment','download','upload','edit','share','publish','moderate','delete','restore','manage_access'] as const;
export function describeAcl(a:Acl,names?:{departments?:Record<string,string>,groups?:Record<string,string>,people?:Record<string,string>,roles?:Record<string,string>}){
 const list=(xs:string[]|undefined,m?:Record<string,string>)=>(xs||[]).map(x=>m?.[x]||x).join(', ');
 switch(a.mode){
  case 'department':return `Department: ${list(a.departments)}`;
  case 'departments':return `Departments: ${list(a.departments)}`;
  case 'people':return `People: ${list(a.people,names?.people)}`;
  case 'roles':return `Roles: ${list(a.roles,names?.roles)}`;
  case 'groups':return `Groups: ${list(a.groups,names?.groups)}`;
  case 'locations':return `Locations: ${list(a.locations)}`;
  default:return audienceLabels[a.mode];
 }
}
