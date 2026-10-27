// Authorization rules, kept pure (no React) so every rule is unit-tested and can move to a backend 1:1.
// The app enforces them in AppContext before any domain action runs; this frontend-only enforcement is a
// usability and integrity guard, not a security boundary (anyone with DevTools can change browser storage).
import type {Employee,ManufacturingState,PermissionAction,PermissionMap,Role,SystemRoleKey} from '../types'
import {rawWarehouseFor,unbuildSource} from './manufacturingEngine'

type S=ManufacturingState
export type Rule=[module:string,action:PermissionAction]
/** Any one of the rules allows the action. */
export type Rules=Rule[]

export const PERMISSION_ACTIONS:Array<{key:PermissionAction;label:string}>=[
  {key:'view',label:'Ko‘rish'},{key:'create',label:'Yaratish'},{key:'edit',label:'Tahrir'},{key:'delete',label:'O‘chirish'},
  {key:'approve',label:'Tasdiqlash'},{key:'export',label:'Eksport'},{key:'execute',label:'Bajarish'},
]

/** Every permission module, in matrix order, with the actions that mean something for it. */
export const PERMISSION_MODULES:Array<{key:string;label:string;icon:string;actions:PermissionAction[];admin?:boolean}>=[
  {key:'production',label:'Ishlab chiqarish',icon:'factory',actions:['view','create','edit','delete','approve','export','execute']},
  {key:'products',label:'Mahsulotlar va BOM',icon:'box',actions:['view','create','edit','delete','approve','export']},
  {key:'materials',label:'Xomashyo',icon:'layers',actions:['view','create','edit','delete','export']},
  {key:'warehouse',label:'Ombor',icon:'warehouse',actions:['view','create','edit','delete','export']},
  {key:'purchases',label:'Xaridlar',icon:'cart',actions:['view','create','edit','delete','approve','export']},
  {key:'sales',label:'Sotuv',icon:'truck',actions:['view','create','edit','delete','export']},
  {key:'quality',label:'Sifat',icon:'shield',actions:['view','create','edit','delete','approve','export']},
  {key:'equipment',label:'Uskunalar',icon:'wrench',actions:['view','create','edit','delete','approve','export']},
  {key:'employees',label:'Xodimlar',icon:'users',actions:['view','create','edit','delete','export']},
  {key:'costs',label:'Xarajat va tannarx',icon:'wallet',actions:['view','create','edit','delete','export']},
  {key:'reports',label:'Hisobotlar',icon:'chart',actions:['view','export']},
  {key:'ai',label:'ZENIX AI',icon:'spark',actions:['view']},
  {key:'settings',label:'Sozlamalar va tizim',icon:'settings',actions:['view','edit','export']},
  {key:'users',label:'Foydalanuvchilar',icon:'user',actions:['view','create','edit','delete'],admin:true},
  {key:'roles',label:'Rollar va ruxsatlar',icon:'lock',actions:['view','create','edit','delete'],admin:true},
  {key:'audit',label:'Faoliyat jurnali',icon:'clock',actions:['view','export'],admin:true},
]
export const MODULE_KEYS=PERMISSION_MODULES.map(m=>m.key)

/* ------------------------------------------------------------- roles -- */

const RANK:Record<SystemRoleKey,number>={super_admin:3,admin:2,production_manager:1,operator:1,quality:1,maintenance:1,warehouse:1,supply_sales:1}
export const isSuperAdminRole=(role:Pick<Role,'key'>|undefined)=>role?.key==='super_admin'
/** Super Admin 3 › Admin 2 › every other role 1. A user only manages roles and people ranked below them. */
export const roleRank=(role:Pick<Role,'key'>|undefined)=>role?.key?RANK[role.key]:1

export function roleOf(s:S,employeeId:string|undefined):Role|undefined{
  const roleId=s.employees.find(e=>e.id===employeeId)?.roleId
  return s.roles.find(r=>r.id===roleId)
}

/** Super Admin can do everything; the dashboard is open to every signed-in user; otherwise the role's matrix decides. */
export function hasPermission(role:Role|undefined,module:string,action:PermissionAction='view'){
  if(!role)return false
  if(isSuperAdminRole(role))return true
  if(module==='dashboard'&&action==='view')return true
  return role.permissions?.[module]?.[action]===true
}

export function allowedBy(role:Role|undefined,rules:Rules|undefined){
  if(!rules)return true
  return rules.some(([m,a])=>hasPermission(role,m,a))
}

/* ----------------------------------------------------- action rules -- */

const isDraftPo=(p:unknown)=>(p as {status?:string}|undefined)?.status==='Qoralama'
const PROD_RUN:Rules=[['production','execute'],['production','edit']]

/** Module permission needed per domain action; a function decides from the call's arguments. */
export const ACTION_RULES:Record<string,Rules|((args:unknown[])=>Rules)>={
  createProductionOrder:[['production','create']],updateProductionOrder:[['production','edit']],shortCloseProduction:[['production','edit']],
  transitionProduction:args=>{
    const status=args[1]
    // Running, pausing and handing over to QC is shop-floor work; planning decisions stay with planners.
    return ['Jarayonda','Pauzada','Sifat nazoratida'].includes(String(status))?PROD_RUN:[['production','edit']]
  },
  reportOutput:PROD_RUN,recordScrap:PROD_RUN,issueExtraMaterial:[['production','edit']],startWorkOrder:PROD_RUN,pauseWorkOrder:PROD_RUN,finishWorkOrder:PROD_RUN,recordMaterialScan:PROD_RUN,
  splitProduction:[['production','edit']],mergeProduction:[['production','edit']],createBackorder:[['production','edit']],unbuildProduct:[['production','edit']],checkAvailability:[['production','edit']],
  setForecast:[['production','edit']],rollUpCosts:[['products','edit']],
  // Job cards: operators run and report their operation; assigning people and moving dates is planning.
  reportOperationOutput:PROD_RUN,markSetupDone:PROD_RUN,assignWorkOrder:[['production','edit']],rescheduleProductionOrder:[['production','edit']],
  // An MRP suggestion becomes a draft PO (purchases.create) or a draft MO (production.create).
  confirmMrpSuggestion:args=>String(args[0]).startsWith('buy:')?[['purchases','create']]:[['production','create']],
  createReworkOrder:[['quality','edit'],['production','create']],createQualityCheck:[['quality','create'],...PROD_RUN],resolveQuality:[['quality','edit']],createQualityAlert:[['quality','create']],
  // A PO that skips the draft stage is an approval, so it needs the approve right (A-M6).
  createPurchaseOrder:args=>isDraftPo(args[0])?[['purchases','create']]:[['purchases','approve']],
  createPurchaseOrders:args=>Array.isArray(args[0])&&args[0].every(isDraftPo)?[['purchases','create']]:[['purchases','approve']],
  linkSupplierMaterial:[['purchases','edit'],['materials','edit']],updateSupplierMaterial:[['purchases','edit'],['materials','edit']],removeSupplierMaterial:[['purchases','edit'],['materials','edit']],setPreferredSupplier:[['materials','edit'],['purchases','edit']],
  confirmPurchase:[['purchases','approve']],markPurchaseInTransit:[['purchases','edit']],cancelPurchase:[['purchases','edit']],closePurchaseShort:[['purchases','edit']],updatePurchaseMeta:[['purchases','edit']],receivePurchase:[['purchases','edit'],['warehouse','edit']],returnPurchaseToSupplier:[['purchases','edit'],['warehouse','edit']],advanceSubcontract:[['purchases','edit']],
  // Draft lines are purchasing work; an inspection decision and the write-off of rejected goods are quality decisions.
  updatePurchaseDraft:[['purchases','edit']],inspectReceipt:[['quality','edit']],scrapRejectedReceipt:[['quality','edit']],
  createSalesOrder:[['sales','create']],reserveSalesOrder:[['sales','edit']],deliverSalesOrder:[['sales','edit'],['warehouse','edit']],cancelSalesOrder:[['sales','edit']],updateSalesMeta:[['sales','edit']],createReturn:[['sales','create'],['quality','edit']],dispositionReturn:[['quality','edit']],
  transferStock:[['warehouse','edit']],adjustStock:[['warehouse','edit']],countStock:[['warehouse','edit']],
  startDowntime:[['equipment','edit'],...PROD_RUN],endDowntime:[['equipment','edit'],...PROD_RUN],approveMaintenanceRequest:[['equipment','approve']],startMaintenance:[['equipment','edit']],completeMaintenance:[['equipment','edit']],cancelMaintenance:[['equipment','edit']],planPreventiveMaintenance:[['equipment','edit']],advanceRepair:[['equipment','edit']],
  // Operators hold equipment.create to raise requests; planning an order is maintenance planning work.
  createMaintenanceOrder:[['equipment','edit']],updateMaintenanceOrder:[['equipment','edit']],saveMaintenancePlan:[['equipment','edit']],recordEquipmentRuntime:[['equipment','edit']],
  createBomDraft:[['products','create']],saveBom:[['products','edit']],deleteBomDraft:[['products','delete']],activateBom:[['products','approve']],createEngineeringChange:[['products','create']],applyEngineeringChange:[['products','approve']],
  // Sending a change to review is engineering work; approving or rejecting it is the approver's decision.
  setEcoStatus:args=>args[1]==='Review'?[['products','edit'],['products','approve']]:[['products','approve']],
  cancelEngineeringChange:[['products','edit'],['products','approve']],archiveBom:[['products','approve']],saveRouting:[['products','edit']],copyRouting:[['products','edit']],saveVariant:[['products','edit']],
  createRole:[['roles','create']],duplicateRole:[['roles','create']],updateRole:[['roles','edit']],deleteRole:[['roles','delete']],updateRolePermission:[['roles','edit']],
}

export function actionRules(name:string,args:unknown[]=[]):Rules|undefined{
  const rule=ACTION_RULES[name]
  return typeof rule==='function'?rule(args):rule
}

export type EntityKeyName='products'|'rawMaterials'|'suppliers'|'customers'|'employees'|'expenses'|'qualityAlerts'|'maintenanceOrders'|'engineeringChanges'|'qualityControlPoints'|'maintenanceRequests'|'subcontractOrders'|'repairOrders'|'warehouses'|'workCenters'|'productionLines'|'equipment'|'branches'
export const ENTITY_MODULE:Record<EntityKeyName,string>={products:'products',rawMaterials:'materials',suppliers:'purchases',customers:'sales',employees:'employees',expenses:'costs',qualityAlerts:'quality',maintenanceOrders:'equipment',engineeringChanges:'products',qualityControlPoints:'quality',maintenanceRequests:'equipment',subcontractOrders:'purchases',repairOrders:'equipment',warehouses:'warehouse',workCenters:'equipment',productionLines:'settings',equipment:'equipment',branches:'settings'}

export function entityRules(key:EntityKeyName,action:PermissionAction):Rules{
  // Operators raise maintenance requests from the shop floor.
  if(key==='maintenanceRequests'&&action==='create')return [['equipment','create'],...PROD_RUN]
  return [[ENTITY_MODULE[key],action]]
}

/* ------------------------------------------- escalation and lock-out guards -- */

/** Non-archived employees holding the Super Admin role (the domain-level count; accounts add their own status on top). */
export const superAdminEmployees=(s:S,except?:string)=>s.employees.filter(e=>e.id!==except&&e.status!=='Arxiv'&&isSuperAdminRole(s.roles.find(r=>r.id===e.roleId)))

/**
 * Whether `actor` may switch one permission of a role (A-C1). A user never edits their own role, never touches
 * the Super Admin role, edits only roles ranked below them and grants or removes only permissions they hold.
 */
export function rolePermissionBlocker(s:S,actor:Employee|undefined,roleId:string,module:string,action:PermissionAction):string|null{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return 'Rol topilmadi'
  const mine=roleOf(s,actor?.id)
  if(isSuperAdminRole(role))return 'Super Admin roli barcha huquqlarga ega va tahrirlanmaydi'
  if(mine&&mine.id===role.id)return 'O‘z rolingiz ruxsatlarini o‘zgartira olmaysiz — buni yuqoriroq darajadagi administrator qiladi'
  if(!isSuperAdminRole(mine)&&roleRank(role)>=roleRank(mine))return `${role.name} roli sizning darajangizda yoki undan yuqori — faqat Super Admin tahrirlaydi`
  if(!hasPermission(mine,module,action))return `Sizda “${module}.${action}” huquqi yo‘q — uni boshqa rolga bera olmaysiz`
  return null
}

/** Whether `actor` may edit a role's name/description or delete it. */
export function roleManageBlocker(s:S,actor:Employee|undefined,roleId:string):string|null{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return 'Rol topilmadi'
  const mine=roleOf(s,actor?.id)
  if(isSuperAdminRole(role))return 'Super Admin roli o‘zgartirilmaydi'
  if(mine?.id===role.id)return 'O‘z rolingizni o‘zgartira olmaysiz'
  if(!isSuperAdminRole(mine)&&roleRank(role)>=roleRank(mine))return `${role.name} roli sizning darajangizda yoki undan yuqori`
  return null
}

/** Whether `actor` may give `target` (an existing employee, or a new one when undefined) the role `roleId` (A-C2). */
export function assignRoleBlocker(s:S,actor:Employee|undefined,target:Employee|undefined,roleId:string):string|null{
  const role=s.roles.find(r=>r.id===roleId)
  if(!role)return 'Rol topilmadi'
  const mine=roleOf(s,actor?.id),superActor=isSuperAdminRole(mine)
  if(target&&actor&&target.id===actor.id&&target.roleId!==roleId)return 'O‘z rolingizni o‘zgartira olmaysiz'
  if(!superActor&&roleRank(role)>=roleRank(mine))return `${role.name} rolini faqat Super Admin bera oladi`
  if(target){
    const current=s.roles.find(r=>r.id===target.roleId)
    if(!superActor&&roleRank(current)>=roleRank(mine)&&target.roleId!==roleId)return `${target.name} sizning darajangizda yoki undan yuqori — rolini faqat Super Admin o‘zgartiradi`
    if(isSuperAdminRole(current)&&!isSuperAdminRole(role)&&!superAdminEmployees(s,target.id).length)return 'Oxirgi faol Super Admin rolini o‘zgartirib bo‘lmaydi'
  }
  return null
}

/** Whether `actor` may archive (block) or delete the employee `targetId`. */
export function employeeRemovalBlocker(s:S,actor:Employee|undefined,targetId:string):string|null{
  const target=s.employees.find(e=>e.id===targetId)
  if(!target)return null
  if(actor&&target.id===actor.id)return 'O‘zingizni bloklay yoki o‘chira olmaysiz'
  const mine=roleOf(s,actor?.id),theirs=s.roles.find(r=>r.id===target.roleId)
  if(!isSuperAdminRole(mine)&&roleRank(theirs)>=roleRank(mine))return `${target.name} sizning darajangizda yoki undan yuqori — faqat Super Admin boshqaradi`
  if(isSuperAdminRole(theirs)&&!superAdminEmployees(s,target.id).length)return 'Oxirgi faol Super Admin’ni bloklash yoki o‘chirish mumkin emas'
  return null
}

/** Rules for a generic employee write: role and blocking changes are user administration, not HR data. */
export function employeeWriteBlocker(s:S,actor:Employee|undefined,row:Record<string,unknown>,before?:Employee):string|null{
  const roleId=String(row.roleId||'')
  if(!before)return roleId?assignRoleBlocker(s,actor,undefined,roleId):null
  if(roleId&&roleId!==before.roleId){const b=assignRoleBlocker(s,actor,before,roleId);if(b)return b}
  if(row.status==='Arxiv'&&before.status!=='Arxiv'){const b=employeeRemovalBlocker(s,actor,before.id);if(b)return b}
  // Editing another person's record at or above your own rank is user administration too.
  const mine=roleOf(s,actor?.id),theirs=s.roles.find(r=>r.id===before.roleId)
  if(actor&&before.id!==actor.id&&!isSuperAdminRole(mine)&&roleRank(theirs)>=roleRank(mine))return `${before.name} sizning darajangizda yoki undan yuqori — faqat Super Admin tahrirlaydi`
  return null
}

/* -------------------------------------------------------------- scope (A-H6) -- */

type ScopeTargets={workCenters:string[];warehouses:string[];branches:string[]}

/** Where the units of a return sit: its receiving warehouse, else the warehouses its sales order shipped from. */
function returnWarehouses(s:S,returnId:unknown){
  const r=s.returns.find(x=>x.id===returnId)
  if(!r)return []
  if(r.warehouseId)return [r.warehouseId]
  const so=s.salesOrders.find(x=>x.id===r.salesOrderId)
  return [...new Set(s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===so?.code&&m.itemId===r.productId).map(m=>m.warehouseId))]
}

/** The work centers, warehouses and branches a domain call touches, read from its arguments and the current data. */
export function scopeTargets(s:S,name:string,args:unknown[]):ScopeTargets{
  const t:ScopeTargets={workCenters:[],warehouses:[],branches:[]}
  const order=(id:unknown)=>s.productionOrders.find(o=>o.id===id)
  const addOrder=(o:ReturnType<typeof order>)=>{
    if(!o)return
    const centers=o.workOrders.length?o.workOrders.map(w=>w.workCenterId):[o.workCenterId]
    t.workCenters.push(...centers.filter(Boolean));if(o.warehouseId)t.warehouses.push(o.warehouseId)
  }
  const addPo=(id:unknown)=>{const po=s.purchaseOrders.find(x=>x.id===id);if(po?.warehouseId)t.warehouses.push(po.warehouseId)}
  const addSo=(id:unknown)=>{
    const so=s.salesOrders.find(x=>x.id===id)
    for(const i of so?.items||[]){if(i.warehouseId)t.warehouses.push(i.warehouseId);for(const r of i.reservations||[])t.warehouses.push(r.warehouseId)}
  }
  const addLine=(lineId:unknown)=>{const line=s.productionLines.find(l=>l.id===lineId);if(line)t.branches.push(line.branchId)}
  switch(name){
    case 'reportOutput':case 'recordScrap':case 'recordMaterialScan':case 'transitionProduction':case 'issueExtraMaterial':
    case 'shortCloseProduction':case 'splitProduction':case 'createBackorder':case 'checkAvailability':case 'createReworkOrder':case 'rescheduleProductionOrder':addOrder(order(args[0]));break
    case 'confirmMrpSuggestion':{
      // A buy suggestion becomes a PO into the default raw store; a make suggestion an MO on the default line.
      if(String(args[0]).startsWith('buy:'))t.warehouses.push(rawWarehouseFor(s,s.settings.defaultWarehouseId))
      else addLine(s.settings.defaultLineId)
      break
    }
    case 'updateProductionOrder':{addOrder(order(args[0]));const patch=args[1] as {lineId?:string}|undefined;if(patch?.lineId)addLine(patch.lineId);break}
    case 'mergeProduction':for(const id of Array.isArray(args[0])?args[0]:[])addOrder(order(id));break
    case 'createProductionOrder':{
      const p=args[0] as {warehouseId?:string;lineId?:string;workCenterId?:string}|undefined
      if(p?.warehouseId)t.warehouses.push(p.warehouseId)
      if(p?.workCenterId)t.workCenters.push(p.workCenterId)
      addLine(p?.lineId||s.settings.defaultLineId)
      break
    }
    case 'unbuildProduct':{const b=unbuildSource(s,String(args[0]));if(b)t.warehouses.push(b.warehouseId);break}
    case 'resolveQuality':{
      const q=s.qualityChecks.find(x=>x.id===args[0])
      if(q?.sourceType==='production')addOrder(order(q.sourceId))
      if(q?.sourceType==='purchase'){const po=s.purchaseOrders.find(x=>x.id===q.sourceId);const wh=po?.receipts.find(r=>r.id===q.receiptId)?.warehouseId||po?.warehouseId;if(wh)t.warehouses.push(wh)}
      if(q?.sourceType==='subcontract'){const sc=s.subcontractOrders.find(x=>x.id===q.sourceId);if(sc?.warehouseId)t.warehouses.push(sc.warehouseId)}
      if(q?.sourceType==='return')t.warehouses.push(...returnWarehouses(s,q.sourceId))
      break
    }
    case 'updatePurchaseDraft':{addPo(args[0]);const p=args[1] as {warehouseId?:string}|undefined;if(p?.warehouseId)t.warehouses.push(p.warehouseId);break}
    case 'returnPurchaseToSupplier':case 'inspectReceipt':case 'scrapRejectedReceipt':{
      const q=s.qualityChecks.find(x=>x.id===args[0]),po=s.purchaseOrders.find(x=>x.id===q?.sourceId)
      const wh=po?.receipts.find(r=>r.id===q?.receiptId)?.warehouseId||po?.warehouseId
      if(wh)t.warehouses.push(wh)
      break
    }
    case 'dispositionReturn':t.warehouses.push(...returnWarehouses(s,args[0]));break
    case 'createReturn':{
      const p=args[0] as {salesOrderId?:string;productId?:string}|undefined,so=s.salesOrders.find(x=>x.id===p?.salesOrderId)
      t.warehouses.push(...new Set(s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===so?.code&&m.itemId===p?.productId).map(m=>m.warehouseId)))
      break
    }
    case 'createPurchaseOrder':{const p=args[0] as {warehouseId?:string}|undefined;if(p?.warehouseId)t.warehouses.push(p.warehouseId);break}
    case 'createPurchaseOrders':for(const p of Array.isArray(args[0])?args[0] as {warehouseId?:string}[]:[])if(p?.warehouseId)t.warehouses.push(p.warehouseId);break
    case 'confirmPurchase':case 'markPurchaseInTransit':case 'cancelPurchase':case 'closePurchaseShort':case 'updatePurchaseMeta':addPo(args[0]);break
    case 'cancelSalesOrder':addSo(args[0]);break
    case 'advanceSubcontract':{const sc=s.subcontractOrders.find(x=>x.id===args[0]);if(sc?.warehouseId)t.warehouses.push(sc.warehouseId);break}
    case 'createEntity':case 'updateEntity':case 'deleteEntity':case 'duplicateEntity':{
      // Location-bound master data: a branch-scoped role manages only its own branch's sites (P1-2).
      const key=String(args[0]),id=args[1],patch=(name==='createEntity'?args[1]:args[2]) as Record<string,unknown>|undefined
      const row=name==='createEntity'?undefined:(s[key as keyof S] as unknown as Record<string,unknown>[]|undefined)?.find?.(x=>x.id===id)
      const field=(k:string)=>[row?.[k],patch?.[k]].filter((v):v is string=>typeof v==='string'&&Boolean(v))
      if(key==='warehouses'||key==='productionLines'){t.branches.push(...field('branchId'))}
      if(key==='workCenters'){t.branches.push(...field('branchId'));if(row)t.workCenters.push(String(row.id))}
      if(key==='warehouses'&&row)t.warehouses.push(String(row.id))
      if(key==='equipment')t.workCenters.push(...field('workCenterId'))
      if(['maintenanceOrders','maintenanceRequests','repairOrders'].includes(key))for(const eq of field('equipmentId')){const e=s.equipment.find(x=>x.id===eq);if(e)t.workCenters.push(e.workCenterId)}
      break
    }
    case 'startWorkOrder':case 'pauseWorkOrder':case 'finishWorkOrder':case 'reportOperationOutput':case 'markSetupDone':case 'assignWorkOrder':{
      const o=order(args[0]),wo=o?.workOrders.find(w=>w.id===args[1])
      if(wo){t.workCenters.push(wo.workCenterId);if(o?.warehouseId)t.warehouses.push(o.warehouseId)}else addOrder(o)
      break
    }
    case 'startDowntime':case 'saveMaintenancePlan':case 'recordEquipmentRuntime':{const e=s.equipment.find(x=>x.id===args[0]);if(e)t.workCenters.push(e.workCenterId);break}
    case 'createMaintenanceOrder':{const p=args[0] as {equipmentId?:string}|undefined,e=s.equipment.find(x=>x.id===p?.equipmentId);if(e)t.workCenters.push(e.workCenterId);break}
    case 'updateMaintenanceOrder':case 'startMaintenance':case 'completeMaintenance':case 'cancelMaintenance':{
      // Maintenance of a machine belongs to that machine's work center (and so its branch).
      const m=s.maintenanceOrders.find(x=>x.id===args[0]),e=s.equipment.find(x=>x.id===m?.equipmentId)
      if(e)t.workCenters.push(e.workCenterId)
      break
    }
    case 'approveMaintenanceRequest':{const r=s.maintenanceRequests.find(x=>x.id===args[0]),e=s.equipment.find(x=>x.id===r?.equipmentId);if(e)t.workCenters.push(e.workCenterId);break}
    case 'endDowntime':{const ev=s.downtimeEvents.find(x=>x.id===args[0]);if(ev)t.workCenters.push(ev.workCenterId);break}
    case 'createQualityCheck':{const p=args[0] as {sourceType?:string;sourceId?:string}|undefined;if(p?.sourceType==='production')addOrder(order(p.sourceId));break}
    case 'transferStock':t.warehouses.push(String(args[1]),String(args[2]));break
    case 'adjustStock':t.warehouses.push(String(args[1]));break
    case 'countStock':{const b=s.stockBalances.find(x=>x.id===args[0]);if(b)t.warehouses.push(b.warehouseId);break}
    case 'receivePurchase':{const po=s.purchaseOrders.find(x=>x.id===args[0]);const wh=(args[5] as {warehouseId?:string}|undefined)?.warehouseId||po?.warehouseId;if(wh)t.warehouses.push(wh);break}
    case 'deliverSalesOrder':addSo(args[0]);break
  }
  return t
}

/**
 * Whether the role's scope lets `actor` make this call (A-H6). "workcenter": shop-floor work only at the employee's
 * own work center, everything else inside its branch; "branch" and "warehouse": only work centers and warehouses of
 * the employee's branch (the branch comes from the employee's work center). "all" and Super Admin are unrestricted.
 */
export function scopeBlocker(s:S,actor:Employee|undefined,name:string,args:unknown[]):string|null{
  const role=roleOf(s,actor?.id)
  if(!actor||!role||isSuperAdminRole(role)||!role.scope||role.scope==='all')return null
  const t=scopeTargets(s,name,args)
  if(!t.workCenters.length&&!t.warehouses.length&&!t.branches.length)return null
  const home=homeOf(s,actor)
  if(!home.branchId)return `“${role.name}” roli joy bilan cheklangan, lekin sizga ish markazi yoki ombor biriktirilmagan — administratorga murojaat qiling`
  const centerName=(id:string)=>s.workCenters.find(w=>w.id===id)?.name||id
  if(role.scope==='workcenter'&&home.workCenter&&t.workCenters.length&&!t.workCenters.includes(home.workCenter.id))
    return `Bu ish ${[...new Set(t.workCenters)].map(centerName).join(', ')} ish markaziga tegishli — siz faqat ${home.workCenter.name}da ishlaysiz`
  // A "warehouse" role tied to one warehouse moves stock only there (P1-2).
  if(role.scope==='warehouse'&&home.warehouse){
    const other=[...new Set(t.warehouses)].filter(id=>id!==home.warehouse!.id)
    if(other.length)return `Bu amal ${other.map(id=>s.warehouses.find(w=>w.id===id)?.name||id).join(', ')} omboriga tegishli — siz faqat ${home.warehouse.name} omborida ishlaysiz`
  }
  const branchOf=(kind:'wc'|'wh',id:string)=>kind==='wc'?s.workCenters.find(w=>w.id===id)?.branchId:s.warehouses.find(w=>w.id===id)?.branchId
  const foreign=[...t.workCenters.map(id=>branchOf('wc',id)),...t.warehouses.map(id=>branchOf('wh',id)),...t.branches].filter((b):b is string=>Boolean(b)&&b!==home.branchId)
  if(foreign.length){
    const mine=s.branches.find(b=>b.id===home.branchId)?.name||home.branchId
    return `Bu amal boshqa filialga tegishli — “${role.name}” roli faqat ${mine} filialida ishlaydi`
  }
  return null
}

/**
 * Whether `employee` may be put to work at a work center (job-card assignment / operator of a start): an active
 * person whose role may run production, inside their role's scope — own work center for "workcenter", own branch
 * for "branch" / "warehouse"; "all" and Super Admin anywhere.
 */
export function operatorScopeBlocker(s:S,employee:Employee|undefined,workCenterId:string):string|null{
  if(!employee)return 'Operator topilmadi'
  if(employee.status==='Arxiv')return `${employee.name} arxivlangan — ishga biriktirib bo‘lmaydi`
  const role=roleOf(s,employee.id)
  if(!allowedBy(role,PROD_RUN))return `${employee.name}: “${role?.name||'—'}” roli ishlab chiqarish operatsiyasini bajara olmaydi`
  if(!role||isSuperAdminRole(role)||!role.scope||role.scope==='all')return null
  const center=s.workCenters.find(w=>w.id===workCenterId)
  if(!center)return 'Work center topilmadi'
  const home=homeOf(s,employee)
  if(role.scope==='workcenter'&&home.workCenter?.id!==center.id)return `${employee.name} faqat ${home.workCenter?.name||'o‘z ish markazida'} ishlaydi — ${center.name} uning doirasida emas`
  if(home.branchId!==center.branchId)return `${employee.name} boshqa filialga biriktirilgan — ${center.name} uning doirasida emas`
  return null
}

/** The employee's home: work center, warehouse (for a warehouse-scoped role) and the branch they belong to. */
export function homeOf(s:S,actor:Employee){
  const workCenter=s.workCenters.find(w=>w.id===actor.workCenterId)
  const warehouse=actor.warehouseId?s.warehouses.find(w=>w.id===actor.warehouseId):undefined
  return {workCenter,warehouse,branchId:warehouse?.branchId||workCenter?.branchId}
}

/**
 * What a scoped role reads (P1-2): location-bound records outside the employee's scope are left out, so lists,
 * dashboards and exports show the same world the role may act on. "workcenter": its own work center's orders and
 * events, its branch's stock; "warehouse": its warehouse's stock (its branch without one), its branch's orders;
 * "branch": everything of its branch. Master data (warehouses, work centers, items) stays complete so names resolve.
 * "all", Super Admin and an unknown employee keep the full data (the session is checked elsewhere).
 */
export function scopedView(s:S,actor:Employee|undefined):S{
  const role=roleOf(s,actor?.id)
  if(!actor||!role||isSuperAdminRole(role)||!role.scope||role.scope==='all')return s
  const home=homeOf(s,actor)
  const branchWarehouses=new Set(s.warehouses.filter(w=>w.branchId===home.branchId).map(w=>w.id))
  const branchCenters=new Set(s.workCenters.filter(w=>w.branchId===home.branchId).map(w=>w.id))
  const stockWarehouses=role.scope==='warehouse'&&home.warehouse?new Set([home.warehouse.id]):branchWarehouses
  const centers=role.scope==='workcenter'&&home.workCenter?new Set([home.workCenter.id]):branchCenters
  const orderVisible=(o:S['productionOrders'][number])=>role.scope==='workcenter'
    ?(o.workOrders.length?o.workOrders.some(w=>centers.has(w.workCenterId)):centers.has(o.workCenterId))
    :branchWarehouses.has(o.warehouseId)||o.workOrders.some(w=>branchCenters.has(w.workCenterId))
  const productionOrders=s.productionOrders.filter(orderVisible)
  const orderIds=new Set(productionOrders.map(o=>o.id))
  const purchaseOrders=s.purchaseOrders.filter(p=>stockWarehouses.has(p.warehouseId)||p.receipts.some(r=>r.warehouseId&&stockWarehouses.has(r.warehouseId)))
  const purchaseIds=new Set(purchaseOrders.map(p=>p.id))
  const centerOf=(equipmentId:string)=>s.equipment.find(e=>e.id===equipmentId)?.workCenterId||''
  return {...s,
    productionOrders,
    stockBalances:s.stockBalances.filter(b=>stockWarehouses.has(b.warehouseId)),
    stockMovements:s.stockMovements.filter(m=>stockWarehouses.has(m.warehouseId)),
    lots:s.lots.filter(l=>stockWarehouses.has(l.warehouseId)),
    purchaseOrders,
    timeLogs:s.timeLogs.filter(l=>orderIds.has(l.orderId)),
    downtimeEvents:s.downtimeEvents.filter(d=>centers.has(d.workCenterId)),
    equipment:s.equipment.filter(e=>branchCenters.has(e.workCenterId)),
    maintenanceOrders:s.maintenanceOrders.filter(m=>branchCenters.has(centerOf(m.equipmentId))),
    maintenanceRequests:s.maintenanceRequests.filter(m=>branchCenters.has(centerOf(m.equipmentId))),
    repairOrders:s.repairOrders.filter(m=>branchCenters.has(centerOf(m.equipmentId))),
    qualityChecks:s.qualityChecks.filter(q=>q.sourceType==='production'?orderIds.has(q.sourceId):q.sourceType==='purchase'?purchaseIds.has(q.sourceId):true),
    subcontractOrders:s.subcontractOrders.filter(o=>!o.warehouseId||branchWarehouses.has(o.warehouseId)),
    returns:s.returns.filter(r=>!r.warehouseId||branchWarehouses.has(r.warehouseId)),
  }
}

/* ----------------------------------------------------- default roles -- */

type Grant=Partial<Record<PermissionAction,boolean>>
const ALL:PermissionAction[]=['view','create','edit','delete','approve','export','execute']
const grant=(actions:PermissionAction[]):Grant=>Object.fromEntries(actions.map(a=>[a,true]))
const full=(module:string):Grant=>grant(PERMISSION_MODULES.find(m=>m.key===module)?.actions||ALL)
const view=():Grant=>grant(['view'])
const viewExport=():Grant=>grant(['view','export'])

/** The eight system roles. Ids of the five that existed before are kept, so employees stay attached to them. */
export const SYSTEM_ROLES:Array<{id:string;key:SystemRoleKey;name:string;scope:Role['scope'];description:string;permissions:PermissionMap}>=[
  {id:'role0',key:'super_admin',name:'Super Admin',scope:'all',description:'Tizim egasi: barcha huquqlar, administratorlarni boshqaradi. Tahrirlanmaydi.',permissions:Object.fromEntries(MODULE_KEYS.map(m=>[m,full(m)]))},
  {id:'role1',key:'admin',name:'Admin / Direktor',scope:'all',description:'Korxona rahbari: barcha modullar, foydalanuvchi va rollarni (o‘zidan past darajada) boshqaradi.',permissions:Object.fromEntries(MODULE_KEYS.map(m=>[m,full(m)]))},
  {id:'role2',key:'production_manager',name:'Ishlab chiqarish menejeri',scope:'branch',description:'Rejalashtirish, MO, BOM, material va sex nazorati.',permissions:{
    production:full('production'),products:full('products'),materials:full('materials'),warehouse:grant(['view','edit','export']),quality:grant(['view','create','export']),
    equipment:grant(['view','create','edit','export']),purchases:grant(['view','create','export']),sales:viewExport(),employees:view(),costs:viewExport(),reports:viewExport(),ai:view()}},
  {id:'role5',key:'operator',name:'Operator',scope:'workcenter',description:'Sex ishchisi: operatsiyani boshlash/tugatish, natija, scrap, scan, to‘xtash.',permissions:{
    production:grant(['view','execute']),products:view(),quality:grant(['view','create']),equipment:grant(['view','create'])}},
  {id:'role3',key:'quality',name:'Sifat nazoratchisi',scope:'branch',description:'Kirish, jarayon va final tekshiruvlar, NCR/CAPA, qaytarishlar qarori.',permissions:{
    quality:full('quality'),production:view(),products:view(),purchases:view(),sales:view(),warehouse:view(),reports:viewExport(),ai:view()}},
  {id:'role4',key:'maintenance',name:'Texnik xizmat muhandisi',scope:'branch',description:'Uskunalar, downtime, maintenance va ta’mir.',permissions:{
    equipment:full('equipment'),production:view(),materials:view(),warehouse:view(),reports:viewExport(),ai:view()}},
  {id:'role6',key:'warehouse',name:'Omborchi',scope:'warehouse',description:'Qabul, transfer, inventarizatsiya, yetkazib berish.',permissions:{
    warehouse:full('warehouse'),materials:grant(['view','export']),purchases:grant(['view','edit']),sales:grant(['view','edit']),production:view(),quality:view(),products:view(),reports:viewExport()}},
  {id:'role7',key:'supply_sales',name:'Ta’minot va sotuv menejeri',scope:'all',description:'Supplierlar, xarid, sotuv buyurtmalari va mijozlar.',permissions:{
    purchases:full('purchases'),sales:full('sales'),materials:grant(['view','edit','export']),warehouse:view(),products:view(),production:view(),costs:view(),reports:viewExport(),ai:view()}},
]
