import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {createInitialState} from '../../../data/mockData'
import {storage} from '../../../shared/lib/storage'
import {createSyncedSlot} from '../../../shared/lib/syncedState'
import {pairFor} from '../../theme/themeRegistry'
import * as A from '../../../domain/actions'
import type {Ctx,EntityKey,Outcome} from '../../../domain/actions'
import type {ActionResult,AppearanceFamily,CurrencyCode,Employee,ManufacturingState,PermissionAction,Role,SettingsState,ThemeMode} from '../../../types'
import {setDisplayCurrency} from '../../../utils/format'
import {migrateSupplierLinks} from '../../../domain/supplierMaterials'
import {clearTransactions,holdsOnlyDemoRecords,TRANSACTION_KEYS} from '../../../domain/reset'
import {stamp} from '../../../utils/dates'
import {actionRules,allowedBy,entityRules,hasPermission,roleOf,scopeBlocker} from '../../../domain/access'
import {SCHEMA_VERSION,migrateState} from '../../../domain/migrations'
import * as Auth from '../../../domain/auth'
import type {Account,AuthOutcome,AuthStore,SecurityPolicy,Session,SessionProblem} from '../../../domain/auth'
import {PBKDF2_ITERATIONS,hashPassword,makeCredential,randomSalt,verifyPassword} from '../../../shared/lib/crypto'
import type {EntityKeyName,Rules} from '../../../domain/access'

const STORAGE_KEY='zenix-manufacturing-v3-state'
const LEGACY_KEY='zenix-manufacturing-v2-state'
/** Copy of the data as it was right before a transaction reset (restore it via Tizim → Backup import after exporting). */
const BACKUP_KEY='zenix-manufacturing-v3-before-reset'
/** Set once this browser holds no generated demo history (fresh start or the one-time cleanup ran). */
const CLEAN_KEY='zenix-manufacturing-v3-clean-start'
/** Stored text that could not be read is kept here (with a timestamp) before anything is written over it (BUG-14). */
const CORRUPT_KEY='zenix-manufacturing-v3-unreadable'
/** The data exactly as it was before its first schema upgrade (written once, never overwritten). */
const MIGRATION_BACKUP_KEY='zenix-manufacturing-before-v4'
/** Accounts, password hashes, sign-in policy and the security log — never part of the business data, a backup or a reset. */
const AUTH_KEY='zenix-auth-v1'
/** The signed-in session of this browser, shared by its tabs (signing out in one tab signs out all). */
const SESSION_KEY='zenix-session-v1'
/** Activity older than the newest ACTIVITY_LIMIT entries (BUG-07); read by the audit log, not part of backups of the working data. */
const ACTIVITY_ARCHIVE_KEY='zenix-activity-archive-v1'
const uid=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`

export type ToastTone='success'|'warning'|'danger'|'info'
export type Toast={id:string;message:string;tone:ToastTone}
export type UiPreferences=Pick<SettingsState,'theme'|'appearance'|'currency'|'fontSize'|'reducedMotion'>
export type {EntityKey}

const UI_KEYS:(keyof UiPreferences)[]=['theme','appearance','currency','fontSize','reducedMotion']
const pickUi=(settings:Partial<SettingsState>|undefined)=>Object.fromEntries(UI_KEYS.filter(k=>settings?.[k]!==undefined).map(k=>[k,settings![k]])) as Partial<UiPreferences>

// Module permissions per action live in domain/access.ts (ACTION_RULES), where they are unit-tested.
const ENTITY_LABEL:Record<EntityKey,string>={products:'Mahsulot',rawMaterials:'Xomashyo',suppliers:'Supplier',customers:'Mijoz',employees:'Xodim',expenses:'Xarajat',qualityAlerts:'Quality alert',maintenanceOrders:'Maintenance',engineeringChanges:'ECO',qualityControlPoints:'Control point',maintenanceRequests:'Maintenance request',subcontractOrders:'Subcontract',repairOrders:'Repair order',warehouses:'Ombor',workCenters:'Work center',productionLines:'Liniya',equipment:'Uskuna',branches:'Filial'}
const ATTACHMENT_MODULE:Record<string,string>={product:'products',bom:'products',eco:'products',material:'materials',purchase:'purchases',supplier:'purchases',production:'production',sales:'sales',customer:'sales',equipment:'equipment',quality:'quality'}

type Bound<F>=F extends (s:ManufacturingState,ctx:Ctx,...args:infer P)=>Outcome?(...args:P)=>ActionResult:never
type DomainApi={
  createProductionOrder:Bound<typeof A.createProductionOrder>;updateProductionOrder:Bound<typeof A.updateProductionOrder>;transitionProduction:Bound<typeof A.transitionProduction>;shortCloseProduction:Bound<typeof A.shortCloseProduction>;reportOutput:Bound<typeof A.reportOutput>;recordScrap:Bound<typeof A.recordScrap>;
  splitProduction:Bound<typeof A.splitProduction>;mergeProduction:Bound<typeof A.mergeProduction>;createBackorder:Bound<typeof A.createBackorder>;unbuildProduct:Bound<typeof A.unbuildProduct>;issueExtraMaterial:Bound<typeof A.issueExtraMaterial>;checkAvailability:Bound<typeof A.checkAvailability>;
  startWorkOrder:Bound<typeof A.startWorkOrder>;pauseWorkOrder:Bound<typeof A.pauseWorkOrder>;finishWorkOrder:Bound<typeof A.finishWorkOrder>;setForecast:Bound<typeof A.setForecast>;recordMaterialScan:Bound<typeof A.recordMaterialScan>;rollUpCosts:Bound<typeof A.rollUpCosts>;createReworkOrder:Bound<typeof A.createReworkOrder>;
  createQualityCheck:Bound<typeof A.createQualityCheck>;resolveQuality:Bound<typeof A.resolveQuality>;createQualityAlert:Bound<typeof A.createQualityAlert>;
  createPurchaseOrder:Bound<typeof A.createPurchaseOrder>;createPurchaseOrders:Bound<typeof A.createPurchaseOrders>;linkSupplierMaterial:Bound<typeof A.linkSupplierMaterial>;updateSupplierMaterial:Bound<typeof A.updateSupplierMaterial>;removeSupplierMaterial:Bound<typeof A.removeSupplierMaterial>;setPreferredSupplier:Bound<typeof A.setPreferredSupplier>;saveSupplier:(p:Parameters<typeof A.saveSupplier>[2])=>ActionResult;confirmPurchase:Bound<typeof A.confirmPurchase>;markPurchaseInTransit:Bound<typeof A.markPurchaseInTransit>;cancelPurchase:Bound<typeof A.cancelPurchase>;closePurchaseShort:Bound<typeof A.closePurchaseShort>;updatePurchaseMeta:Bound<typeof A.updatePurchaseMeta>;receivePurchase:Bound<typeof A.receivePurchase>;returnPurchaseToSupplier:Bound<typeof A.returnPurchaseToSupplier>;advanceSubcontract:Bound<typeof A.advanceSubcontract>;
  createSalesOrder:Bound<typeof A.createSalesOrder>;reserveSalesOrder:Bound<typeof A.reserveSalesOrder>;deliverSalesOrder:Bound<typeof A.deliverSalesOrder>;cancelSalesOrder:Bound<typeof A.cancelSalesOrder>;updateSalesMeta:Bound<typeof A.updateSalesMeta>;createReturn:Bound<typeof A.createReturn>;dispositionReturn:Bound<typeof A.dispositionReturn>;
  transferStock:Bound<typeof A.transferStock>;adjustStock:Bound<typeof A.adjustStock>;countStock:Bound<typeof A.countStock>;
  startDowntime:Bound<typeof A.startDowntime>;endDowntime:Bound<typeof A.endDowntime>;approveMaintenanceRequest:Bound<typeof A.approveMaintenanceRequest>;startMaintenance:Bound<typeof A.startMaintenance>;completeMaintenance:Bound<typeof A.completeMaintenance>;cancelMaintenance:Bound<typeof A.cancelMaintenance>;planPreventiveMaintenance:Bound<typeof A.planPreventiveMaintenance>;advanceRepair:Bound<typeof A.advanceRepair>;
  createBomDraft:Bound<typeof A.createBomDraft>;saveBom:Bound<typeof A.saveBom>;deleteBomDraft:Bound<typeof A.deleteBomDraft>;activateBom:Bound<typeof A.activateBom>;createEngineeringChange:Bound<typeof A.createEngineeringChange>;setEcoStatus:Bound<typeof A.setEcoStatus>;applyEngineeringChange:Bound<typeof A.applyEngineeringChange>;
  updateRolePermission:Bound<typeof A.updateRolePermission>;createRole:Bound<typeof A.createRole>;duplicateRole:Bound<typeof A.duplicateRole>;updateRole:Bound<typeof A.updateRole>;deleteRole:Bound<typeof A.deleteRole>;addAttachment:Bound<typeof A.addAttachment>;removeAttachment:Bound<typeof A.removeAttachment>;
}
const DOMAIN_ACTIONS={createProductionOrder:A.createProductionOrder,updateProductionOrder:A.updateProductionOrder,transitionProduction:A.transitionProduction,shortCloseProduction:A.shortCloseProduction,reportOutput:A.reportOutput,recordScrap:A.recordScrap,issueExtraMaterial:A.issueExtraMaterial,splitProduction:A.splitProduction,mergeProduction:A.mergeProduction,createBackorder:A.createBackorder,unbuildProduct:A.unbuildProduct,checkAvailability:A.checkAvailability,startWorkOrder:A.startWorkOrder,pauseWorkOrder:A.pauseWorkOrder,finishWorkOrder:A.finishWorkOrder,setForecast:A.setForecast,recordMaterialScan:A.recordMaterialScan,rollUpCosts:A.rollUpCosts,createReworkOrder:A.createReworkOrder,createQualityCheck:A.createQualityCheck,resolveQuality:A.resolveQuality,createQualityAlert:A.createQualityAlert,createPurchaseOrder:A.createPurchaseOrder,createPurchaseOrders:A.createPurchaseOrders,linkSupplierMaterial:A.linkSupplierMaterial,updateSupplierMaterial:A.updateSupplierMaterial,removeSupplierMaterial:A.removeSupplierMaterial,setPreferredSupplier:A.setPreferredSupplier,confirmPurchase:A.confirmPurchase,markPurchaseInTransit:A.markPurchaseInTransit,cancelPurchase:A.cancelPurchase,closePurchaseShort:A.closePurchaseShort,updatePurchaseMeta:A.updatePurchaseMeta,receivePurchase:A.receivePurchase,returnPurchaseToSupplier:A.returnPurchaseToSupplier,advanceSubcontract:A.advanceSubcontract,createSalesOrder:A.createSalesOrder,reserveSalesOrder:A.reserveSalesOrder,deliverSalesOrder:A.deliverSalesOrder,cancelSalesOrder:A.cancelSalesOrder,updateSalesMeta:A.updateSalesMeta,createReturn:A.createReturn,dispositionReturn:A.dispositionReturn,transferStock:A.transferStock,adjustStock:A.adjustStock,countStock:A.countStock,startDowntime:A.startDowntime,endDowntime:A.endDowntime,approveMaintenanceRequest:A.approveMaintenanceRequest,startMaintenance:A.startMaintenance,completeMaintenance:A.completeMaintenance,cancelMaintenance:A.cancelMaintenance,planPreventiveMaintenance:A.planPreventiveMaintenance,advanceRepair:A.advanceRepair,createBomDraft:A.createBomDraft,saveBom:A.saveBom,deleteBomDraft:A.deleteBomDraft,activateBom:A.activateBom,createEngineeringChange:A.createEngineeringChange,setEcoStatus:A.setEcoStatus,applyEngineeringChange:A.applyEngineeringChange,updateRolePermission:A.updateRolePermission,createRole:A.createRole,duplicateRole:A.duplicateRole,updateRole:A.updateRole,deleteRole:A.deleteRole,addAttachment:A.addAttachment,removeAttachment:A.removeAttachment} as const

type AppContextValue=DomainApi&{
  state:ManufacturingState;resolvedTheme:'light'|'dark';toasts:Toast[];dismissToast:(id:string)=>void;
  sidebarMobile:boolean;setSidebarMobile:(v:boolean)=>void;searchOpen:boolean;setSearchOpen:(v:boolean)=>void;notifOpen:boolean;setNotifOpen:(v:boolean)=>void;aiOpen:boolean;setAiOpen:(v:boolean)=>void;
  currentEmployee:Employee;currentRole:Role;can:(module:string,action?:PermissionAction)=>boolean;
  auth:{needsSetup:boolean;signedIn:boolean;session:Session|null;account:Account|null;accounts:Account[];events:AuthStore['events'];policy:SecurityPolicy;notice:string};
  login:(login:string,password:string,remember:boolean)=>Promise<ActionResult>;logout:(reason?:SessionProblem|'logout')=>void;clearAuthNotice:()=>void;
  setupSuperAdmin:(p:{employeeId:string;username:string;email?:string;password:string})=>Promise<ActionResult>;
  changePassword:(current:string,next:string)=>Promise<ActionResult>;
  createUser:(p:{employeeId:string;username:string;email?:string;password:string;mustChangePassword?:boolean})=>Promise<ActionResult>;
  updateUser:(accountId:string,patch:{username?:string;email?:string})=>ActionResult;setUserStatus:(accountId:string,status:Account['status'])=>ActionResult;
  resetUserPassword:(accountId:string,password:string)=>Promise<ActionResult>;deleteUser:(accountId:string)=>ActionResult;updateSecurityPolicy:(patch:Partial<SecurityPolicy>)=>ActionResult;
  toast:(message:string,tone?:ToastTone)=>void;
  saveSettings:(patch:Partial<SettingsState>)=>void;setPreferences:(patch:Partial<UiPreferences>)=>void;setTheme:(theme:ThemeMode)=>void;setAppearance:(family:AppearanceFamily)=>void;setCurrency:(currency:CurrencyCode)=>void;
  resetTransactions:()=>ActionResult;importState:(data:unknown)=>ActionResult;restoreLastBackup:()=>ActionResult;lastBackup:()=>{savedAt?:string;reason?:string;state?:unknown}|null;markAllRead:()=>void;markNotificationRead:(id:string)=>void;activityArchive:()=>ManufacturingState['activity'];
  createEntity:(key:EntityKey,payload:Record<string,unknown>)=>ActionResult;updateEntity:(key:EntityKey,id:string,patch:Record<string,unknown>)=>ActionResult;deleteEntity:(key:EntityKey,id:string)=>ActionResult;duplicateEntity:(key:EntityKey,id:string)=>ActionResult;
}

const Ctx=createContext<AppContextValue|null>(null)

/** Shown while nobody is signed in: it has no role, so every permission check fails. */
const NOBODY:Employee={id:'',name:'—',roleId:'',department:'',workCenterId:'',shift:'',status:'Arxiv',attendance:0,efficiency:0,hourlyCost:0}
const hhmm=(d:Date)=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
const NO_ROLE:Role={id:'',name:'—',scope:'all',permissions:{}}
const NOTICE:Record<SessionProblem|'logout'|'elsewhere',string>={missing:'',logout:'Tizimdan chiqdingiz.',expired:'Session muddati tugadi — qayta kiring.',idle:'Uzoq vaqt harakatsizlik sababli session yopildi — qayta kiring.',blocked:'Akkauntingiz bloklangan yoki o‘zgartirilgan — administratorga murojaat qiling.',elsewhere:'Boshqa oynada tizimdan chiqildi.',credentials:'Parolingiz o‘zgartirildi — yangi parol bilan qayta kiring.'}

function normalize(loaded:Partial<ManufacturingState>,seed:ManufacturingState):ManufacturingState{
  const merged={...seed,...loaded} as ManufacturingState
  // The seed is always current; the saved version decides which migrations still have to run.
  merged.schemaVersion=loaded.schemaVersion
  for(const key of Object.keys(seed) as (keyof ManufacturingState)[]){
    if(Array.isArray(seed[key])&&!Array.isArray(merged[key]))(merged as unknown as Record<string,unknown>)[key]=seed[key]
  }
  // Saved before supplier ↔ material links existed: rebuild them from the relationships that data confirms.
  if(!Array.isArray(loaded.supplierMaterials))merged.supplierMaterials=migrateSupplierLinks(merged)
  const s=loaded.settings
  merged.settings={...seed.settings,...(s||{}),notifications:{...seed.settings.notifications,...s?.notifications},ai:{...seed.settings.ai,...s?.ai},company:{...seed.settings.company,...s?.company},policies:{...seed.settings.policies,...s?.policies}}
  return merged
}

/** Set when hydrate found stored data it could not read and kept a copy; the provider tells the user once. */
let unreadableNotice=''

/** Parses stored state; anything unreadable is copied aside first so the next save cannot destroy it (BUG-14). */
function readStored():Partial<ManufacturingState>|null{
  const raw=storage.getRaw(STORAGE_KEY)
  if(!raw)return null
  try{
    const parsed=JSON.parse(raw) as Partial<ManufacturingState>
    if(parsed&&typeof parsed==='object'&&Array.isArray(parsed.productionOrders))return parsed
  }catch{/* handled below */}
  if(storage.setRaw(CORRUPT_KEY,JSON.stringify({savedAt:stamp(new Date()),raw})))unreadableNotice='Saqlangan ma’lumot o‘qilmadi — nusxasi alohida saqlandi, ilova toza holatda ochildi.'
  else unreadableNotice='Saqlangan ma’lumot o‘qilmadi va nusxasini saqlab bo‘lmadi — Tizim → Backup import orqali tiklang.'
  return null
}

/** Set when hydrate upgraded saved data; the provider tells the user once. */
let migrationNotice=''

/** Runs pending schema migrations; the pre-upgrade data is kept once under MIGRATION_BACKUP_KEY. */
function upgrade(state:ManufacturingState):ManufacturingState{
  const {state:next,applied}=migrateState(state)
  if(!applied.length)return state
  const kept=storage.getRaw(MIGRATION_BACKUP_KEY)!==null||storage.set(MIGRATION_BACKUP_KEY,{savedAt:stamp(new Date()),from:state.schemaVersion??3,to:SCHEMA_VERSION,state})
  migrationNotice=kept?`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi (rollar va ruxsatlar). Oldingi nusxa zaxirada saqlandi.`:`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi, lekin zaxira nusxasi saqlanmadi (brauzer xotirasi to‘la) — Tizim → Backup eksport qiling.`
  return next
}

function hydrate():ManufacturingState{
  const seed=createInitialState()
  const loaded=readStored()
  if(loaded)return upgrade(hydrateLoaded(loaded,seed))
  return hydrateFresh(seed)
}

function hydrateLoaded(loaded:Partial<ManufacturingState>,seed:ManufacturingState):ManufacturingState{
  const state=normalize(loaded,seed)
  if(storage.get(CLEAN_KEY,null))return state
  // One-time cleanup of the generated demo history this browser was initialised with. Only when every
  // transaction and added record is provably generated demo data, and only after a backup is stored;
  // anything entered in the app is left alone (Tizim → "Tranzaksiyalarni tozalash" is the manual path).
  const hasHistory=TRANSACTION_KEYS.some(key=>(loaded[key] as unknown[]|undefined)?.length)
  if(hasHistory&&holdsOnlyDemoRecords(loaded)){
    if(!storage.set(BACKUP_KEY,{savedAt:stamp(new Date()),reason:'demo-history-cleanup',state:loaded}))return state
    const clean=clearTransactions(state)
    // Persist now: StrictMode runs this initialiser twice and the second run must read the clean data.
    if(!storage.set(STORAGE_KEY,clean))return state
    storage.set(CLEAN_KEY,stamp(new Date()))
    return clean
  }
  storage.set(CLEAN_KEY,stamp(new Date()))
  return state
}

function hydrateFresh(seed:ManufacturingState):ManufacturingState{
  // First run on the v3 model: keep the person's appearance preferences from the previous version.
  const legacy=storage.get<{settings?:Partial<SettingsState>}|null>(LEGACY_KEY,null)
  if(legacy?.settings){seed.settings={...seed.settings,...pickUi(legacy.settings)};storage.remove(LEGACY_KEY)}
  storage.set(CLEAN_KEY,stamp(new Date()))
  return seed
}

export function AppProvider({children}:{children:ReactNode}){
  const [state,setState]=useState<ManufacturingState>(hydrate)
  const stateRef=useRef(state)
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches??false)
  const [toasts,setToasts]=useState<Toast[]>([])
  const [sidebarMobile,setSidebarMobile]=useState(false),[searchOpen,setSearchOpen]=useState(false),[notifOpen,setNotifOpen]=useState(false),[aiOpen,setAiOpen]=useState(false)
  const [auth,setAuth]=useState<AuthStore>(()=>Auth.normalizeAuthStore(storage.get(AUTH_KEY,null)))
  const authRef=useRef(auth)
  const [session,setSession]=useState<Session|null>(()=>storage.get<Session|null>(SESSION_KEY,null))
  const sessionRef=useRef(session)
  const [authNotice,setAuthNotice]=useState('')
  const storageWarned=useRef(false)
  /** The stored copy shared with other tabs: read before every action, written right after it (BUG-14). */
  const slot=useRef(createSyncedSlot<ManufacturingState>(storage,STORAGE_KEY,raw=>{
    const loaded=JSON.parse(raw) as Partial<ManufacturingState>
    return loaded&&Array.isArray(loaded.productionOrders)?migrateState(normalize(loaded,createInitialState())).state:null
  },storage.getRaw(STORAGE_KEY))).current

  const persist=(value:ManufacturingState)=>{
    if(slot.write(value)!=='failed')return
    if(!storageWarned.current){
      storageWarned.current=true
      pushToast('Brauzer xotirasi to‘ldi — oxirgi o‘zgarishlar saqlanmadi. Katta hujjatlarni o‘chiring yoki Tizim → Eksport qiling.','danger')
    }
  }

  useEffect(()=>{
    const timer=window.setTimeout(()=>persist(state),250)
    return()=>window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state])
  useEffect(()=>{
    // Closing or hiding the tab within the save delay must not lose the last action (BUG-14).
    const flush=()=>persist(stateRef.current)
    const hidden=()=>{if(document.visibilityState==='hidden')flush()}
    window.addEventListener('pagehide',flush)
    document.addEventListener('visibilitychange',hidden)
    // Another tab saved: continue from its data instead of overwriting it with this tab's older copy (BUG-14).
    const synced=(e:StorageEvent)=>{
      if(e.key!==STORAGE_KEY)return
      const next=slot.receive(e.newValue)
      if(next){stateRef.current=next;setState(next)}
    }
    window.addEventListener('storage',synced)
    if(unreadableNotice){pushToast(unreadableNotice,'danger');unreadableNotice=''}
    if(migrationNotice){pushToast(migrationNotice,'info');migrationNotice=''}
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('storage',synced)}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  useEffect(()=>{const mq=window.matchMedia?.('(prefers-color-scheme: dark)');if(!mq)return;const fn=(e:MediaQueryListEvent)=>setSystemDark(e.matches);mq.addEventListener?.('change',fn);return()=>mq.removeEventListener?.('change',fn)},[])

  // Presentation-only: money()/compactMoney() read this before any page renders in this pass.
  setDisplayCurrency(state.settings.currency||'UZS')
  const resolvedTheme:'light'|'dark'=state.settings.theme==='system'?(systemDark?'dark':'light'):state.settings.theme
  const appearance=pairFor(state.settings.appearance,resolvedTheme)
  useEffect(()=>{
    const root=document.documentElement
    root.dataset.theme=resolvedTheme
    root.dataset.bg=appearance.id
    root.dataset.fontSize=state.settings.fontSize
    root.style.setProperty('--accent',appearance.accent)
    root.style.colorScheme=resolvedTheme
    root.classList.toggle('reduced-motion',state.settings.reducedMotion)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolvedTheme==='dark'?'#0b1220':'#f4f7fb')
  },[resolvedTheme,appearance.id,appearance.accent,state.settings.fontSize,state.settings.reducedMotion])

  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true)}}
    window.addEventListener('keydown',key)
    return()=>window.removeEventListener('keydown',key)
  },[])

  // Identity comes only from the signed-in session, never from the business data (A-C3).
  const currentEmployee=(session&&state.employees.find(x=>x.id===session.employeeId))||NOBODY
  const currentRole=(session&&roleOf(state,currentEmployee.id))||NO_ROLE
  const can=useCallback((module:string,action:PermissionAction='view')=>Boolean(session)&&hasPermission(currentRole,module,action),[currentRole,session])

  function pushToast(message:string,tone:ToastTone='success'){
    const id=uid('toast')
    setToasts(x=>[...x.slice(-3),{id,message,tone}])
    window.setTimeout(()=>setToasts(x=>x.filter(t=>t.id!==id)),tone==='danger'||tone==='warning'?6000:3800)
  }
  const toast=useCallback(pushToast,[])
  const dismissToast=useCallback((id:string)=>setToasts(x=>x.filter(t=>t.id!==id)),[])

  const archiveWarned=useRef(false)
  const commit=(value:ManufacturingState)=>{
    if(value===stateRef.current)return
    let next=value
    // Older activity moves to its own archive key; if that write fails it stays in the data, never dropped (BUG-07).
    const split=A.splitActivityOverflow(next)
    if(split.overflow.length){
      const archive=storage.get<ManufacturingState['activity']>(ACTIVITY_ARCHIVE_KEY,[])
      const ids=new Set(archive.map(a=>a.id))
      if(storage.set(ACTIVITY_ARCHIVE_KEY,[...split.overflow.filter(a=>!ids.has(a.id)),...archive]))next=split.state
      else if(!archiveWarned.current){archiveWarned.current=true;pushToast('Faoliyat arxivi saqlanmadi (brauzer xotirasi to‘la) — Admin Panel → Audit jurnalidan CSV eksport qiling','warning')}
    }
    stateRef.current=next;setState(next)
  }
  const activityArchive=()=>storage.get<ManufacturingState['activity']>(ACTIVITY_ARCHIVE_KEY,[])
  const me=()=>sessionRef.current?.employeeId||''
  const actor=()=>stateRef.current.employees.find(e=>e.id===me())
  const makeCtx=():Ctx=>({now:new Date(),user:actor()||NOBODY,id:uid})
  const allowed=(rules:Rules|undefined)=>Boolean(sessionRef.current)&&allowedBy(roleOf(stateRef.current,me()),rules)
  const execute=(name:string,fn:(s:ManufacturingState,ctx:Ctx)=>Outcome,rules?:Rules,silentSuccess=false):ActionResult=>{
    if(!sessionRef.current){const message='Avval tizimga kiring';pushToast(message,'danger');return {ok:false,message}}
    if(!allowed(rules)){const message='Rolingizda bu amal uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    // Continue from another tab's newer save, so this action cannot overwrite what it did (BUG-14).
    const base=slot.latest(stateRef.current)
    if(base.changed){stateRef.current=base.state;setState(base.state)}
    let out:Outcome
    try{out=fn(stateRef.current,makeCtx())}catch(error){console.error(`[${name}]`,error);const message=error instanceof A.StockError?error.message:'Kutilmagan xatolik — amal bajarilmadi';pushToast(message,'danger');return {ok:false,message}}
    // Whatever the action, at least one Super Admin must still be able to sign in (A-H2), checked with the accounts too.
    if(out.result.ok&&!Auth.superAdminInvariant(authRef.current,out.state)){const message='Bu amal oxirgi faol Super Admin kirish huquqini olib qo‘yadi — bajarilmadi';pushToast(message,'danger');return {ok:false,message}}
    commit(out.state)
    // Saved at once rather than after the debounce: a tab closed or another tab acting right after cannot lose it.
    if(out.result.ok)persist(out.state)
    if(!out.result.ok||!silentSuccess)pushToast(out.result.message,out.result.ok?'success':'warning')
    return out.result
  }

  // Every domain action is checked against its rule for these exact arguments (e.g. running vs cancelling an order).
  // The role's scope (own work center / branch) is checked on the same call, against the data it touches (A-H6).
  const domain=Object.fromEntries(Object.entries(DOMAIN_ACTIONS).map(([name,fn])=>[name,(...args:unknown[])=>execute(name,(s,ctx)=>{
    const outside=scopeBlocker(s,ctx.user,name,args)
    return outside?{state:s,result:{ok:false,message:outside}}:(fn as (s:ManufacturingState,ctx:Ctx,...a:unknown[])=>Outcome)(s,ctx,...args)
  },actionRules(name,args)??[['__unlisted__','view']])])) as unknown as DomainApi

  const rulesFor=(key:EntityKey,action:PermissionAction,patch?:Record<string,unknown>):Rules=>{
    // Giving someone a role or blocking them is user administration: it needs users.edit on top of the HR record right.
    if(key==='employees'&&patch&&(patch.roleId!==undefined||patch.status==='Arxiv'))return [['users','edit']]
    return entityRules(key as EntityKeyName,action)
  }
  const createEntity=(key:EntityKey,payload:Record<string,unknown>)=>execute('createEntity',(s,ctx)=>A.createEntity(s,ctx,key,payload,ENTITY_LABEL[key]),rulesFor(key,'create'))
  const updateEntity=(key:EntityKey,id:string,patch:Record<string,unknown>)=>{
    const before=(stateRef.current[key] as unknown as Record<string,unknown>[]).find(x=>x.id===id)
    const changes=Object.fromEntries(Object.entries(patch).filter(([k,v])=>before?.[k]!==v))
    return execute('updateEntity',(s,ctx)=>A.updateEntity(s,ctx,key,id,patch,ENTITY_LABEL[key]),rulesFor(key,'edit',changes))
  }
  const deleteEntity=(key:EntityKey,id:string)=>execute('deleteEntity',(s,ctx)=>A.deleteEntity(s,ctx,key,id,ENTITY_LABEL[key]),key==='employees'?[['users','delete']]:rulesFor(key,'delete'))
  const duplicateEntity=(key:EntityKey,id:string)=>execute('duplicateEntity',(s,ctx)=>A.duplicateEntity(s,ctx,key,id,ENTITY_LABEL[key]),rulesFor(key,'create'))

  const saveSupplier=(p:Parameters<typeof A.saveSupplier>[2])=>execute('saveSupplier',(s,ctx)=>A.saveSupplier(s,ctx,p),[['purchases',p.id?'edit':'create']])
  const addAttachment=(a:Parameters<typeof A.addAttachment>[2])=>{const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('addAttachment',(s,ctx)=>A.addAttachment(s,ctx,a),[[module,'edit']])}
  const removeAttachment=(id:string)=>{const a=stateRef.current.attachments.find(x=>x.id===id);if(!a){const message='Hujjat topilmadi';pushToast(message,'warning');return {ok:false,message}}const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('removeAttachment',(s,ctx)=>A.removeAttachment(s,ctx,id),[[module,'edit']])}

  const setPreferences=(patch:Partial<UiPreferences>)=>commit({...stateRef.current,settings:{...stateRef.current.settings,...patch}})
  const saveSettings=(patch:Partial<SettingsState>)=>{
    const businessChange=Object.keys(patch).some(k=>!UI_KEYS.includes(k as keyof UiPreferences))
    if(businessChange&&!allowed([['settings','edit']])){pushToast('Sozlamalarni o‘zgartirish uchun ruxsat yo‘q','danger');return}
    const s=stateRef.current
    const next={...s,settings:{...s.settings,...patch}}
    commit(businessChange?A.logActivity(next,makeCtx(),'Sozlamani o‘zgartirdi','Sozlamalar',Object.keys(patch).join(', ')):next)
    if(businessChange)pushToast('Sozlamalar saqlandi')
  }
  const setTheme=(theme:ThemeMode)=>setPreferences({theme})
  const setAppearance=(family:AppearanceFamily)=>setPreferences({appearance:family})
  const setCurrency=(currency:CurrencyCode)=>setPreferences({currency})
  const resetTransactions=():ActionResult=>{
    if(!allowed([['settings','edit']])){const message='Ma’lumotlarni tozalash uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    if(!storage.set(BACKUP_KEY,{savedAt:stamp(new Date()),reason:'manual-reset',state:stateRef.current})){
      const message='Backup saqlanmadi (brauzer xotirasi to‘la) — avval Backup eksport qiling';pushToast(message,'danger');return {ok:false,message}
    }
    commit(clearTransactions(stateRef.current));persist(stateRef.current)
    const message='Tranzaksiyalar tozalandi — master ma’lumotlar va sozlamalar saqlandi'
    pushToast(message,'info')
    return {ok:true,message}
  }
  /** Replaces all data with a backup. Permission-checked here, not only in the UI; the current data is kept as the undo copy (BUG-14). */
  const replaceAll=(data:unknown,reason:string):ActionResult=>{
    if(!allowed([['settings','edit']])){const message='Backup tiklash uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    const shape=data as Partial<ManufacturingState>|null
    const arrays:(keyof ManufacturingState)[]=['productionOrders','stockBalances','products','rawMaterials','warehouses','employees','roles']
    if(!shape||typeof shape!=='object'||arrays.some(k=>!Array.isArray(shape[k]))||!(shape.employees||[]).length||!(shape.roles||[]).length){
      const message='Fayl ZENIX backup formatiga mos emas';pushToast(message,'danger');return {ok:false,message}
    }
    if(!storage.set(BACKUP_KEY,{savedAt:stamp(new Date()),reason,state:stateRef.current})){
      const message='Joriy ma’lumot zaxiralanmadi (brauzer xotirasi to‘la) — avval Backup eksport qiling';pushToast(message,'danger');return {ok:false,message}
    }
    // A backup from an older version is upgraded the same way as stored data.
    const next=migrateState(normalize(shape,createInitialState())).state
    // Accounts are not in the backup: the restored data must still contain a Super Admin who can sign in (A-H3).
    if(!Auth.superAdminInvariant(authRef.current,next)){
      const message='Bu backup’da hozirgi Super Admin akkauntiga mos xodim yo‘q — tiklansa hech kim boshqara olmaydi. Import bekor qilindi.';pushToast(message,'danger');return {ok:false,message}
    }
    commit(A.logActivity(next,makeCtx(),'Backup tiklandi','Tizim',reason,'warning'));persist(stateRef.current)
    pushToast('Backup tiklandi — oldingi ma’lumot zaxirada saqlandi','success')
    return {ok:true,message:'Backup tiklandi'}
  }
  const importState=(data:unknown)=>replaceAll(data,'before-import')
  const lastBackup=()=>storage.get<{savedAt?:string;reason?:string;state?:unknown}|null>(BACKUP_KEY,null)
  const restoreLastBackup=():ActionResult=>{
    const backup=lastBackup()
    if(!backup?.state){const message='Tiklanadigan zaxira topilmadi';pushToast(message,'warning');return {ok:false,message}}
    return replaceAll(backup.state,'before-restore')
  }
  // Read state is per person: one user reading a notification does not hide it from the others (A-M5).
  const markRead=(n:ManufacturingState['notifications'][number])=>n.readBy?.includes(me())?n:{...n,readBy:[...(n.readBy||[]),me()]}
  const markAllRead=()=>commit({...stateRef.current,notifications:stateRef.current.notifications.map(markRead)})
  const markNotificationRead=(id:string)=>commit({...stateRef.current,notifications:stateRef.current.notifications.map(n=>n.id===id?markRead(n):n)})

  /* ------------------------------------------------------------ sign-in, sessions and accounts -- */

  const authCtx=():Auth.AuthCtx=>({now:new Date(),actor:actor(),id:uid})
  const commitAuth=(next:AuthStore)=>{authRef.current=next;setAuth(next);if(!storage.set(AUTH_KEY,next))pushToast('Akkaunt ma’lumotlari saqlanmadi (brauzer xotirasi to‘la)','danger')}
  const commitSession=(next:Session|null)=>{sessionRef.current=next;setSession(next);if(next)storage.set(SESSION_KEY,next);else storage.remove(SESSION_KEY)}
  const authResult=(out:AuthOutcome,silent=false):ActionResult=>{
    if(out.error!==undefined){pushToast(out.error,'warning');return {ok:false,message:out.error}}
    if(out.state&&out.state!==stateRef.current)commit(out.state)
    commitAuth(out.store)
    if(!silent)pushToast(out.message)
    return {ok:true,message:out.message,id:out.id}
  }
  const needs=(rules:Rules):string|null=>allowed(rules)?null:'Rolingizda bu amal uchun ruxsat yo‘q'

  const logout=(reason:SessionProblem|'logout'='logout')=>{
    const current=sessionRef.current
    if(current){
      const type=reason==='expired'?'session_expired':reason==='idle'?'session_idle':'logout'
      commitAuth(Auth.logAuth(authRef.current,authCtx(),{type,accountId:current.accountId,login:authRef.current.accounts.find(a=>a.id===current.accountId)?.username,detail:reason==='blocked'?'akkaunt bloklangan':reason==='credentials'?'parol o‘zgargan':''}))
    }
    commitSession(null)
    setAuthNotice(NOTICE[reason]||'')
  }

  const login=async(loginName:string,password:string,remember:boolean):Promise<ActionResult>=>{
    const fail=(message:string):ActionResult=>({ok:false,message})
    if(!loginName.trim()||!password)return fail('Login va parolni kiriting')
    const locked=Auth.lockState(authRef.current,loginName,new Date())
    if(locked)return fail(`Juda ko‘p noto‘g‘ri urinish — ${hhmm(new Date(locked))} dan keyin qayta urinib ko‘ring`)
    const account=Auth.findAccount(authRef.current,loginName)
    // An unknown login costs the same hashing time as a known one, so the two cannot be told apart.
    const valid=account?await verifyPassword(password,account):(await hashPassword(password,randomSalt(),PBKDF2_ITERATIONS),false)
    if(!valid||!account){commitAuth(Auth.recordFailure(authRef.current,{now:new Date(),id:uid},loginName,account));return fail('Login yoki parol noto‘g‘ri')}
    const blocked=Auth.signInBlocker(stateRef.current,account)
    if(blocked){commitAuth(Auth.logAuth(authRef.current,{now:new Date(),id:uid},{type:'login_failed',accountId:account.id,login:account.username,detail:blocked}));return fail(blocked)}
    const employee=stateRef.current.employees.find(e=>e.id===account.employeeId)
    const done=Auth.recordSuccess(authRef.current,{now:new Date(),id:uid,actor:employee},account,remember)
    commitAuth(done.store);commitSession(done.session);setAuthNotice('')
    return {ok:true,message:`Xush kelibsiz, ${employee?.name||account.username}`}
  }

  const setupSuperAdmin=async(p:{employeeId:string;username:string;email?:string;password:string}):Promise<ActionResult>=>{
    if(authRef.current.accounts.length)return {ok:false,message:'Tizim allaqachon sozlangan'}
    const weak=Auth.validatePassword(authRef.current.policy,p.password)
    if(weak)return {ok:false,message:weak}
    const out=Auth.setupFirstAdmin(authRef.current,stateRef.current,{now:new Date(),id:uid},{employeeId:p.employeeId,username:p.username,email:p.email,credential:await makeCredential(p.password)})
    if(out.error!==undefined)return {ok:false,message:out.error}
    if(out.state)commit(A.logActivity(out.state,{now:new Date(),user:out.state.employees.find(e=>e.id===p.employeeId)||NOBODY,id:uid},'Super Admin tayinlandi','Foydalanuvchilar',p.username,'warning'))
    commitAuth(out.store)
    const account=out.store.accounts[0]
    const done=Auth.recordSuccess(out.store,{now:new Date(),id:uid},account,false)
    commitAuth(done.store);commitSession(done.session)
    return {ok:true,message:out.message}
  }

  const changePassword=async(current:string,next:string):Promise<ActionResult>=>{
    const account=authRef.current.accounts.find(a=>a.id===sessionRef.current?.accountId)
    if(!account)return {ok:false,message:'Avval tizimga kiring'}
    if(!await verifyPassword(current,account))return {ok:false,message:'Joriy parol noto‘g‘ri'}
    if(current===next)return {ok:false,message:'Yangi parol eskisidan farq qilsin'}
    const weak=Auth.validatePassword(authRef.current.policy,next)
    if(weak)return {ok:false,message:weak}
    const out=authResult(Auth.changeOwnPassword(authRef.current,authCtx(),account.id,await makeCredential(next)))
    // Older sessions end with the old password; this one continues under the new one.
    if(out.ok&&sessionRef.current)commitSession({...sessionRef.current,startedAt:new Date().toISOString(),lastActivity:new Date().toISOString()})
    return out
  }

  const createUser=async(p:{employeeId:string;username:string;email?:string;password:string;mustChangePassword?:boolean}):Promise<ActionResult>=>{
    const denied=needs([['users','create']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    const weak=Auth.validatePassword(authRef.current.policy,p.password);if(weak)return {ok:false,message:weak}
    return authResult(Auth.createAccount(authRef.current,stateRef.current,authCtx(),{employeeId:p.employeeId,username:p.username,email:p.email,mustChangePassword:p.mustChangePassword,credential:await makeCredential(p.password)}))
  }
  const updateUser=(accountId:string,patch:{username?:string;email?:string})=>{
    const self=authRef.current.accounts.find(a=>a.id===accountId)?.employeeId===me()
    const denied=self?null:needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    return authResult(Auth.updateAccount(authRef.current,stateRef.current,authCtx(),accountId,patch))
  }
  const setUserStatus=(accountId:string,status:Account['status'])=>{
    const denied=needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    return authResult(Auth.setAccountStatus(authRef.current,stateRef.current,authCtx(),accountId,status))
  }
  const resetUserPassword=async(accountId:string,password:string):Promise<ActionResult>=>{
    const denied=needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    const weak=Auth.validatePassword(authRef.current.policy,password);if(weak)return {ok:false,message:weak}
    return authResult(Auth.resetPassword(authRef.current,stateRef.current,authCtx(),accountId,await makeCredential(password)))
  }
  const deleteUser=(accountId:string)=>{
    const denied=needs([['users','delete']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    return authResult(Auth.deleteAccount(authRef.current,stateRef.current,authCtx(),accountId))
  }
  const updateSecurityPolicy=(patch:Partial<SecurityPolicy>)=>{
    const denied=needs([['settings','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    return authResult(Auth.updatePolicy(authRef.current,authCtx(),patch))
  }

  // A session ends when it expires, sits idle too long, or its account/employee is blocked — checked on a timer and on every change.
  useEffect(()=>{
    const check=()=>{
      const current=sessionRef.current
      if(!current)return
      const problem=Auth.sessionProblem(current,authRef.current,stateRef.current,new Date())
      if(problem)logout(problem)
    }
    check()
    const timer=window.setInterval(check,15000)
    return()=>window.clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[auth,state,session?.id])
  useEffect(()=>{
    // Activity keeps a session alive; written at most every 30 s.
    const touch=()=>{
      const current=sessionRef.current
      if(!current)return
      const now=new Date()
      if(now.getTime()-new Date(current.lastActivity).getTime()<30000)return
      commitSession({...current,lastActivity:now.toISOString()})
    }
    const events=['pointerdown','keydown','wheel','touchstart'] as const
    for(const e of events)window.addEventListener(e,touch,{passive:true})
    // Accounts and the session are shared by all tabs of this browser.
    const synced=(e:StorageEvent)=>{
      if(e.key===AUTH_KEY){const next=Auth.normalizeAuthStore(e.newValue?JSON.parse(e.newValue):null);authRef.current=next;setAuth(next)}
      if(e.key===SESSION_KEY){
        const next=e.newValue?JSON.parse(e.newValue) as Session:null
        if(!next&&sessionRef.current){sessionRef.current=null;setSession(null);setAuthNotice(NOTICE.elsewhere)}
        else if(next){sessionRef.current=next;setSession(next)}
      }
    }
    window.addEventListener('storage',synced)
    return()=>{for(const e of events)window.removeEventListener(e,touch);window.removeEventListener('storage',synced)}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  const account=session?auth.accounts.find(a=>a.id===session.accountId)||null:null
  const authInfo=useMemo(()=>({needsSetup:!auth.accounts.length,signedIn:Boolean(session&&account),session,account,accounts:auth.accounts,events:auth.events,policy:auth.policy,notice:authNotice}),[auth,session,account,authNotice])

  const value=useMemo<AppContextValue>(()=>({
    ...domain,state,resolvedTheme,toasts,dismissToast,sidebarMobile,setSidebarMobile,searchOpen,setSearchOpen,notifOpen,setNotifOpen,aiOpen,setAiOpen,
    currentEmployee,currentRole,can,toast,saveSettings,setPreferences,setTheme,setAppearance,setCurrency,resetTransactions,importState,restoreLastBackup,lastBackup,markAllRead,markNotificationRead,activityArchive,
    createEntity,updateEntity,deleteEntity,duplicateEntity,addAttachment,removeAttachment,saveSupplier,
    auth:authInfo,login,logout,clearAuthNotice:()=>setAuthNotice(''),setupSuperAdmin,changePassword,createUser,updateUser,setUserStatus,resetUserPassword,deleteUser,updateSecurityPolicy,
  // Actions read the latest state through stateRef, so re-creating them only when state changes is sufficient.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[state,resolvedTheme,toasts,sidebarMobile,searchOpen,notifOpen,aiOpen,currentEmployee,currentRole,can,toast,dismissToast,authInfo])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(){const v=useContext(Ctx);if(!v)throw new Error('useApp must be inside AppProvider');return v}
