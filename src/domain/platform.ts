// ZENIX platform (SaaS operator) domain — frontend demo only.
// Everything here lives in browser storage, which the browser owner can edit. It is NOT a trusted audit log,
// settings store or authorization boundary; docs/BACKEND_CONTRACT.md lists the server contracts that replace it.
// Platform logic manages companies, subscriptions and policies. It never reads or writes tenant ERP state.
import * as SaaS from './saas'
import type {PlanId,SaaSStore,Subscription,Tenant} from './saas'

export const PLATFORM_KEY='zenix-platform-v1'
export const PLATFORM_AUDIT_LIMIT=2000
export const PLATFORM_TICKET_LIMIT=500
const DAY=86400000

export type PlatformSettings={brandName:string;supportEmail:string;supportPhone:string;defaultTrialDays:number;graceDays:number;registration:'open'|'closed'}
export const DEFAULT_PLATFORM_SETTINGS:PlatformSettings={brandName:'ZENIX',supportEmail:'',supportPhone:'',defaultTrialDays:SaaS.DEFAULT_TRIAL_DAYS,graceDays:7,registration:'open'}
/** Changing these alters what future companies receive, so a reason and confirmation are required. */
export const SENSITIVE_SETTINGS:readonly (keyof PlatformSettings)[]=['defaultTrialDays','graceDays','registration']

export type AuditOutcome='success'|'denied'|'failed'
export type AuditTargetType='tenant'|'subscription'|'feature'|'settings'|'ticket'|'session'
export type PlatformAuditEntry={id:string;at:string;actor:string;action:string;targetType:AuditTargetType;targetId:string;tenantId?:string;reason?:string;outcome:AuditOutcome;detail?:string;saasEventId?:string}

export const TICKET_STATUSES=['open','in_progress','waiting','resolved','closed'] as const
export const TICKET_PRIORITIES=['low','normal','high','urgent'] as const
export const TICKET_CATEGORIES=['account','subscription','billing','technical','data','other'] as const
export type TicketStatus=typeof TICKET_STATUSES[number]
export type TicketPriority=typeof TICKET_PRIORITIES[number]
export type TicketCategory=typeof TICKET_CATEGORIES[number]
export type TicketNote={id:string;at:string;actor:string;kind:'note'|'status'|'assign'|'create';text:string}
export type SupportTicket={id:string;number:number;tenantId:string|null;subject:string;category:TicketCategory;priority:TicketPriority;status:TicketStatus;assignee:string;createdAt:string;createdBy:string;updatedAt:string;notes:TicketNote[]}

export type PlatformStore={version:1;settings:PlatformSettings;audit:PlatformAuditEntry[];tickets:SupportTicket[]}
export const emptyPlatformStore=():PlatformStore=>({version:1,settings:{...DEFAULT_PLATFORM_SETTINGS},audit:[],tickets:[]})

export const validActor=(actor:string)=>/^[a-zA-Z0-9._-]{3,48}$/.test(actor)
const rec=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const str=(v:unknown)=>typeof v==='string'
const date=(v:unknown)=>typeof v==='string'&&!Number.isNaN(Date.parse(v))
const uid=(p:string)=>`${p}-${crypto.randomUUID()}`

// ---------------------------------------------------------------- settings
export type SettingsErrors=Partial<Record<keyof PlatformSettings,string>>
export function validateSettings(s:PlatformSettings):SettingsErrors{
  const e:SettingsErrors={}
  const brand=s.brandName.trim()
  if(brand.length<2||brand.length>40)e.brandName='Nom 2–40 belgidan iborat bo‘lishi kerak'
  if(s.supportEmail.trim()&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.supportEmail.trim()))e.supportEmail='E-pochta formati noto‘g‘ri'
  if(s.supportPhone.trim()&&!/^\+?[0-9 ()-]{7,20}$/.test(s.supportPhone.trim()))e.supportPhone='Telefon raqami formati noto‘g‘ri'
  if(!Number.isInteger(s.defaultTrialDays)||s.defaultTrialDays<1||s.defaultTrialDays>60)e.defaultTrialDays='Sinov muddati 1–60 kun oralig‘ida butun son'
  if(!Number.isInteger(s.graceDays)||s.graceDays<1||s.graceDays>30)e.graceDays='Imtiyoz muddati 1–30 kun oralig‘ida butun son'
  if(s.registration!=='open'&&s.registration!=='closed')e.registration='Ro‘yxatdan o‘tish siyosati noto‘g‘ri'
  return e
}

export function normalizePlatformStore(raw:unknown):PlatformStore|null{
  if(raw===null||raw===undefined)return emptyPlatformStore()
  if(!rec(raw)||raw.version!==1||!rec(raw.settings)||!Array.isArray(raw.audit)||!Array.isArray(raw.tickets))return null
  const settings={...DEFAULT_PLATFORM_SETTINGS,...raw.settings} as PlatformSettings
  if(!str(settings.brandName)||!str(settings.supportEmail)||!str(settings.supportPhone)||Object.keys(validateSettings(settings)).length)return null
  if(raw.audit.some(a=>!rec(a)||!str(a.id)||!date(a.at)||!str(a.actor)||!str(a.action)||!str(a.targetType)||!str(a.targetId)||!['success','denied','failed'].includes(String(a.outcome))))return null
  if(raw.tickets.some(t=>!rec(t)||!str(t.id)||typeof t.number!=='number'||!(t.tenantId===null||str(t.tenantId))||!str(t.subject)||!TICKET_CATEGORIES.includes(t.category as TicketCategory)||!TICKET_PRIORITIES.includes(t.priority as TicketPriority)||!TICKET_STATUSES.includes(t.status as TicketStatus)||!str(t.assignee)||!date(t.createdAt)||!date(t.updatedAt)||!Array.isArray(t.notes)))return null
  if(new Set(raw.tickets.map(t=>(t as SupportTicket).id)).size!==raw.tickets.length)return null
  return {version:1,settings,audit:raw.audit as PlatformAuditEntry[],tickets:raw.tickets as SupportTicket[]}
}

// ---------------------------------------------------------------- derived subscription state
export type EffectiveStatus=Subscription['status']|'none'
/** What a subscription means right now: a lapsed trial/active/grace end date is `expired`, matching `subscriptionActive`. */
export function effectiveStatus(sub:Subscription|undefined,now:Date):EffectiveStatus{
  if(!sub)return 'none'
  if(['trial','active','grace'].includes(sub.status)&&!SaaS.subscriptionActive(sub,now))return 'expired'
  return sub.status
}
export const daysLeft=(sub:Subscription|undefined,now:Date)=>sub?.endsAt?Math.ceil((Date.parse(sub.endsAt)-now.getTime())/DAY):null
export function trialStart(store:SaaSStore,tenantId:string){return store.subscriptions.find(s=>s.tenantId===tenantId&&s.status==='trial')?.startsAt}

export function maskEmail(email?:string){
  if(!email)return '—'
  const [name,domain]=email.split('@')
  if(!domain)return '•••'
  return `${name.slice(0,1)}${'•'.repeat(Math.max(2,Math.min(6,name.length-1)))}@${domain}`
}

export type CompanyRow={id:string;name:string;status:Tenant['status'];createdAt:string;suspensionReason?:string;ownerAccountId:string;planId:PlanId|null;subStatus:EffectiveStatus;endsAt?:string;daysLeft:number|null;members:number;activeMembers:number;legacy:boolean}
export function companyRows(store:SaaSStore,now:Date):CompanyRow[]{
  return store.tenants.map(t=>{
    const sub=SaaS.subscriptionFor(store,t.id),members=store.memberships.filter(m=>m.tenantId===t.id)
    return {id:t.id,name:t.name,status:t.status,createdAt:t.createdAt,suspensionReason:t.suspensionReason,ownerAccountId:t.ownerAccountId,planId:sub?.planId||null,subStatus:effectiveStatus(sub,now),endsAt:sub?.endsAt,daysLeft:daysLeft(sub,now),members:members.length,activeMembers:members.filter(m=>m.status==='active').length,legacy:t.id===SaaS.LEGACY_TENANT_ID}
  })
}

export type PlatformOverview={total:number;active:number;suspended:number;byStatus:Record<EffectiveStatus,number>;byPlan:Record<PlanId,number>;activeMemberships:number;activeAccounts:number;expiringTrials:CompanyRow[];recent:PlatformAuditEntry[]}
/** Every number is derived from stored records; each tenant counts once (latest subscription only). */
export function platformOverview(store:SaaSStore,platform:PlatformStore,now:Date,windowDays=7):PlatformOverview{
  const rows=companyRows(store,now)
  const byStatus={trial:0,active:0,grace:0,expired:0,suspended:0,none:0} as Record<EffectiveStatus,number>
  const byPlan={free:0,plus:0,pro:0,enterprise:0} as Record<PlanId,number>
  for(const r of rows){byStatus[r.subStatus]++;if(r.planId)byPlan[r.planId]++}
  const live=new Set(store.tenants.filter(t=>t.status==='active').map(t=>t.id))
  const memberships=store.memberships.filter(m=>m.status==='active'&&live.has(m.tenantId))
  return {total:rows.length,active:rows.filter(r=>r.status==='active').length,suspended:rows.filter(r=>r.status==='suspended').length,byStatus,byPlan,
    activeMemberships:memberships.length,activeAccounts:new Set(memberships.map(m=>m.accountId)).size,
    expiringTrials:rows.filter(r=>r.subStatus==='trial'&&r.daysLeft!==null&&r.daysLeft<=windowDays).sort((a,b)=>(a.endsAt||'').localeCompare(b.endsAt||'')),
    recent:platform.audit.slice(0,8)}
}

/** Platform actions recorded on company metadata before Phase 4.1 (no linked platform audit entry). */
const PLATFORM_SAAS_ACTIONS=/^(tenant\.(suspend|reactivate)|subscription\.override)/
export function legacyPlatformEvents(store:SaaSStore,platform:PlatformStore):PlatformAuditEntry[]{
  const linked=new Set(platform.audit.map(a=>a.saasEventId).filter(Boolean))
  return store.events.filter(e=>PLATFORM_SAAS_ACTIONS.test(e.action)&&!linked.has(e.id)).map(e=>({id:e.id,at:e.at,actor:e.actorAccountId||'—',action:e.action,targetType:e.action.startsWith('tenant')?'tenant':'subscription',targetId:e.targetId,tenantId:e.tenantId,reason:e.reason,outcome:(e.result==='denied'?'denied':'success') as AuditOutcome,detail:'Kompaniya metama’lumotidagi eski yozuv'}))
}
export function auditTrail(store:SaaSStore|null,platform:PlatformStore){
  return [...platform.audit,...(store?legacyPlatformEvents(store,platform):[])].sort((a,b)=>b.at.localeCompare(a.at))
}

// ---------------------------------------------------------------- operations
export type Snapshot={saas:SaaSStore;platform:PlatformStore}
export type OpResult={ok:true;next:Snapshot;message:string}|{ok:false;error:string}
const fail=(error:string):OpResult=>({ok:false,error})
const audit=(p:PlatformStore,e:Omit<PlatformAuditEntry,'id'|'outcome'>&{outcome?:AuditOutcome}):PlatformStore=>({...p,audit:[{id:uid('platform-audit'),outcome:'success' as AuditOutcome,...e},...p.audit].slice(0,PLATFORM_AUDIT_LIMIT)})
const guard=(actor:string,reason?:string)=>!validActor(actor)?'Operator identifikatori noto‘g‘ri':reason!==undefined&&reason.trim().length<5?'Sabab kamida 5 belgidan iborat bo‘lishi kerak':null

export function opTenantStatus(snap:Snapshot,actor:string,tenantId:string,status:Tenant['status'],reason:string,now:Date):OpResult{
  const bad=guard(actor,reason);if(bad)return fail(bad)
  const tenant=snap.saas.tenants.find(t=>t.id===tenantId)
  if(!tenant)return fail('Kompaniya topilmadi')
  if(tenant.status===status)return fail(status==='suspended'?'Kompaniya allaqachon to‘xtatilgan':'Kompaniya allaqachon faol')
  const saas=SaaS.setTenantStatus(snap.saas,tenantId,status,actor,reason,now)
  if(!saas)return fail('Holat o‘zgarmadi')
  const action=status==='suspended'?'tenant.suspend':'tenant.reactivate'
  return {ok:true,next:{saas,platform:audit(snap.platform,{at:now.toISOString(),actor,action,targetType:'tenant',targetId:tenantId,tenantId,reason:reason.trim(),saasEventId:saas.events[0].id,detail:`${tenant.status} → ${status}`})},message:status==='suspended'?`${tenant.name} to‘xtatildi. Ma’lumotlari saqlanadi.`:`${tenant.name} qayta faollashtirildi`}
}

export const OVERRIDE_STATUSES=['active','grace','expired','suspended'] as const
export function opOverride(snap:Snapshot,actor:string,tenantId:string,planId:PlanId,status:typeof OVERRIDE_STATUSES[number],reason:string,now:Date):OpResult{
  const bad=guard(actor,reason);if(bad)return fail(bad)
  if(!snap.saas.tenants.some(t=>t.id===tenantId))return fail('Kompaniya topilmadi')
  if(!SaaS.PLAN_CATALOG[planId])return fail('Reja topilmadi')
  if(!OVERRIDE_STATUSES.includes(status))return fail('Bu holatni platforma override orqali berib bo‘lmaydi (sinov qayta boshlanmaydi)')
  const current=SaaS.subscriptionFor(snap.saas,tenantId)
  if(current&&current.planId===planId&&effectiveStatus(current,now)===status&&status!=='grace')return fail('Obuna allaqachon shu reja va holatda')
  const endsAt=status==='grace'?new Date(now.getTime()+snap.platform.settings.graceDays*DAY).toISOString():undefined
  const saas=SaaS.platformOverridePlan(snap.saas,tenantId,planId,status,actor,reason,now,endsAt)
  if(!saas)return fail('Override yozilmadi')
  const from=current?`${current.planId}/${effectiveStatus(current,now)}`:'—'
  return {ok:true,next:{saas,platform:audit(snap.platform,{at:now.toISOString(),actor,action:'subscription.override',targetType:'subscription',targetId:saas.subscriptions[saas.subscriptions.length-1].id,tenantId,reason:reason.trim(),saasEventId:saas.events[0].id,detail:`${from} → ${planId}/${status}${endsAt?` (${endsAt.slice(0,10)} gacha)`:''}`})},message:'Obuna override yozildi. Bu to‘lov tasdig‘i emas.'}
}

export function opFeature(snap:Snapshot,actor:string,tenantId:string,module:string,enabled:boolean,reason:string,now:Date):OpResult{
  const bad=guard(actor,reason);if(bad)return fail(bad)
  if(!snap.saas.tenants.some(t=>t.id===tenantId))return fail('Kompaniya topilmadi')
  if(!SaaS.RESTRICTABLE_MODULES.includes(module))return fail('Bu modulni platforma cheklay olmaydi')
  const disabled=SaaS.disabledModules(snap.saas,tenantId).has(module)
  if(enabled===!disabled)return fail(enabled?'Modul allaqachon reja bo‘yicha':'Modul allaqachon o‘chirilgan')
  const plan=SaaS.subscriptionFor(snap.saas,tenantId)?.planId
  if(!enabled&&(!plan||!SaaS.PLAN_CATALOG[plan].modules.includes(module)))return fail('Modul joriy rejada yo‘q — cheklash kerak emas')
  const at=now.toISOString(),override:SaaS.FeatureOverride={id:uid('feature'),tenantId,module,state:enabled?'restored':'disabled',actor,at,reason:reason.trim()}
  const saas={...snap.saas,featureOverrides:[...(snap.saas.featureOverrides||[]),override]}
  return {ok:true,next:{saas,platform:audit(snap.platform,{at,actor,action:enabled?'feature.restore':'feature.disable',targetType:'feature',targetId:module,tenantId,reason:reason.trim()})},message:enabled?'Modul reja holatiga qaytarildi':'Modul ushbu kompaniya uchun o‘chirildi'}
}

export function settingsDiff(before:PlatformSettings,after:PlatformSettings){
  return (Object.keys(DEFAULT_PLATFORM_SETTINGS) as (keyof PlatformSettings)[]).filter(k=>before[k]!==after[k]).map(k=>({key:k,from:before[k],to:after[k]}))
}
export function opSettings(snap:Snapshot,actor:string,next:PlatformSettings,reason:string,now:Date):OpResult{
  const bad=guard(actor);if(bad)return fail(bad)
  const clean:PlatformSettings={...next,brandName:next.brandName.trim(),supportEmail:next.supportEmail.trim(),supportPhone:next.supportPhone.trim()}
  const errors=validateSettings(clean)
  if(Object.keys(errors).length)return fail(Object.values(errors)[0]!)
  const diff=settingsDiff(snap.platform.settings,clean)
  if(!diff.length)return fail('O‘zgarish yo‘q')
  if(diff.some(d=>SENSITIVE_SETTINGS.includes(d.key))&&reason.trim().length<5)return fail('Muhim sozlama uchun sabab kamida 5 belgi')
  const platform=audit({...snap.platform,settings:clean},{at:now.toISOString(),actor,action:'settings.update',targetType:'settings',targetId:'platform',reason:reason.trim()||undefined,detail:diff.map(d=>`${d.key}: ${d.from||'—'} → ${d.to||'—'}`).join('; ')})
  // Existing subscriptions are untouched: new trial/grace values apply to future registrations and overrides only.
  return {ok:true,next:{saas:snap.saas,platform},message:'Platforma sozlamalari saqlandi'}
}

const SECRET=/ZXR1\.\d{10,16}\.|-----BEGIN|"d"\s*:\s*"|parol\s*[:=]|password\s*[:=]/i
export function ticketTextProblem(text:string,min=1,max=2000){
  const t=text.trim()
  if(t.length<min)return `Matn kamida ${min} belgi bo‘lishi kerak`
  if(t.length>max)return `Matn ${max} belgidan oshmasin`
  if(SECRET.test(t))return 'Matnda parol, chipta yoki maxfiy kalitga o‘xshash qiymat bor — uni supportga yozmang'
  return null
}
export type TicketInput={tenantId:string|null;subject:string;category:TicketCategory;priority:TicketPriority;assignee:string;note:string}
export function opTicketCreate(snap:Snapshot,actor:string,input:TicketInput,now:Date):OpResult{
  const bad=guard(actor);if(bad)return fail(bad)
  const subject=ticketTextProblem(input.subject,5,120);if(subject)return fail(`Mavzu: ${subject}`)
  if(input.note.trim()){const note=ticketTextProblem(input.note);if(note)return fail(note)}
  if(input.tenantId&&!snap.saas.tenants.some(t=>t.id===input.tenantId))return fail('Kompaniya topilmadi')
  if(!TICKET_CATEGORIES.includes(input.category)||!TICKET_PRIORITIES.includes(input.priority))return fail('Toifa yoki ustuvorlik noto‘g‘ri')
  if(!validActor(input.assignee.trim()))return fail('Mas’ul operator ID noto‘g‘ri')
  if(snap.platform.tickets.length>=PLATFORM_TICKET_LIMIT)return fail('Demo murojaatlar chegarasiga yetildi')
  const at=now.toISOString(),number=snap.platform.tickets.reduce((m,t)=>Math.max(m,t.number),0)+1
  const notes:TicketNote[]=[{id:uid('note'),at,actor,kind:'create',text:'Murojaat qo‘lda ro‘yxatga olindi'},...(input.note.trim()?[{id:uid('note'),at,actor,kind:'note' as const,text:input.note.trim()}]:[])]
  const ticket:SupportTicket={id:uid('ticket'),number,tenantId:input.tenantId,subject:input.subject.trim(),category:input.category,priority:input.priority,status:'open',assignee:input.assignee.trim(),createdAt:at,createdBy:actor,updatedAt:at,notes}
  const platform=audit({...snap.platform,tickets:[ticket,...snap.platform.tickets]},{at,actor,action:'ticket.create',targetType:'ticket',targetId:ticket.id,tenantId:input.tenantId||undefined,detail:`#${number} ${ticket.priority}`})
  return {ok:true,next:{saas:snap.saas,platform},message:`Murojaat #${number} yaratildi`}
}

const TRANSITIONS:Record<TicketStatus,TicketStatus[]>={open:['in_progress','waiting','resolved','closed'],in_progress:['waiting','resolved','closed','open'],waiting:['in_progress','resolved','closed'],resolved:['closed','open'],closed:[]}
export const canTransition=(from:TicketStatus,to:TicketStatus)=>TRANSITIONS[from].includes(to)
export function opTicketUpdate(snap:Snapshot,actor:string,ticketId:string,change:{status?:TicketStatus;assignee?:string;note?:string},now:Date):OpResult{
  const bad=guard(actor);if(bad)return fail(bad)
  const ticket=snap.platform.tickets.find(t=>t.id===ticketId)
  if(!ticket)return fail('Murojaat topilmadi')
  if(ticket.status==='closed')return fail('Yopilgan murojaat o‘zgartirilmaydi')
  const at=now.toISOString(),notes:TicketNote[]=[]
  let next={...ticket}
  if(change.status&&change.status!==ticket.status){
    if(!canTransition(ticket.status,change.status))return fail(`${ticket.status} → ${change.status} o‘tishi ruxsat etilmagan`)
    next={...next,status:change.status};notes.push({id:uid('note'),at,actor,kind:'status',text:`${ticket.status} → ${change.status}`})
  }
  if(change.assignee!==undefined&&change.assignee.trim()!==ticket.assignee){
    if(!validActor(change.assignee.trim()))return fail('Mas’ul operator ID noto‘g‘ri')
    next={...next,assignee:change.assignee.trim()};notes.push({id:uid('note'),at,actor,kind:'assign',text:`${ticket.assignee} → ${change.assignee.trim()}`})
  }
  if(change.note?.trim()){const p=ticketTextProblem(change.note);if(p)return fail(p);notes.push({id:uid('note'),at,actor,kind:'note',text:change.note.trim()})}
  if(!notes.length)return fail('O‘zgarish yo‘q')
  next={...next,updatedAt:at,notes:[...ticket.notes,...notes]}
  const platform=audit({...snap.platform,tickets:snap.platform.tickets.map(t=>t.id===ticketId?next:t)},{at,actor,action:'ticket.update',targetType:'ticket',targetId:ticketId,tenantId:ticket.tenantId||undefined,detail:notes.filter(n=>n.kind!=='note').map(n=>n.text).join('; ')||'izoh qo‘shildi'})
  return {ok:true,next:{saas:snap.saas,platform},message:`Murojaat #${ticket.number} yangilandi`}
}

/** Session start/end is logged so operators can see who used the workspace. Not a trusted sign-in record. */
export function sessionAudit(platform:PlatformStore,actor:string,action:'session.start'|'session.end'|'session.expired',now:Date,detail?:string):PlatformStore{
  return audit(platform,{at:now.toISOString(),actor:validActor(actor)?actor:'unknown',action,targetType:'session',targetId:'platform',detail})
}

/** Registration policy and trial length a tenant registration reads; invalid stored data falls back to defaults. */
export function registrationPolicy(raw:unknown){
  const store=normalizePlatformStore(raw)
  return {open:(store?.settings.registration||'open')==='open',trialDays:store?.settings.defaultTrialDays||SaaS.DEFAULT_TRIAL_DAYS}
}

// ---------------------------------------------------------------- future backend contracts (types only)
/** GET /platform/v1/overview — server-computed from tenant, subscription and invoice tables. */
export type PlatformOverviewContract=PlatformOverview&{mrr:{amountMinor:number;currency:string};generatedAt:string}
/** Billing provider webhook, signature-verified and idempotent (unique providerEventId) before entitlement changes. */
export type PaymentEventContract={providerEventId:string;tenantId:string;subscriptionId:string;type:'payment.succeeded'|'payment.failed'|'refund.created'|'invoice.issued';amountMinor:number;currency:string;occurredAt:string;receivedAt:string;signatureVerified:true}
export type InvoiceContract={id:string;tenantId:string;number:string;status:'draft'|'open'|'paid'|'void'|'uncollectible';amountMinor:number;taxMinor:number;currency:string;periodStart:string;periodEnd:string;issuedAt:string;paidAt?:string}
/** Append-only server audit row; actor and timestamp come from the authenticated server session. */
export type PlatformAuditContract=Omit<PlatformAuditEntry,'saasEventId'>&{correlationId:string;serverReceivedAt:string;ip?:string;userAgent?:string;previousHash:string}
export type SystemHealthContract={checkedAt:string;api:{status:'up'|'degraded'|'down';p95LatencyMs:number};database:{status:'up'|'down';replicationLagMs?:number};workers:{name:string;status:'up'|'down';queueDepth:number}[];errorRate5m:number;uptime30d:number}
export type SupportChannelContract={channel:'email'|'chat'|'phone';inboundMessageId:string;tenantId?:string;receivedAt:string;from:string}
