// Accounts, sign-in policy, sessions and the security log of the frontend demo login. Pure functions over an
// AuthStore that is saved apart from the business data (never in backups, never touched by a reset). Password
// hashing is async and happens in the app (shared/lib/crypto.ts); these functions only receive the result.
// Everything here runs in the browser: it organises access for honest users, it does not stop someone who
// edits browser storage. Real protection needs a backend (docs/AUTH.md).
import type {Employee,ManufacturingState} from '../types'
import {isSuperAdminRole,roleOf,roleRank} from './access'

type S=ManufacturingState

export type Credential={hash:string;salt:string;iterations:number}
export type Account={
  id:string;employeeId:string;username:string;email?:string;
  hash:string;salt:string;iterations:number;
  status:'active'|'blocked';failedCount:number;lockedUntil?:string;mustChangePassword:boolean;
  /** Hash of the owner's one-time recovery key; older accounts have none. */
  recovery?:Credential;
  createdAt:string;createdBy?:string;updatedAt?:string;lastLoginAt?:string;passwordChangedAt?:string;
}
export type SecurityPolicy={minPasswordLength:number;requireLetterAndDigit:boolean;maxFailedAttempts:number;lockMinutes:number;idleMinutes:number;sessionHours:number;rememberDays:number}
export type AuthEventType='setup'|'login'|'login_failed'|'lockout'|'logout'|'session_expired'|'session_idle'|'password_changed'|'password_reset'|'account_created'|'account_updated'|'account_blocked'|'account_unblocked'|'account_deleted'|'policy_changed'|'recovery_key_created'|'password_recovered'
export type AuthEvent={id:string;at:string;type:AuthEventType;accountId?:string;login?:string;actorId?:string;actorName?:string;detail?:string}
export type AuthStore={version:1;accounts:Account[];policy:SecurityPolicy;events:AuthEvent[];
  /** Failed sign-ins per typed login, also for logins that do not exist (so they cannot be told apart). */
  attempts:Record<string,{count:number;lockedUntil?:string}>}
export type Session={id:string;accountId:string;employeeId:string;startedAt:string;lastActivity:string;expiresAt:string;remember:boolean}
export type AuthCtx={now:Date;actor?:Employee;id:(prefix:string)=>string}
export type AuthOutcome={store:AuthStore;state?:S;error?:undefined;message:string;id?:string}|{error:string}

export const AUTH_EVENT_LIMIT=2000
export const DEFAULT_POLICY:SecurityPolicy={minPasswordLength:8,requireLetterAndDigit:true,maxFailedAttempts:5,lockMinutes:15,idleMinutes:30,sessionHours:12,rememberDays:30}
export const emptyAuthStore=():AuthStore=>({version:1,accounts:[],policy:{...DEFAULT_POLICY},events:[],attempts:{}})

const iso=(d:Date)=>d.toISOString()
const plusMinutes=(d:Date,m:number)=>new Date(d.getTime()+m*60000)
/** A phone number typed with spaces, dashes or brackets ('+998 90 123-45-67'); 9 digits are a local Uzbek number. */
const PHONE_LIKE=/^\+?[\d\s()-]{9,24}$/
export function normalizePhone(login:string):string|null{
  const raw=login.trim()
  if(!PHONE_LIKE.test(raw))return null
  const digits=raw.replace(/\D/g,'')
  if(digits.length===9)return '+998'+digits
  return digits.length>=10&&digits.length<=15&&(raw.startsWith('+')||digits.length>=12)?'+'+digits:null
}
/** The comparable form of a login: a phone number in +digits form, anything else trimmed and lower-cased. */
export const normalizeLogin=(login:string)=>normalizePhone(login)??login.trim().toLowerCase()

/** Reads whatever was stored; anything missing falls back to defaults so an older store keeps working. */
export function normalizeAuthStore(raw:unknown):AuthStore{
  const r=(raw&&typeof raw==='object'?raw:{}) as Partial<AuthStore>
  // An entry that is not an account (null, a string) would break every lookup by id; it cannot sign in anyway.
  const accounts=Array.isArray(r.accounts)?r.accounts.filter(a=>a&&typeof a==='object'&&typeof a.id==='string'&&typeof a.employeeId==='string'):[]
  return {version:1,accounts,policy:{...DEFAULT_POLICY,...(r.policy&&typeof r.policy==='object'?r.policy:{})},events:Array.isArray(r.events)?r.events.filter(e=>e&&typeof e==='object'):[],attempts:r.attempts&&typeof r.attempts==='object'?r.attempts:{}}
}

const validTime=(v:unknown):v is string=>typeof v==='string'&&!Number.isNaN(Date.parse(v))

/** A stored session as the app wrote it, or null: a partial or hand-edited one must not live without expiry. */
export function normalizeSession(raw:unknown):Session|null{
  if(!raw||typeof raw!=='object')return null
  const r=raw as Partial<Session>
  if(typeof r.id!=='string'||typeof r.accountId!=='string'||typeof r.employeeId!=='string')return null
  if(!validTime(r.startedAt)||!validTime(r.lastActivity)||!validTime(r.expiresAt))return null
  return {id:r.id,accountId:r.accountId,employeeId:r.employeeId,startedAt:r.startedAt,lastActivity:r.lastActivity,expiresAt:r.expiresAt,remember:r.remember===true}
}

export function logAuth(store:AuthStore,ctx:AuthCtx,e:Omit<AuthEvent,'id'|'at'|'actorId'|'actorName'>):AuthStore{
  return {...store,events:[{id:ctx.id('ae'),at:iso(ctx.now),actorId:ctx.actor?.id,actorName:ctx.actor?.name,...e},...store.events].slice(0,AUTH_EVENT_LIMIT)}
}

/* --------------------------------------------------------------- rules -- */

export function validatePassword(policy:SecurityPolicy,password:string):string|null{
  if(password.length<policy.minPasswordLength)return `Parol kamida ${policy.minPasswordLength} belgidan iborat bo‘lsin`
  if(policy.requireLetterAndDigit&&!(/[A-Za-zЀ-ӿ]/.test(password)&&/\d/.test(password)))return 'Parolda kamida bitta harf va bitta raqam bo‘lsin'
  if(password.length>128)return 'Parol juda uzun'
  return null
}

export function validateUsername(username:string):string|null{
  if(normalizePhone(username))return null
  return /^[a-z0-9._-]{3,32}$/i.test(username.trim())?null:'Login: telefon raqami (+998…) yoki 3–32 belgi — lotin harf, raqam, nuqta, chiziqcha'
}
/** How a login is stored: phone numbers in one canonical form, so '+998 90 123 45 67' and '+998901234567' are the same login. */
export const storedLogin=(username:string)=>normalizePhone(username)??username.trim()
const validEmail=(email:string)=>!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export function findAccount(store:AuthStore,login:string){
  const key=normalizeLogin(login)
  return key?store.accounts.find(a=>normalizeLogin(a.username)===key||(a.email&&a.email.toLowerCase()===key)):undefined
}

/** Accounts that can still sign in as Super Admin: active, employee not archived, employee holds the Super Admin role. */
export function activeSuperAdmins(store:AuthStore,s:S,exceptAccountId?:string){
  return store.accounts.filter(a=>{
    if(a.id===exceptAccountId||a.status!=='active')return false
    const e=s.employees.find(x=>x.id===a.employeeId)
    return Boolean(e&&e.status!=='Arxiv'&&isSuperAdminRole(roleOf(s,e.id)))
  })
}

/** After setup there must always be a Super Admin who can sign in; any change that would end that is refused. */
export const superAdminInvariant=(store:AuthStore,s:S)=>!store.accounts.length||activeSuperAdmins(store,s).length>0

/**
 * Role assignments live in the business data, accounts outside it. When the business data had to be started
 * clean (recovery of unreadable data), nobody would hold Super Admin and every action would be blocked: the
 * employee of the oldest active account — the first-run administrator — gets the Super Admin role back.
 * Returns the state unchanged when the invariant already holds or no such employee exists.
 */
export function restoreSuperAdmin(store:AuthStore,s:S):S{
  if(superAdminInvariant(store,s))return s
  const superRole=s.roles.find(r=>r.key==='super_admin')
  const first=[...store.accounts].filter(a=>a.status==='active').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).find(a=>s.employees.some(e=>e.id===a.employeeId&&e.status!=='Arxiv'))
  if(!superRole||!first)return s
  return {...s,employees:s.employees.map(e=>e.id===first.employeeId?{...e,roleId:superRole.id}:e)}
}

/** Whether `actor` may manage the account of `employeeId`: never their own, only people ranked below them (Super Admin: anyone). */
export function accountManageBlocker(s:S,actor:Employee|undefined,employeeId:string,allowSelf=false):string|null{
  if(!actor)return 'Avval tizimga kiring'
  if(actor.id===employeeId)return allowSelf?null:'O‘z akkauntingizni bu yerda boshqara olmaysiz'
  const mine=roleOf(s,actor.id)
  if(isSuperAdminRole(mine))return null
  const target=s.employees.find(e=>e.id===employeeId)
  if(roleRank(roleOf(s,target?.id))>=roleRank(mine))return `${target?.name||'Bu foydalanuvchi'} sizning darajangizda yoki undan yuqori — faqat Super Admin boshqaradi`
  return null
}

/* -------------------------------------------------------------- set up -- */

/** True when stored accounts exist but cannot all be read: nothing may then be written over them. */
export function authStorageDamaged(raw:string|null):boolean{
  if(raw===null)return false
  try{
    const parsed=JSON.parse(raw) as {accounts?:unknown}|null
    if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.accounts))return true
    return normalizeAuthStore(parsed).accounts.length<parsed.accounts.length
  }catch{return true}
}

/**
 * Why first-run setup may not run. It exists only for a browser with no company owner: missing accounts alone are not
 * enough, because lost or damaged account storage next to a company's data must not hand that company to a stranger.
 */
export function bootstrapBlocker(store:AuthStore,s:S,rawAuth:string|null=null):string|null{
  if(store.accounts.length)return 'Tizim allaqachon sozlangan — tizimga kiring'
  if(authStorageDamaged(rawAuth))return 'Saqlangan akkauntlarni o‘qib bo‘lmadi. Yangi egasi yaratilmaydi va ma’lumotlar o‘zgartirilmaydi'
  if(rawAuth&&normalizeAuthStore(JSON.parse(rawAuth)).accounts.length)return 'Tizim allaqachon sozlangan — tizimga kiring'
  if(store.events.some(e=>e.type==='setup')||s.employees.some(e=>isSuperAdminRole(roleOf(s,e.id))))return 'Bu brauzerda kompaniya egasi allaqachon bo‘lgan, lekin akkaunt yozuvlari topilmadi. Yangi egasi yaratilmaydi va ma’lumotlar o‘zgartirilmaydi'
  return null
}

export type Registration={name:string;company:string;username:string;email?:string;password:string;confirm:string}
export type RegistrationField=keyof Registration

/** The first problem of a registration form, by field, in the order the fields are shown. */
export function registrationProblem(policy:SecurityPolicy,r:Registration):{field:RegistrationField;message:string}|null{
  if(r.name.trim().length<2)return {field:'name',message:'Ism-familiyani kiriting'}
  if(r.company.trim().length<2)return {field:'company',message:'Kompaniya nomini kiriting'}
  if(!r.username.trim())return {field:'username',message:'Telefon yoki loginni kiriting'}
  const badLogin=validateUsername(r.username)
  if(badLogin)return {field:'username',message:badLogin}
  if(r.email&&!validEmail(r.email.trim()))return {field:'email',message:'E-pochta noto‘g‘ri'}
  const weak=validatePassword(policy,r.password)
  if(weak)return {field:'password',message:weak}
  if(r.password!==r.confirm)return {field:'confirm',message:'Parollar mos emas'}
  return null
}

/**
 * First run only: the chosen employee becomes the Super Admin and gets the first account; the owner's name and the
 * company, when given, go to that employee and the company settings. No default password exists.
 */
export function setupFirstAdmin(store:AuthStore,s:S,ctx:AuthCtx,input:{employeeId:string;username:string;email?:string;credential:Credential;name?:string;company?:string;recovery?:Credential}):AuthOutcome{
  const closed=bootstrapBlocker(store,s)
  if(closed)return {error:closed}
  const employee=s.employees.find(e=>e.id===input.employeeId&&e.status!=='Arxiv')
  if(!employee)return {error:'Faol xodimni tanlang'}
  const bad=validateUsername(input.username)
  if(bad)return {error:bad}
  if(input.email&&!validEmail(input.email))return {error:'E-pochta noto‘g‘ri'}
  const superRole=s.roles.find(r=>r.key==='super_admin')
  if(!superRole)return {error:'Super Admin roli topilmadi — ma’lumotlar yangilanmagan'}
  const account:Account={id:ctx.id('acc'),employeeId:employee.id,username:storedLogin(input.username),email:input.email?.trim()||undefined,...input.credential,recovery:input.recovery,status:'active',failedCount:0,mustChangePassword:false,createdAt:iso(ctx.now),passwordChangedAt:iso(ctx.now)}
  const name=input.name?.trim()||employee.name,company=input.company?.trim()||s.settings.company.name
  const state={...s,settings:{...s.settings,company:{...s.settings.company,name:company}},employees:s.employees.map(e=>e.id===employee.id?{...e,name,roleId:superRole.id}:e)}
  const next=logAuth({...store,accounts:[account]},{...ctx,actor:employee},{type:'setup',accountId:account.id,login:account.username,detail:`${name} → Super Admin`})
  return {store:next,state,message:'Super Admin yaratildi',id:account.id}
}

/* ------------------------------------------------------------- recovery -- */

/** Attempts with a recovery key are counted apart from sign-ins: a locked sign-in must not also lock recovery. */
export const recoveryAttemptKey=(login:string)=>`recovery:${normalizeLogin(login)}`

/** The text an owner's recovery ticket signs: it is good for one login and one visit of the recovery page, until it expires. */
export const recoveryTicketMessage=(login:string,code:string,expiresAt:number|string)=>`zenix-recovery-v1|${login}|${code}|${expiresAt}`

/** A signed ticket restores only an active Super Admin; other people ask an administrator. */
export function ownerRecoveryBlocker(store:AuthStore,s:S,account:Account|undefined):string|null{
  if(!account||!activeSuperAdmins(store,s).some(a=>a.id===account.id))return 'Bu yo‘l faqat faol Super Admin uchun. Xodimlar parolni administrator orqali tiklaydi'
  return null
}

/** The owner sets a new password after proving recovery; the used key is replaced by `recovery`. Business data is not touched. */
export function recoverPassword(store:AuthStore,ctx:AuthCtx,accountId:string,input:{credential:Credential;recovery:Credential;method:'key'|'ticket'}):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const cleared=[normalizeLogin(account.username),account.email?.toLowerCase(),recoveryAttemptKey(account.username)]
  const attempts=Object.fromEntries(Object.entries(store.attempts).filter(([key])=>!cleared.includes(key)))
  const next=logAuth({...store,attempts,accounts:store.accounts.map(a=>a.id===accountId?{...a,...input.credential,recovery:input.recovery,mustChangePassword:false,failedCount:0,lockedUntil:undefined,passwordChangedAt:iso(ctx.now),updatedAt:iso(ctx.now)}:a)},ctx,{type:'password_recovered',accountId,login:account.username,detail:input.method==='key'?'tiklash kaliti bilan':'imzolangan chipta bilan'})
  return {store:next,message:'Parol yangilandi — yangi parol bilan kiring',id:accountId}
}

/** A signed-in Super Admin makes (or replaces) their recovery key, after the app verified their password. */
export function setRecoveryKey(store:AuthStore,s:S,ctx:AuthCtx,accountId:string,recovery:Credential):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  if(!activeSuperAdmins(store,s).some(a=>a.id===accountId))return {error:'Tiklash kaliti faqat Super Admin uchun'}
  const next=logAuth({...store,accounts:store.accounts.map(a=>a.id===accountId?{...a,recovery,updatedAt:iso(ctx.now)}:a)},ctx,{type:'recovery_key_created',accountId,login:account.username})
  return {store:next,message:'Tiklash kaliti yaratildi',id:accountId}
}

/* -------------------------------------------------------------- sign in -- */

export function lockState(store:AuthStore,login:string,now:Date){
  const key=normalizeLogin(login)
  const account=findAccount(store,login)
  const until=account?.lockedUntil||store.attempts[key]?.lockedUntil
  return until&&until>iso(now)?until:undefined
}

/** A wrong password (or unknown login): counted per account and per typed login; the threshold locks both for a while. */
export function recordFailure(store:AuthStore,ctx:AuthCtx,login:string,account?:Account):AuthStore{
  const key=normalizeLogin(login),p=store.policy
  const count=(store.attempts[key]?.count||0)+1
  const locked=count>=p.maxFailedAttempts?iso(plusMinutes(ctx.now,p.lockMinutes)):undefined
  let next:AuthStore={...store,attempts:{...store.attempts,[key]:{count:locked?0:count,lockedUntil:locked}}}
  if(account)next={...next,accounts:next.accounts.map(a=>a.id===account.id?{...a,failedCount:locked?0:a.failedCount+1,lockedUntil:locked||a.lockedUntil}:a)}
  next=logAuth(next,ctx,{type:'login_failed',accountId:account?.id,login:key})
  if(locked)next=logAuth(next,ctx,{type:'lockout',accountId:account?.id,login:key,detail:`${p.maxFailedAttempts} ta xato urinish · ${p.lockMinutes} min`})
  return next
}

/** Why a correctly authenticated account still may not sign in (blocked, employee archived or missing). */
export function signInBlocker(s:S,account:Account):string|null{
  if(account.status==='blocked')return 'Akkaunt bloklangan — administratorga murojaat qiling'
  const e=s.employees.find(x=>x.id===account.employeeId)
  if(!e)return 'Akkauntga bog‘langan xodim topilmadi — administratorga murojaat qiling'
  if(e.status==='Arxiv')return 'Xodim arxivlangan — kirish yopiq'
  if(!roleOf(s,e.id))return 'Xodimga rol biriktirilmagan — administratorga murojaat qiling'
  return null
}

export function recordSuccess(store:AuthStore,ctx:AuthCtx,account:Account,remember:boolean):{store:AuthStore;session:Session}{
  const key=normalizeLogin(account.username),p=store.policy
  const {[key]:_,...attempts}=store.attempts
  const session:Session={id:ctx.id('ses'),accountId:account.id,employeeId:account.employeeId,startedAt:iso(ctx.now),lastActivity:iso(ctx.now),expiresAt:iso(plusMinutes(ctx.now,remember?p.rememberDays*1440:p.sessionHours*60)),remember}
  const next=logAuth({...store,attempts,accounts:store.accounts.map(a=>a.id===account.id?{...a,failedCount:0,lockedUntil:undefined,lastLoginAt:iso(ctx.now)}:a)},ctx,{type:'login',accountId:account.id,login:account.username,detail:remember?'eslab qolish bilan':''})
  return {store:next,session}
}

export type SessionProblem='missing'|'expired'|'idle'|'blocked'|'credentials'
/** Whether a stored session still lets its user in; `idle` applies only to sessions without "remember me". */
export function sessionProblem(session:Session|null,store:AuthStore,s:S,now:Date):SessionProblem|null{
  if(!session)return 'missing'
  // Times that cannot be read would never expire: such a session is treated as expired.
  if(!validTime(session.expiresAt)||!validTime(session.lastActivity)||!validTime(session.startedAt))return 'expired'
  const account=store.accounts.find(a=>a.id===session.accountId)
  if(!account||account.employeeId!==session.employeeId)return 'missing'
  if(signInBlocker(s,account))return 'blocked'
  // A password set after this session began (reset by an administrator, or changed elsewhere) ends it.
  if(account.passwordChangedAt&&account.passwordChangedAt>session.startedAt)return 'credentials'
  if(session.expiresAt<=iso(now))return 'expired'
  if(!session.remember&&plusMinutes(new Date(session.lastActivity),store.policy.idleMinutes)<=now)return 'idle'
  return null
}

/* ------------------------------------------------------ user management -- */

export type AccountInput={employeeId:string;username:string;email?:string;credential:Credential;mustChangePassword?:boolean}

export function createAccount(store:AuthStore,s:S,ctx:AuthCtx,input:AccountInput):AuthOutcome{
  const employee=s.employees.find(e=>e.id===input.employeeId)
  if(!employee)return {error:'Xodimni tanlang'}
  if(employee.status==='Arxiv')return {error:'Arxivlangan xodimga akkaunt ochilmaydi'}
  const blocked=accountManageBlocker(s,ctx.actor,employee.id)
  if(blocked)return {error:blocked}
  if(store.accounts.some(a=>a.employeeId===employee.id))return {error:`${employee.name} uchun akkaunt allaqachon bor`}
  const bad=validateUsername(input.username)
  if(bad)return {error:bad}
  if(findAccount(store,input.username))return {error:'Bu login band'}
  if(input.email&&!validEmail(input.email))return {error:'E-pochta noto‘g‘ri'}
  if(input.email&&findAccount(store,input.email))return {error:'Bu e-pochta boshqa akkauntda'}
  const account:Account={id:ctx.id('acc'),employeeId:employee.id,username:storedLogin(input.username),email:input.email?.trim()||undefined,...input.credential,status:'active',failedCount:0,mustChangePassword:input.mustChangePassword??true,createdAt:iso(ctx.now),createdBy:ctx.actor?.id,passwordChangedAt:iso(ctx.now)}
  const next=logAuth({...store,accounts:[...store.accounts,account]},ctx,{type:'account_created',accountId:account.id,login:account.username,detail:employee.name})
  return {store:next,message:`${account.username} akkaunti yaratildi`,id:account.id}
}

export function updateAccount(store:AuthStore,s:S,ctx:AuthCtx,accountId:string,patch:{username?:string;email?:string}):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const blocked=accountManageBlocker(s,ctx.actor,account.employeeId,true)
  if(blocked)return {error:blocked}
  const username=patch.username!==undefined?storedLogin(patch.username):account.username,email=patch.email!==undefined?patch.email.trim()||undefined:account.email
  const bad=validateUsername(username)
  if(bad)return {error:bad}
  const other=findAccount(store,username)
  if(other&&other.id!==accountId)return {error:'Bu login band'}
  if(email&&!validEmail(email))return {error:'E-pochta noto‘g‘ri'}
  if(email){const taken=findAccount(store,email);if(taken&&taken.id!==accountId)return {error:'Bu e-pochta boshqa akkauntda'}}
  const next=logAuth({...store,accounts:store.accounts.map(a=>a.id===accountId?{...a,username,email,updatedAt:iso(ctx.now)}:a)},ctx,{type:'account_updated',accountId,login:username,detail:username!==account.username?`${account.username} → ${username}`:''})
  return {store:next,message:'Akkaunt saqlandi',id:accountId}
}

/** Block or unblock (unblocking also lifts a failed-attempts lock). The last active Super Admin is never blocked. */
export function setAccountStatus(store:AuthStore,s:S,ctx:AuthCtx,accountId:string,status:Account['status']):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const blocked=accountManageBlocker(s,ctx.actor,account.employeeId)
  if(blocked)return {error:blocked}
  if(status==='blocked'&&!activeSuperAdmins(store,s,accountId).length&&activeSuperAdmins(store,s).some(a=>a.id===accountId))return {error:'Oxirgi faol Super Admin’ni bloklab bo‘lmaydi'}
  const key=normalizeLogin(account.username)
  const {[key]:_,...attempts}=store.attempts
  const next=logAuth({...store,attempts:status==='active'?attempts:store.attempts,accounts:store.accounts.map(a=>a.id===accountId?{...a,status,...(status==='active'?{failedCount:0,lockedUntil:undefined}:{}),updatedAt:iso(ctx.now)}:a)},ctx,{type:status==='blocked'?'account_blocked':'account_unblocked',accountId,login:account.username})
  return {store:next,message:status==='blocked'?`${account.username} bloklandi`:`${account.username} faollashtirildi`,id:accountId}
}

/** An administrator sets a temporary password; the user must change it at the next sign-in. */
export function resetPassword(store:AuthStore,s:S,ctx:AuthCtx,accountId:string,credential:Credential):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const blocked=accountManageBlocker(s,ctx.actor,account.employeeId)
  if(blocked)return {error:blocked}
  const next=logAuth({...store,accounts:store.accounts.map(a=>a.id===accountId?{...a,...credential,mustChangePassword:true,failedCount:0,lockedUntil:undefined,passwordChangedAt:iso(ctx.now),updatedAt:iso(ctx.now)}:a)},ctx,{type:'password_reset',accountId,login:account.username})
  return {store:next,message:`${account.username}: vaqtinchalik parol o‘rnatildi`,id:accountId}
}

/** The signed-in user replaces their own password (after the app verified the current one). */
export function changeOwnPassword(store:AuthStore,ctx:AuthCtx,accountId:string,credential:Credential):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const next=logAuth({...store,accounts:store.accounts.map(a=>a.id===accountId?{...a,...credential,mustChangePassword:false,passwordChangedAt:iso(ctx.now),updatedAt:iso(ctx.now)}:a)},ctx,{type:'password_changed',accountId,login:account.username})
  return {store:next,message:'Parol yangilandi',id:accountId}
}

export function deleteAccount(store:AuthStore,s:S,ctx:AuthCtx,accountId:string):AuthOutcome{
  const account=store.accounts.find(a=>a.id===accountId)
  if(!account)return {error:'Akkaunt topilmadi'}
  const blocked=accountManageBlocker(s,ctx.actor,account.employeeId)
  if(blocked)return {error:blocked}
  if(activeSuperAdmins(store,s).some(a=>a.id===accountId)&&!activeSuperAdmins(store,s,accountId).length)return {error:'Oxirgi faol Super Admin akkauntini o‘chirib bo‘lmaydi'}
  const next=logAuth({...store,accounts:store.accounts.filter(a=>a.id!==accountId)},ctx,{type:'account_deleted',accountId,login:account.username})
  return {store:next,message:`${account.username} akkaunti o‘chirildi`,id:accountId}
}

export function updatePolicy(store:AuthStore,ctx:AuthCtx,patch:Partial<SecurityPolicy>):AuthOutcome{
  const p={...store.policy,...patch}
  const within=(v:number,min:number,max:number)=>Number.isInteger(v)&&v>=min&&v<=max
  if(!within(p.minPasswordLength,8,64))return {error:'Parol uzunligi 8–64'}
  if(!within(p.maxFailedAttempts,3,20))return {error:'Urinishlar chegarasi 3–20'}
  if(!within(p.lockMinutes,1,1440))return {error:'Bloklash 1–1440 daqiqa'}
  if(!within(p.idleMinutes,5,480))return {error:'Harakatsizlik 5–480 daqiqa'}
  if(!within(p.sessionHours,1,72))return {error:'Session 1–72 soat'}
  if(!within(p.rememberDays,1,90))return {error:'Eslab qolish 1–90 kun'}
  const changed=(Object.keys(patch) as (keyof SecurityPolicy)[]).filter(k=>patch[k]!==store.policy[k])
  const next=logAuth({...store,policy:p},ctx,{type:'policy_changed',detail:changed.map(k=>`${k}: ${store.policy[k]} → ${p[k]}`).join(', ')})
  return {store:next,message:'Xavfsizlik siyosati saqlandi'}
}
