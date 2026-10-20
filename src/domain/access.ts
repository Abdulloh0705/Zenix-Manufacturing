// Authorization rules, kept pure (no React) so every rule is unit-tested and can move to a backend 1:1.
// The app enforces them in AppContext before any domain action runs; this frontend-only enforcement is a
// usability and integrity guard, not a security boundary (anyone with DevTools can change browser storage).
import type {Employee,ManufacturingState,PermissionAction,PermissionMap,Role,SystemRoleKey} from '../types'

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
  createReworkOrder:[['quality','edit'],['production','create']],createQualityCheck:[['quality','create'],...PROD_RUN],resolveQuality:[['quality','edit']],createQualityAlert:[['quality','create']],
  // A PO that skips the draft stage is an approval, so it needs the approve right (A-M6).
  createPurchaseOrder:args=>isDraftPo(args[0])?[['purchases','create']]:[['purchases','approve']],
  createPurchaseOrders:args=>Array.isArray(args[0])&&args[0].every(isDraftPo)?[['purchases','create']]:[['purchases','approve']],
  linkSupplierMaterial:[['purchases','edit'],['materials','edit']],updateSupplierMaterial:[['purchases','edit'],['materials','edit']],removeSupplierMaterial:[['purchases','edit'],['materials','edit']],setPreferredSupplier:[['materials','edit'],['purchases','edit']],
  confirmPurchase:[['purchases','approve']],markPurchaseInTransit:[['purchases','edit']],cancelPurchase:[['purchases','edit']],closePurchaseShort:[['purchases','edit']],updatePurchaseMeta:[['purchases','edit']],receivePurchase:[['purchases','edit'],['warehouse','edit']],returnPurchaseToSupplier:[['purchases','edit'],['warehouse','edit']],advanceSubcontract:[['purchases','edit']],
  createSalesOrder:[['sales','create']],reserveSalesOrder:[['sales','edit']],deliverSalesOrder:[['sales','edit'],['warehouse','edit']],cancelSalesOrder:[['sales','edit']],updateSalesMeta:[['sales','edit']],createReturn:[['sales','create'],['quality','edit']],dispositionReturn:[['quality','edit']],
  transferStock:[['warehouse','edit']],adjustStock:[['warehouse','edit']],countStock:[['warehouse','edit']],
  startDowntime:[['equipment','edit'],...PROD_RUN],endDowntime:[['equipment','edit'],...PROD_RUN],approveMaintenanceRequest:[['equipment','approve']],startMaintenance:[['equipment','edit']],completeMaintenance:[['equipment','edit']],cancelMaintenance:[['equipment','edit']],planPreventiveMaintenance:[['equipment','edit']],advanceRepair:[['equipment','edit']],
  createBomDraft:[['products','create']],saveBom:[['products','edit']],deleteBomDraft:[['products','delete']],activateBom:[['products','approve']],createEngineeringChange:[['products','create']],setEcoStatus:[['products','approve']],applyEngineeringChange:[['products','approve']],
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

type ScopeTargets={workCenters:string[];warehouses:string[]}

/** The work centers and warehouses a domain call touches, read from its arguments and the current data. */
export function scopeTargets(s:S,name:string,args:unknown[]):ScopeTargets{
  const t:ScopeTargets={workCenters:[],warehouses:[]}
  const order=(id:unknown)=>s.productionOrders.find(o=>o.id===id)
  const addOrder=(o:ReturnType<typeof order>)=>{
    if(!o)return
    const centers=o.workOrders.length?o.workOrders.map(w=>w.workCenterId):[o.workCenterId]
    t.workCenters.push(...centers.filter(Boolean));if(o.warehouseId)t.warehouses.push(o.warehouseId)
  }
  switch(name){
    case 'reportOutput':case 'recordScrap':case 'recordMaterialScan':case 'transitionProduction':case 'issueExtraMaterial':addOrder(order(args[0]));break
    case 'startWorkOrder':case 'pauseWorkOrder':case 'finishWorkOrder':{
      const o=order(args[0]),wo=o?.workOrders.find(w=>w.id===args[1])
      if(wo){t.workCenters.push(wo.workCenterId);if(o?.warehouseId)t.warehouses.push(o.warehouseId)}else addOrder(o)
      break
    }
    case 'startDowntime':{const e=s.equipment.find(x=>x.id===args[0]);if(e)t.workCenters.push(e.workCenterId);break}
    case 'endDowntime':{const ev=s.downtimeEvents.find(x=>x.id===args[0]);if(ev)t.workCenters.push(ev.workCenterId);break}
    case 'createQualityCheck':{const p=args[0] as {sourceType?:string;sourceId?:string}|undefined;if(p?.sourceType==='production')addOrder(order(p.sourceId));break}
    case 'transferStock':t.warehouses.push(String(args[1]),String(args[2]));break
    case 'adjustStock':t.warehouses.push(String(args[1]));break
    case 'countStock':{const b=s.stockBalances.find(x=>x.id===args[0]);if(b)t.warehouses.push(b.warehouseId);break}
    case 'receivePurchase':{const po=s.purchaseOrders.find(x=>x.id===args[0]);const wh=(args[5] as {warehouseId?:string}|undefined)?.warehouseId||po?.warehouseId;if(wh)t.warehouses.push(wh);break}
    case 'deliverSalesOrder':{
      const so=s.salesOrders.find(x=>x.id===args[0])
      for(const i of so?.items||[]){if(i.warehouseId)t.warehouses.push(i.warehouseId);for(const r of i.reservations||[])t.warehouses.push(r.warehouseId)}
      break
    }
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
  if(!t.workCenters.length&&!t.warehouses.length)return null
  const home=s.workCenters.find(w=>w.id===actor.workCenterId)
  if(!home)return `“${role.name}” roli joy bilan cheklangan, lekin sizga ish markazi biriktirilmagan — administratorga murojaat qiling`
  const centerName=(id:string)=>s.workCenters.find(w=>w.id===id)?.name||id
  if(role.scope==='workcenter'&&t.workCenters.length&&!t.workCenters.includes(home.id))
    return `Bu ish ${[...new Set(t.workCenters)].map(centerName).join(', ')} ish markaziga tegishli — siz faqat ${home.name}da ishlaysiz`
  const branchOf=(kind:'wc'|'wh',id:string)=>kind==='wc'?s.workCenters.find(w=>w.id===id)?.branchId:s.warehouses.find(w=>w.id===id)?.branchId
  const foreign=[...t.workCenters.map(id=>branchOf('wc',id)),...t.warehouses.map(id=>branchOf('wh',id))].filter((b):b is string=>Boolean(b)&&b!==home.branchId)
  if(foreign.length){
    const mine=s.branches.find(b=>b.id===home.branchId)?.name||home.branchId
    return `Bu amal boshqa filialga tegishli — “${role.name}” roli faqat ${mine} filialida ishlaydi`
  }
  return null
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
