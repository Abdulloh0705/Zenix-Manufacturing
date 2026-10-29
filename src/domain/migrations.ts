// Versioned, idempotent upgrades of saved data. Each step only adds or completes data; nothing a user entered
// is removed. The caller stores a backup before the first migrated state is saved (see AppContext.hydrate).
import type {ManufacturingState,PermissionAction,PermissionMap,Role} from '../types'
import {SYSTEM_ROLES} from './access'
import {actualOrderCost,estimateOrderCost} from './manufacturingEngine'

/**
 * v5 (Phase 5): serial units, supplier replacements, keyed notifications, legacy-credit decisions and the zone
 * history. Nothing stored changes shape, but a v4 build would write data that breaks these rules (serial material
 * received without numbers, replacement receipts counted as PO receipts, returns credited without a decision) —
 * so v5 data is marked, and a v4 build that knows the newer-version lock opens it read-only.
 */
export const SCHEMA_VERSION=5

/** Role names and permissions the app shipped before system roles existed (schema ≤ 3). */
const LEGACY_MODULES=['dashboard','production','products','materials','warehouse','purchases','sales','quality','equipment','employees','costs','reports','settings','ai']
const legacyAll=(list:string[])=>Object.fromEntries(list.map(m=>[m,{view:true,create:true,edit:true,delete:true,approve:true,export:true}]))
const legacyView=(list:string[])=>Object.fromEntries(list.map(m=>[m,{view:true,create:false,edit:false,delete:false,approve:false,export:true}]))
export const LEGACY_ROLES:Record<string,{name:string;permissions:PermissionMap}>={
  role1:{name:'Production Admin',permissions:legacyAll(LEGACY_MODULES)},
  role2:{name:'Supervisor',permissions:{...legacyAll(['dashboard','production','products','materials','warehouse','quality','equipment','ai']),...legacyView(['employees','reports','purchases','sales'])}},
  role3:{name:'Quality Inspector',permissions:{...legacyAll(['dashboard','quality','ai']),...legacyView(['production','products','reports'])}},
  role4:{name:'Maintenance Engineer',permissions:{...legacyAll(['dashboard','equipment','ai']),...legacyView(['production','reports'])}},
  role5:{name:'Operator',permissions:{dashboard:{view:true},production:{view:true,create:false,edit:true,delete:false,approve:false,export:false},...legacyView(['quality','products'])}},
}

const granted=(p:PermissionMap)=>JSON.stringify(Object.entries(p).flatMap(([m,a])=>Object.entries(a).filter(([,v])=>v).map(([k])=>`${m}.${k}`)).sort())
const samePermissions=(a:PermissionMap,b:PermissionMap)=>granted(a)===granted(b)

/** Keeps what a role could do before `execute` existed: whoever could edit production may also run it. */
function withExecute(p:PermissionMap):PermissionMap{
  return p.production?.edit?{...p,production:{...p.production,execute:true}}:p
}

/**
 * v4: the eight system roles. Roles a user never changed get the new defaults; customised ones keep their
 * permissions (plus `execute` where production editing was allowed, and the new admin modules for the admin role).
 * Custom roles stay as they are, with `execute` added the same way.
 */
function migrateRoles(roles:Role[]):Role[]{
  const next=roles.map(role=>{
    const def=SYSTEM_ROLES.find(d=>d.id===role.id)
    if(!def)return role.key?role:{...role,permissions:withExecute(role.permissions||{})}
    if(role.key)return role
    const legacy=LEGACY_ROLES[role.id]
    const untouched=legacy&&samePermissions(role.permissions||{},legacy.permissions)
    let permissions=untouched?def.permissions:withExecute(role.permissions||{})
    // The former all-modules admin keeps administering people and roles in the new modules.
    if(!untouched&&def.key==='admin')permissions={...permissions,users:def.permissions.users,roles:def.permissions.roles,audit:def.permissions.audit}
    return {...role,key:def.key,system:true,name:legacy&&role.name===legacy.name?def.name:role.name,description:role.description||def.description,scope:untouched?def.scope:role.scope,permissions}
  })
  for(const def of SYSTEM_ROLES){
    if(next.some(r=>r.key===def.key))continue
    // An id taken by a user's own role is never overwritten: the system role gets a free id.
    let id=def.id,n=0
    while(next.some(r=>r.id===id)){n+=1;id=`${def.id}_${n}`}
    next.push({id,key:def.key,system:true,name:def.name,scope:def.scope,description:def.description,permissions:def.permissions})
  }
  return next
}

/** v4 also freezes the cost of orders completed before costs were frozen at completion (BUG-08): history stops drifting from now on. */
function freezeCompletedCosts(s:ManufacturingState):ManufacturingState{
  const round=(c:{material:number;labor:number;machine:number;overhead:number})=>{const material=Math.round(c.material),labor=Math.round(c.labor),machine=Math.round(c.machine),overhead=Math.round(c.overhead);return {material,labor,machine,overhead,total:material+labor+machine+overhead}}
  return {...s,productionOrders:s.productionOrders.map(o=>o.status!=='Yakunlangan'||o.costSnapshot?o:{...o,costSnapshot:{planned:round(estimateOrderCost(s,o)),actual:round(actualOrderCost(s,o)),at:'migration-v4'}})}
}

export type MigrationResult={state:ManufacturingState;applied:string[]}

/** Brings saved data to SCHEMA_VERSION. Running it again on migrated data changes nothing. */
export function migrateState(s:ManufacturingState):MigrationResult{
  const from=s.schemaVersion??3
  // The version number alone is not trusted: data marked v4 whose roles were never upgraded (an interrupted
  // save, a hand-edited backup) is upgraded too. Each step is idempotent, so re-running it is safe.
  const rolesUpgraded=(s.roles||[]).some(r=>r.key==='super_admin')
  if(from>=SCHEMA_VERSION&&rolesUpgraded)return {state:s,applied:[]}
  let next=s
  const applied:string[]=[]
  if(from<4||!rolesUpgraded){
    next={...next,roles:migrateRoles(next.roles||[])}
    next=freezeCompletedCosts(next)
    applied.push('v4: 8 ta tizim roli, execute huquqi, admin modullari, yakunlangan MO tannarxi muzlatildi')
  }
  // v5 adds no stored shape to repair: lists it introduced start empty (normalizeLoaded), serial ranges saved before
  // unit tracking stay readable as they are. Only the version mark changes, after a backup of the v4 data.
  if(from<5)applied.push('v5: serial birliklar, supplier almashtirishi, kalitli bildirishnomalar, zona tarixi — mavjud yozuvlar o‘zgarmadi')
  return {state:{...next,schemaVersion:SCHEMA_VERSION},applied}
}

/** Permissions a role holds, as `module.action` keys — used by tests and the admin role diff. */
export function permissionKeys(p:PermissionMap):string[]{
  return Object.entries(p).flatMap(([m,a])=>(Object.entries(a) as [PermissionAction,boolean][]).filter(([,v])=>v).map(([k])=>`${m}.${k}`)).sort()
}
