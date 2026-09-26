import type {Member} from './policy';
import {hasAction} from '../access-policy';
export function hasITAccess(u:Member){return hasAction(u,'it')}
