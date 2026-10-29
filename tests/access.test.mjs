// RBAC rules (src/domain/access.ts), escalation guards (A-C1/A-C2/A-H2) and the v4 role migration.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import * as X from '../.test-dist/access.mjs'
import {LEGACY_ROLES,SCHEMA_VERSION,migrateState,permissionKeys} from '../.test-dist/migrations.mjs'
import {createSeedState,createInitialState} from '../.test-dist/mockData.mjs'

let n=0
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-a${++n}`})
const fresh=()=>createSeedState(new Date())
const roleByKey=(s,key)=>s.roles.find(r=>r.key===key)
/** Seed plus: em8 Super Admin, em9 a second admin. em1 is the seed's Admin / Direktor. */
function withPeople(){
  const s=fresh()
  const e=s.employees[0]
  return {...s,employees:[...s.employees,{...e,id:'em8',name:'Super Bosh',roleId:'role0'},{...e,id:'em9',name:'Ikkinchi Admin',roleId:'role1'}]}
}

/* ------------------------------------------------ the 61 actions before / after -- */

/** Permission table the app used before RBAC v4 (AppContext.ACTION_PERMISSIONS, schema ≤ 3). */
const OLD={
  createProductionOrder:[['production','create']],updateProductionOrder:[['production','edit']],transitionProduction:[['production','edit']],shortCloseProduction:[['production','edit']],reportOutput:[['production','edit']],recordScrap:[['production','edit']],
  splitProduction:[['production','edit']],mergeProduction:[['production','edit']],createBackorder:[['production','edit']],unbuildProduct:[['production','edit']],checkAvailability:[['production','edit']],
  startWorkOrder:[['production','edit']],pauseWorkOrder:[['production','edit']],finishWorkOrder:[['production','edit']],setForecast:[['production','edit']],recordMaterialScan:[['production','edit']],rollUpCosts:[['products','edit']],
  createReworkOrder:[['quality','edit'],['production','create']],createQualityCheck:[['quality','create'],['production','edit']],resolveQuality:[['quality','edit']],createQualityAlert:[['quality','create']],
  createPurchaseOrder:[['purchases','create']],createPurchaseOrders:[['purchases','create']],linkSupplierMaterial:[['purchases','edit'],['materials','edit']],updateSupplierMaterial:[['purchases','edit'],['materials','edit']],removeSupplierMaterial:[['purchases','edit'],['materials','edit']],setPreferredSupplier:[['materials','edit'],['purchases','edit']],confirmPurchase:[['purchases','approve']],markPurchaseInTransit:[['purchases','edit']],cancelPurchase:[['purchases','edit']],updatePurchaseMeta:[['purchases','edit']],receivePurchase:[['purchases','edit'],['warehouse','edit']],returnPurchaseToSupplier:[['purchases','edit'],['warehouse','edit']],advanceSubcontract:[['purchases','edit']],
  createSalesOrder:[['sales','create']],reserveSalesOrder:[['sales','edit']],deliverSalesOrder:[['sales','edit'],['warehouse','edit']],cancelSalesOrder:[['sales','edit']],updateSalesMeta:[['sales','edit']],createReturn:[['sales','create'],['quality','create']],dispositionReturn:[['quality','edit']],
  transferStock:[['warehouse','edit']],adjustStock:[['warehouse','edit']],countStock:[['warehouse','edit']],
  startDowntime:[['equipment','edit'],['production','edit']],endDowntime:[['equipment','edit'],['production','edit']],approveMaintenanceRequest:[['equipment','approve']],startMaintenance:[['equipment','edit']],completeMaintenance:[['equipment','edit']],cancelMaintenance:[['equipment','edit']],planPreventiveMaintenance:[['equipment','create']],advanceRepair:[['equipment','edit']],
  createBomDraft:[['products','create']],saveBom:[['products','edit']],deleteBomDraft:[['products','delete']],activateBom:[['products','approve']],createEngineeringChange:[['products','create']],setEcoStatus:[['products','approve']],applyEngineeringChange:[['products','approve']],
  updateRolePermission:[['employees','edit']],switchUser:[['employees','edit']],
}

/**
 * Every intended change, per pre-existing role (untouched seed permissions). Anything else that changed would
 * be a regression. Operator: only shop-floor execution (A-H5 / BUG-15); production manager: no QC or
 * maintenance approval decisions, may raise purchase requests; the demo user switcher is gone (A-C2).
 */
const INTENDED={
  role1:['switchUser:allowed→refused'],
  role2:['resolveQuality:allowed→refused','createPurchaseOrder(Qoralama):refused→allowed','createPurchaseOrders(Qoralama):refused→allowed','createReturn:allowed→refused','dispositionReturn:allowed→refused','approveMaintenanceRequest:allowed→refused'],
  role5:['updateProductionOrder:allowed→refused','transitionProduction(Tasdiqlangan):allowed→refused','transitionProduction(Yakunlangan):allowed→refused','transitionProduction(Bekor qilingan):allowed→refused','shortCloseProduction:allowed→refused','splitProduction:allowed→refused','mergeProduction:allowed→refused','createBackorder:allowed→refused','unbuildProduct:allowed→refused','checkAvailability:allowed→refused','setForecast:allowed→refused','createQualityAlert:refused→allowed'],
}

test('A-61: all 61 actions keep their permission outcome for the five existing roles, except the documented changes',()=>{
  assert.equal(Object.keys(OLD).length,61)
  const legacy=Object.entries(LEGACY_ROLES).map(([id,r])=>({id,name:r.name,scope:'all',permissions:r.permissions}))
  const migrated=migrateState({roles:legacy,productionOrders:[],employees:[],schemaVersion:3}).state.roles
  const diff={}
  for(const r of legacy){
    const after=migrated.find(x=>x.id===r.id)
    for(const name of Object.keys(OLD)){
      // A PO created as a draft needs "create"; one created already approved needs "approve" (A-M6).
      const po=st=>name==='createPurchaseOrders'?[{status:st}]:{status:st}
      const variants=name==='transitionProduction'?['Tasdiqlangan','Jarayonda','Pauzada','Sifat nazoratida','Yakunlangan','Bekor qilingan'].map(st=>[['x',st],`${name}(${st})`])
        :name.startsWith('createPurchaseOrder')?['Qoralama','Tasdiqlangan'].map(st=>[[po(st)],`${name}(${st})`]):[[[],name]]
      for(const [args,label] of variants){
        const before=OLD[name].some(([m,a])=>r.permissions?.[m]?.[a]===true)
        const rules=X.actionRules(name,args)
        const now=rules?X.allowedBy(after,rules):false
        if(before!==now)(diff[r.id]??=[]).push(`${label}:${before?'allowed':'refused'}→${now?'allowed':'refused'}`)
      }
    }
  }
  assert.deepEqual(diff,INTENDED)
})

test('every domain action the app exposes has a permission rule',()=>{
  for(const name of Object.keys(OLD).filter(x=>x!=='switchUser'))assert.ok(X.actionRules(name,['x','Jarayonda']),name)
  for(const name of ['closePurchaseShort','createRole','duplicateRole','updateRole','deleteRole'])assert.ok(X.actionRules(name),name)
})

test('execute: operators run work but cannot plan, cancel or close orders',()=>{
  const s=fresh(),op=roleByKey(s,'operator')
  for(const st of ['Jarayonda','Pauzada','Sifat nazoratida'])assert.ok(X.allowedBy(op,X.actionRules('transitionProduction',['x',st])),st)
  for(const st of ['Tasdiqlangan','Yakunlangan','Bekor qilingan'])assert.equal(X.allowedBy(op,X.actionRules('transitionProduction',['x',st])),false,st)
  for(const name of ['reportOutput','recordScrap','startWorkOrder','finishWorkOrder','recordMaterialScan','startDowntime'])assert.ok(X.allowedBy(op,X.actionRules(name)),name)
  for(const name of ['createProductionOrder','splitProduction','shortCloseProduction','resolveQuality','adjustStock','createReturn'])assert.equal(X.allowedBy(op,X.actionRules(name)),false,name)
})

test('Super Admin holds every permission; the dashboard is open to every role',()=>{
  const s=fresh()
  for(const m of X.PERMISSION_MODULES)for(const a of m.actions)assert.ok(X.hasPermission(roleByKey(s,'super_admin'),m.key,a))
  for(const r of s.roles)assert.ok(X.hasPermission(r,'dashboard','view'))
  assert.equal(X.hasPermission(undefined,'dashboard','view'),false,'no role, no access')
})

/* ------------------------------------------------------------ escalation -- */

test('A-C1: nobody edits their own role, and nobody grants a permission they do not hold',()=>{
  let s=fresh()
  // A custom HR role that manages roles but has no settings rights.
  s={...s,roles:[...s.roles,{id:'hr',name:'HR',scope:'all',permissions:{employees:{view:true,edit:true},roles:{view:true,edit:true}}}],employees:s.employees.map(e=>e.id==='em2'?{...e,roleId:'hr'}:e)}
  assert.match(A.updateRolePermission(s,ctx(s,'em2'),'hr','settings','edit',true).result.message,/O‘z rolingiz/)
  assert.match(A.updateRolePermission(s,ctx(s,'em2'),'role5','settings','view',true).result.message,/darajangizda|huquqi yo‘q/)
  assert.match(A.updateRolePermission(s,ctx(s),'role1','costs','view',false).result.message,/O‘z rolingiz/,'the admin cannot change the admin role')
  assert.match(A.updateRolePermission(s,ctx(s),'role0','costs','view',false).result.message,/Super Admin/)
  assert.ok(A.updateRolePermission(s,ctx(s),'role5','quality','edit',true).result.ok,'the admin edits a lower role with a permission it holds')
})

test('A-C2: no one promotes themselves or hands out a role at or above their own rank',()=>{
  const s=withPeople()
  assert.match(A.updateEntity(s,ctx(s,'em2'),'employees','em2',{roleId:'role1'},'Xodim').result.message,/O‘z rolingiz/)
  assert.match(A.updateEntity(s,ctx(s),'employees','em3',{roleId:'role1'},'Xodim').result.message,/Super Admin/,'the admin cannot create another admin')
  assert.match(A.updateEntity(s,ctx(s),'employees','em3',{roleId:'role0'},'Xodim').result.message,/Super Admin/)
  assert.match(A.createEntity(s,ctx(s),'employees',{name:'Yangi Kishi',roleId:'role0',status:'Faol'},'Xodim').result.message,/Super Admin/)
  assert.match(A.updateEntity(s,ctx(s),'employees','em9',{shift:'B'},'Xodim').result.message,/darajangizda/,'an admin does not edit another admin')
  assert.ok(A.updateEntity(s,ctx(s),'employees','em3',{roleId:'role6'},'Xodim').result.ok,'the admin assigns a lower role')
  assert.ok(A.updateEntity(s,ctx(s,'em8'),'employees','em9',{roleId:'role2'},'Xodim').result.ok,'the Super Admin may demote an admin')
})

test('A-H2: the last Super Admin and the acting user cannot be blocked, demoted or deleted',()=>{
  const s=withPeople()
  assert.match(A.updateEntity(s,ctx(s,'em8'),'employees','em8',{status:'Arxiv'},'Xodim').result.message,/O‘zingizni/)
  assert.match(A.deleteEntity(s,ctx(s,'em8'),'employees','em8','Xodim').result.message,/O‘zingizni/)
  assert.match(A.deleteEntity(s,ctx(s),'employees','em8','Xodim').result.message,/Super Admin/)
  assert.match(A.updateEntity(s,ctx(s),'employees','em8',{status:'Arxiv'},'Xodim').result.message,/Super Admin/)
  // With a second Super Admin, one may retire the other; the remaining one is protected again.
  const two={...s,employees:s.employees.map(e=>e.id==='em9'?{...e,roleId:'role0'}:e)}
  const demoted=A.updateEntity(two,ctx(two,'em8'),'employees','em9',{roleId:'role1'},'Xodim')
  assert.ok(demoted.result.ok,demoted.result.message)
  assert.equal(X.superAdminEmployees(demoted.state).length,1)
  // Defence in depth: even a Super Admin actor cannot demote the only active Super Admin (here the actor is archived).
  const lone={...s,employees:[...s.employees,{...s.employees[0],id:'em10',name:'Arxiv Super',roleId:'role0',status:'Arxiv'}]}
  const actor=lone.employees.find(e=>e.id==='em10')
  assert.match(X.assignRoleBlocker(lone,actor,lone.employees.find(e=>e.id==='em8'),'role1')||'',/Oxirgi faol Super Admin/)
  assert.match(X.employeeRemovalBlocker(lone,actor,'em8')||'',/Oxirgi faol Super Admin/)
})

test('roles: system roles and roles in use are never deleted; a copy holds only the copier’s permissions',()=>{
  let s=withPeople()
  assert.match(A.deleteRole(s,ctx(s,'em8'),'role5').result.message,/tizim roli/)
  const created=A.createRole(s,ctx(s),{name:'Smena boshlig‘i'});assert.ok(created.result.ok);s=created.state
  s={...s,employees:s.employees.map(e=>e.id==='em7'?{...e,roleId:created.result.id}:e)}
  assert.match(A.deleteRole(s,ctx(s),created.result.id).result.message,/biriktirilgan/)
  s={...s,employees:s.employees.map(e=>e.id==='em7'?{...e,roleId:'role5'}:e)}
  assert.ok(A.deleteRole(s,ctx(s),created.result.id).result.ok)
  // em2 (production manager) copies the admin role: only what em2 holds is copied.
  const copy=A.duplicateRole(s,ctx(s,'em2'),'role1');assert.ok(copy.result.ok);const role=copy.state.roles.find(r=>r.id===copy.result.id)
  const pm=roleByKey(s,'production_manager')
  for(const key of permissionKeys(role.permissions)){const [m,a]=key.split('.');assert.ok(X.hasPermission(pm,m,a),key)}
  assert.equal(X.hasPermission(role,'users','edit'),false)
})

/* ------------------------------------------------------------ migration v4 -- */

/** Data as saved before v4: the five legacy roles, no schema version, no cost snapshots. */
function legacyState(){
  const s=fresh()
  const roles=Object.entries(LEGACY_ROLES).map(([id,r])=>({id,name:r.name,scope:'all',permissions:JSON.parse(JSON.stringify(r.permissions))}))
  const {schemaVersion,...rest}=s
  return {...rest,roles,productionOrders:s.productionOrders.map(o=>{const {costSnapshot,...x}=o;return x})}
}

test('v4 migration: eight roles, ids and assignments kept, untouched roles get the new defaults',()=>{
  const before=legacyState()
  const {state:after,applied}=migrateState(before)
  assert.equal(after.schemaVersion,SCHEMA_VERSION)
  // v3 data runs the v4 step and then the v5 version mark (Phase 5), in order.
  assert.deepEqual(applied.map(a=>a.split(':')[0]),['v4','v5'])
  assert.deepEqual(after.roles.map(r=>r.key).sort(),['admin','maintenance','operator','production_manager','quality','super_admin','supply_sales','warehouse'])
  for(const id of ['role1','role2','role3','role4','role5'])assert.ok(after.roles.some(r=>r.id===id),id)
  assert.deepEqual(after.employees,before.employees,'every employee keeps their role id')
  assert.equal(roleByKey(after,'operator').permissions.production.edit,undefined,'untouched operator gets execute-only defaults')
  assert.equal(roleByKey(after,'admin').name,'Admin / Direktor')
})

test('v4 migration keeps customised and custom roles, adding execute where production editing was allowed',()=>{
  const before=legacyState()
  before.roles=before.roles.map(r=>r.id==='role5'?{...r,name:'Katta operator',permissions:{...r.permissions,reports:{view:true}}}:r)
  before.roles.push({id:'role-custom-x',name:'Planner',scope:'all',permissions:{production:{view:true,edit:true}}})
  const {state:after}=migrateState(before)
  const op=after.roles.find(r=>r.id==='role5')
  assert.equal(op.name,'Katta operator','a renamed role keeps its name')
  assert.equal(op.permissions.production.edit,true,'customised permissions are kept')
  assert.equal(op.permissions.production.execute,true)
  assert.equal(op.permissions.reports.view,true)
  const custom=after.roles.find(r=>r.id==='role-custom-x')
  assert.equal(custom.name,'Planner')
  assert.equal(custom.permissions.production.execute,true)
  assert.equal(custom.key,undefined)
})

test('v4 migration is idempotent, changes no business data and freezes completed order costs',()=>{
  const before=legacyState()
  const once=migrateState(before).state
  const twice=migrateState(once)
  assert.equal(twice.applied.length,0)
  assert.equal(twice.state,once,'a migrated state is returned unchanged')
  for(const key of Object.keys(before).filter(k=>!['roles','productionOrders'].includes(k)))assert.deepEqual(once[key],before[key],key)
  for(const o of once.productionOrders){
    const old=before.productionOrders.find(x=>x.id===o.id)
    const {costSnapshot,...rest}=o
    assert.deepEqual(rest,old,o.code)
    assert.equal(Boolean(costSnapshot),o.status==='Yakunlangan',o.code)
  }
})

test('a fresh install is already current and needs no migration',()=>{
  const s=createInitialState()
  assert.equal(s.schemaVersion,SCHEMA_VERSION)
  assert.equal(migrateState(s).applied.length,0)
  assert.equal(s.roles.length,8)
  assert.ok(s.roles.every(r=>r.system&&r.key))
})

test('a state marked v4 whose roles were never upgraded is still upgraded (version number is not trusted alone)',()=>{
  const s={...legacyState(),schemaVersion:SCHEMA_VERSION}
  const {state,applied}=migrateState(s)
  assert.equal(applied.length,1)
  assert.ok(state.roles.some(r=>r.key==='super_admin'))
  assert.equal(migrateState(state).applied.length,0)
})
