// Unit tests for the permission engine shared by the API and the UI.  npm run test:unit
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionScope,hasAction,canActOn,roleRules,inScope} from '../../app/access-policy.ts';

const user=(o={})=>({id:'u1',role:'employee',department:'IT',active:1,rules:[],...o});

test('deny by default: unknown pages and actions resolve to none',()=>{
 assert.equal(actionScope(user(),'nonexistent','view'),'none');
 assert.equal(actionScope(user(),'assets','fly'),'none');
 assert.equal(actionScope(user({active:0}),'people','view'),'none');
});
test('View is required before any other action',()=>{
 const u=user({roleId:'r1',rules:roleRules('r1',JSON.stringify({budgets:{create:'all',view:'none'}}))});
 assert.equal(hasAction(u,'budgets','create'),false);
});
test('disabled modules are refused even for Company Admins',()=>{
 const admin=user({role:'admin',disabledPages:['inventory']});
 assert.equal(actionScope(admin,'inventory','view'),'none');
 assert.equal(actionScope(admin,'assets','view'),'all');
});
test('own and department scopes',()=>{
 const u=user();
 assert.equal(inScope(u,'own','IT','u1'),true);assert.equal(inScope(u,'own','IT','u2'),false);
 assert.equal(inScope(u,'department','IT','u2'),true);assert.equal(inScope(u,'department','Finance','u2'),false);
 assert.equal(inScope(user({extraDepartments:['Finance']}),'department','Finance','u2'),true,'selected departments extend department scope');
});
test('custom role permissions override the baseline, including explicit deny',()=>{
 const u=user({roleId:'r1',rules:roleRules('r1',JSON.stringify({people:{view:'none'},assets:{view:'all',update:'all'}}))});
 assert.equal(actionScope(u,'people','view'),'none');
 assert.equal(canActOn(u,'assets','update','Finance','someone'),true);
});
test('shared libraries require page-wide scope',()=>{
 const u=user({roleId:'r1',rules:roleRules('r1',JSON.stringify({research:{view:'department'}}))});
 assert.equal(actionScope(u,'research','view'),'none');
});
