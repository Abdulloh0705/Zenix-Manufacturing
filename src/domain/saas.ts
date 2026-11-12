// Frontend demo metadata. Browser storage is not a security boundary or a shared SaaS database.
import type {Account,AuthStore} from './auth'
import type {ManufacturingState} from '../types'
import {isOwnerRole,roleOf} from './access'

export type PlanId='free'|'plus'|'pro'|'enterprise'
export type Plan={id:PlanId;name:string;maxEmployees:number;maxBranches:number;maxWarehouses:number;modules:readonly string[];aiCredits:number;api:boolean}
export const PLAN_CATALOG:Record<PlanId,Plan>={
  free:{id:'free',name:'Free',maxEmployees:5,maxBranches:1,maxWarehouses:1,modules:['production','products','materials','warehouse','employees','settings'],aiCredits:0,api:false},
  plus:{id:'plus',name:'Plus',maxEmployees:25,maxBranches:3,maxWarehouses:5,modules:['production','products','materials','warehouse','purchases','sales','quality','equipment','employees','costs','reports','settings'],aiCredits:100,api:false},
  pro:{id:'pro',name:'Pro',maxEmployees:100,maxBranches:10,maxWarehouses:25,modules:['production','products','materials','warehouse','purchases','sales','quality','equipment','employees','costs','reports','settings','ai'],aiCredits:1000,api:true},
  enterprise:{id:'enterprise',name:'Enterprise',maxEmployees:Number.MAX_SAFE_INTEGER,maxBranches:Number.MAX_SAFE_INTEGER,maxWarehouses:Number.MAX_SAFE_INTEGER,modules:['production','products','materials','warehouse','purchases','sales','quality','equipment','employees','costs','reports','settings','ai'],aiCredits:Number.MAX_SAFE_INTEGER,api:true},
}
export type Tenant={id:string;name:string;status:'active'|'suspended';ownerAccountId:string;createdAt:string;suspensionReason?:string}
export type Membership={id:string;tenantId:string;accountId:string;employeeId:string;status:'active'|'disabled'|'invited';createdAt:string}
export type Subscription={id:string;tenantId:string;planId:PlanId;status:'trial'|'active'|'grace'|'expired'|'suspended';startsAt:string;endsAt?:string;changedBy?:string}
export type SaaSEvent={id:string;tenantId:string;actorAccountId?:string;action:string;targetId:string;at:string;result:'success'|'denied';reason?:string}
/** Platform feature restriction history (append-only). The latest entry per tenant+module wins. It can only switch a plan module OFF or back to the plan default; it never grants a module or an RBAC permission. */
export type FeatureOverride={id:string;tenantId:string;module:string;state:'disabled'|'restored';actor:string;at:string;reason:string}
export type SaaSStore={version:1;tenants:Tenant[];memberships:Membership[];subscriptions:Subscription[];events:SaaSEvent[];featureOverrides?:FeatureOverride[]}
export const SAAS_EVENT_LIMIT=2000
export const LEGACY_TENANT_ID='tenant-legacy-v3'
export const LEGACY_STATE_KEY='zenix-manufacturing-v3-state'
export function tenantStateKey(tenantId:string):string|null{
  if(tenantId===LEGACY_TENANT_ID)return LEGACY_STATE_KEY
  return /^tenant-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)?`zenix-erp-${tenantId}-state`:null
}

export const emptySaaSStore=():SaaSStore=>({version:1,tenants:[],memberships:[],subscriptions:[],events:[]})
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function normalizeSaaSStore(raw:unknown):SaaSStore|null{
  if(!record(raw)||raw.version!==1||!Array.isArray(raw.tenants)||!Array.isArray(raw.memberships)||!Array.isArray(raw.subscriptions)||!Array.isArray(raw.events))return null
  if(raw.tenants.some((t:unknown)=>!record(t)||typeof t.id!=='string'||!t.id||typeof t.name!=='string'||!t.name||typeof t.ownerAccountId!=='string'||!t.ownerAccountId||!['active','suspended'].includes(String(t.status))))return null
  if(raw.memberships.some((m:unknown)=>!record(m)||typeof m.id!=='string'||!m.id||typeof m.tenantId!=='string'||typeof m.accountId!=='string'||!m.accountId||typeof m.employeeId!=='string'||!m.employeeId||!['active','disabled','invited'].includes(String(m.status))))return null
  if(raw.subscriptions.some((s:unknown)=>!record(s)||typeof s.id!=='string'||!s.id||typeof s.tenantId!=='string'||typeof s.planId!=='string'||!(s.planId in PLAN_CATALOG)||!['trial','active','grace','expired','suspended'].includes(String(s.status))||typeof s.startsAt!=='string'||Number.isNaN(Date.parse(s.startsAt))||s.endsAt!==undefined&&(typeof s.endsAt!=='string'||Number.isNaN(Date.parse(s.endsAt)))))return null
  if(raw.events.some((e:unknown)=>!record(e)||typeof e.id!=='string'||typeof e.tenantId!=='string'||typeof e.action!=='string'||typeof e.targetId!=='string'||typeof e.at!=='string'||Number.isNaN(Date.parse(e.at))||!['success','denied'].includes(String(e.result))))return null
  const ids=new Set((raw.tenants as Tenant[]).map(t=>t.id))
  if(ids.size!==raw.tenants.length||[...ids].some(id=>!tenantStateKey(id)))return null
  if(raw.memberships.some((m:Membership)=>!ids.has(m.tenantId))||raw.subscriptions.some((s:Subscription)=>!ids.has(s.tenantId)))return null
  if(new Set((raw.memberships as Membership[]).map(m=>`${m.tenantId}:${m.accountId}`)).size!==raw.memberships.length)return null
  if(raw.events.some((e:SaaSEvent)=>!ids.has(e.tenantId)))return null
  if(raw.featureOverrides!==undefined&&(!Array.isArray(raw.featureOverrides)||raw.featureOverrides.some((f:unknown)=>!record(f)||typeof f.id!=='string'||!f.id||typeof f.tenantId!=='string'||!ids.has(f.tenantId)||typeof f.module!=='string'||!RESTRICTABLE_MODULES.includes(f.module)||!['disabled','restored'].includes(String(f.state))||typeof f.actor!=='string'||typeof f.reason!=='string'||typeof f.at!=='string'||Number.isNaN(Date.parse(f.at)))))return null
  return raw as SaaSStore
}

/** Only the original business state can be associated with this tenant. No tenant switching is inferred. */
export function legacyTenant(s:ManufacturingState,auth:AuthStore,now:Date):SaaSStore{
  const legacyAccounts=auth.accounts.filter(a=>!a.tenantId||a.tenantId===LEGACY_TENANT_ID)
  const owners=legacyAccounts.filter(a=>isOwnerRole(roleOf(s,a.employeeId)))
  const owner=owners[0]
  if(!owner)return emptySaaSStore()
  const tenantId=LEGACY_TENANT_ID
  return {version:1,tenants:[{id:tenantId,name:s.settings.company.name,status:'active',ownerAccountId:owner.id,createdAt:owner.createdAt||now.toISOString()}],
    memberships:legacyAccounts.map(a=>({id:`membership-${a.id}`,tenantId,accountId:a.id,employeeId:a.employeeId,status:a.status==='active'?'active':'disabled',createdAt:a.createdAt})),
    subscriptions:[{id:'subscription-legacy-v3',tenantId,planId:'enterprise',status:'active',startsAt:owner.createdAt||now.toISOString()}],events:[]}
}
export const DEFAULT_TRIAL_DAYS=14
export function newTenant(s:ManufacturingState,account:Account,now:Date,trialDays=DEFAULT_TRIAL_DAYS):SaaSStore{
  const tenantId=`tenant-${crypto.randomUUID()}`,at=now.toISOString()
  const days=Number.isInteger(trialDays)&&trialDays>=1&&trialDays<=60?trialDays:DEFAULT_TRIAL_DAYS
  const end=new Date(now.getTime()+days*86400000).toISOString()
  return {version:1,tenants:[{id:tenantId,name:s.settings.company.name,status:'active',ownerAccountId:account.id,createdAt:at}],
    memberships:[{id:`membership-${crypto.randomUUID()}`,tenantId,accountId:account.id,employeeId:account.employeeId,status:'active',createdAt:at}],
    subscriptions:[{id:`subscription-${crypto.randomUUID()}`,tenantId,planId:'enterprise',status:'trial',startsAt:at,endsAt:end}],events:[{id:`saas-event-${crypto.randomUUID()}`,tenantId,actorAccountId:account.id,action:'tenant.register',targetId:tenantId,at,result:'success'}]}
}
export function membershipFor(store:SaaSStore,account:Account|undefined,tenantId:string){
  return account&&store.memberships.find(m=>m.accountId===account.id&&m.tenantId===tenantId&&m.status==='active')
}
export function subscriptionFor(store:SaaSStore,tenantId:string){return [...store.subscriptions].reverse().find(s=>s.tenantId===tenantId)}
export function subscriptionActive(sub:Subscription|undefined,now:Date){return !!sub&&['trial','active','grace'].includes(sub.status)&&(sub.status!=='trial'||!!sub.endsAt)&&(!sub.endsAt||Date.parse(sub.endsAt)>now.getTime())}
/** Administrative modules every tenant keeps, so an owner can always see the subscription, users and audit. */
export const CORE_MODULES:readonly string[]=['dashboard','users','roles','audit','settings','subscription']
/** Plan modules a platform operator may switch off for one tenant. `settings` stays core. */
export const RESTRICTABLE_MODULES:readonly string[]=[...new Set(Object.values(PLAN_CATALOG).flatMap(p=>p.modules))].filter(m=>!CORE_MODULES.includes(m))
export function disabledModules(store:SaaSStore,tenantId:string):Set<string>{
  const latest=new Map<string,FeatureOverride>()
  for(const f of store.featureOverrides||[])if(f.tenantId===tenantId){const prev=latest.get(f.module);if(!prev||f.at>=prev.at)latest.set(f.module,f)}
  return new Set([...latest.values()].filter(f=>f.state==='disabled').map(f=>f.module))
}
/** Subscription entitlement only: RBAC (`hasPermission`) is checked separately and both must pass. */
export function entitlement(store:SaaSStore,tenantId:string,module:string,now:Date){
  if(CORE_MODULES.includes(module))return true
  const sub=subscriptionFor(store,tenantId)
  return subscriptionActive(sub,now)&&!!PLAN_CATALOG[sub!.planId]?.modules.includes(module)&&!disabledModules(store,tenantId).has(module)
}
export function usage(s:ManufacturingState){return {employees:s.employees.filter(e=>e.status!=='Arxiv').length,branches:s.branches.filter(b=>b.status!=='Arxiv').length,warehouses:s.warehouses.filter(w=>w.status!=='Arxiv').length}}
export function limitBlocker(s:ManufacturingState,store:SaaSStore,tenantId:string,kind:'employees'|'branches'|'warehouses'){
  const sub=subscriptionFor(store,tenantId)
  if(!subscriptionActive(sub,new Date()))return 'Obuna faol emas'
  const plan=PLAN_CATALOG[sub!.planId],used=usage(s)[kind]
  return used>=({employees:plan.maxEmployees,branches:plan.maxBranches,warehouses:plan.maxWarehouses}[kind])?`${plan.name} rejasida ${kind} chegarasiga yetildi`:null
}
export function changePlan(store:SaaSStore,tenantId:string,planId:PlanId,actorAccountId:string,now:Date):SaaSStore{
  if(!store.tenants.some(t=>t.id===tenantId&&t.status==='active')||!PLAN_CATALOG[planId])return store
  const at=now.toISOString()
  const previous=subscriptionFor(store,tenantId)
  if(!previous||!subscriptionActive(previous,now))return store
  const order:PlanId[]=['free','plus','pro','enterprise']
  if(previous.status==='active'&&order.indexOf(planId)>order.indexOf(previous.planId))return store
  // A self-service plan selection never asserts that a real payment was verified.
  const status=previous.status
  return {...store,subscriptions:[...store.subscriptions,{id:`subscription-${crypto.randomUUID()}`,tenantId,planId,status,startsAt:at,endsAt:previous.endsAt,changedBy:actorAccountId}],events:[{id:`saas-event-${crypto.randomUUID()}`,tenantId,actorAccountId,action:'subscription.change',targetId:planId,at,result:'success' as const,reason:'Demo tanlov; to‘lov tasdiqlanmagan'},...store.events].slice(0,SAAS_EVENT_LIMIT)}
}

export function setTenantStatus(store:SaaSStore,tenantId:string,status:Tenant['status'],actor:string,reason:string,now:Date):SaaSStore|null{
  const tenant=store.tenants.find(t=>t.id===tenantId)
  if(!tenant||!actor.trim()||reason.trim().length<5||tenant.status===status)return null
  const at=now.toISOString()
  return {...store,tenants:store.tenants.map(t=>t.id===tenantId?{...t,status,suspensionReason:status==='suspended'?reason.trim():undefined}:t),events:[{id:`saas-event-${crypto.randomUUID()}`,tenantId,action:status==='suspended'?'tenant.suspend':'tenant.reactivate',targetId:tenantId,actorAccountId:actor,at,result:'success' as const,reason:reason.trim()},...store.events].slice(0,SAAS_EVENT_LIMIT)}
}

/** Grace always carries an end date (`endsAt`), otherwise it would never lapse. */
export function platformOverridePlan(store:SaaSStore,tenantId:string,planId:PlanId,status:Subscription['status'],actor:string,reason:string,now:Date,endsAt?:string):SaaSStore|null{
  if(!store.tenants.some(t=>t.id===tenantId)||!PLAN_CATALOG[planId]||!['active','grace','expired','suspended'].includes(status)||!actor.trim()||reason.trim().length<5)return null
  if(status==='grace'&&(!endsAt||Number.isNaN(Date.parse(endsAt))||Date.parse(endsAt)<=now.getTime()))return null
  const at=now.toISOString()
  return {...store,subscriptions:[...store.subscriptions,{id:`subscription-${crypto.randomUUID()}`,tenantId,planId,status,startsAt:at,...(status==='grace'?{endsAt}:{}),changedBy:actor}],events:[{id:`saas-event-${crypto.randomUUID()}`,tenantId,actorAccountId:actor,action:'subscription.override.demo',targetId:planId,at,result:'success' as const,reason:reason.trim()},...store.events].slice(0,SAAS_EVENT_LIMIT)}
}
