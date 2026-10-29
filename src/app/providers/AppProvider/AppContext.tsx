import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {createInitialState} from '../../../data/mockData'
import {storage} from '../../../shared/lib/storage'
import {createSyncedSlot} from '../../../shared/lib/syncedState'
import type {WriteResult} from '../../../shared/lib/syncedState'
import {applyAppearance,normalizePrefs,resolveTheme} from '../../theme/preferences'
import * as A from '../../../domain/actions'
import type {Ctx,EntityKey,Outcome} from '../../../domain/actions'
import type {ActionResult,AppearanceFamily,CurrencyCode,Employee,ManufacturingState,PermissionAction,Role,SettingsState,ThemeMode} from '../../../types'
import {setDisplayCurrency} from '../../../utils/format'
import {clearTransactions,holdsOnlyDemoRecords,TRANSACTION_KEYS} from '../../../domain/reset'
import {recordZoneChange,setTimeZone,setZoneHistory,stamp} from '../../../utils/dates'
import {scanNotifications} from '../../../domain/notifications'
import {actionRules,allowedBy,commandBlocker,entityRules,hasPermission,roleOf,scopeBlocker,scopedView} from '../../../domain/access'
import {SCHEMA_VERSION} from '../../../domain/migrations'
import {changedRecords,describeReport,isNewerSchemaText,looksLikeState,newerSchema,prepareStored,strictStringify} from '../../../domain/persistence'
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
/** Copy of the data as it was before an upgrade to version N (one per target version, so a later upgrade keeps its own copy). */
const migrationBackupKey=(version:number)=>`zenix-manufacturing-before-v${version}`
const MIGRATION_BACKUP_KEY=migrationBackupKey(SCHEMA_VERSION)
/** The stored text as it was before load-time repair set aside or completed broken records (latest repair). */
const REPAIR_KEY='zenix-manufacturing-v3-before-repair'
/** Accounts, password hashes, sign-in policy and the security log — never part of the business data, a backup or a reset. */
const AUTH_KEY='zenix-auth-v1'
/** The signed-in session of this browser, shared by its tabs (signing out in one tab signs out all). */
const SESSION_KEY='zenix-session-v1'
/** Activity older than the newest ACTIVITY_LIMIT entries (BUG-07); read by the audit log, not part of backups of the working data. */
const ACTIVITY_ARCHIVE_KEY='zenix-activity-archive-v1'
const uid=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
const parseJson=(raw:string|null):unknown=>{if(!raw)return null;try{return JSON.parse(raw)}catch{return null}}

export type ToastTone='success'|'warning'|'danger'|'info'
export type Toast={id:string;message:string;tone:ToastTone}
export type UiPreferences=Pick<SettingsState,'theme'|'appearance'|'currency'|'fontSize'|'reducedMotion'|'uiDensity'|'tableDensity'>
export type {EntityKey}
/**
 * Stored business data that could not be opened: nothing is written over it until the user chooses what to do.
 * 'newer': saved by a newer version of the app (`version`) — this build only offers export and reload (audit #8).
 */
export type Recovery={reason:'unreadable'|'crashed'|'newer';raw:string;version?:number}
/** A copy kept aside by the app (unreadable data, pre-upgrade or pre-repair data) that the user can download. */
export type RecoveryCopy={key:string;label:string;savedAt?:string;text:string}

const UI_KEYS:(keyof UiPreferences)[]=['theme','appearance','currency','fontSize','reducedMotion','uiDensity','tableDensity']
const pickUi=(settings:Partial<SettingsState>|undefined)=>Object.fromEntries(UI_KEYS.filter(k=>settings?.[k]!==undefined).map(k=>[k,settings![k]])) as Partial<UiPreferences>

// Module permissions per action live in domain/access.ts (ACTION_RULES), where they are unit-tested.
const ENTITY_LABEL:Record<EntityKey,string>={products:'Mahsulot',rawMaterials:'Xomashyo',suppliers:'Supplier',customers:'Mijoz',employees:'Xodim',expenses:'Xarajat',qualityAlerts:'Quality alert',maintenanceOrders:'Maintenance',engineeringChanges:'ECO',qualityControlPoints:'Control point',maintenanceRequests:'Maintenance request',subcontractOrders:'Subcontract',repairOrders:'Repair order',warehouses:'Ombor',workCenters:'Work center',productionLines:'Liniya',equipment:'Uskuna',branches:'Filial'}
const ATTACHMENT_MODULE:Record<string,string>={product:'products',bom:'products',eco:'products',material:'materials',purchase:'purchases',supplier:'purchases',production:'production',sales:'sales',customer:'sales',equipment:'equipment',quality:'quality'}

type Bound<F>=F extends (s:ManufacturingState,ctx:Ctx,...args:infer P)=>Outcome?(...args:P)=>ActionResult:never
type DomainApi={
  createProductionOrder:Bound<typeof A.createProductionOrder>;updateProductionOrder:Bound<typeof A.updateProductionOrder>;transitionProduction:Bound<typeof A.transitionProduction>;shortCloseProduction:Bound<typeof A.shortCloseProduction>;reportOutput:Bound<typeof A.reportOutput>;recordScrap:Bound<typeof A.recordScrap>;
  splitProduction:Bound<typeof A.splitProduction>;mergeProduction:Bound<typeof A.mergeProduction>;createBackorder:Bound<typeof A.createBackorder>;unbuildProduct:Bound<typeof A.unbuildProduct>;issueExtraMaterial:Bound<typeof A.issueExtraMaterial>;checkAvailability:Bound<typeof A.checkAvailability>;refreshMaterialReservation:Bound<typeof A.refreshMaterialReservation>;
  startWorkOrder:Bound<typeof A.startWorkOrder>;pauseWorkOrder:Bound<typeof A.pauseWorkOrder>;finishWorkOrder:Bound<typeof A.finishWorkOrder>;markSetupDone:Bound<typeof A.markSetupDone>;reportOperationOutput:Bound<typeof A.reportOperationOutput>;assignWorkOrder:Bound<typeof A.assignWorkOrder>;rescheduleProductionOrder:Bound<typeof A.rescheduleProductionOrder>;confirmMrpSuggestion:Bound<typeof A.confirmMrpSuggestion>;setForecast:Bound<typeof A.setForecast>;recordMaterialScan:Bound<typeof A.recordMaterialScan>;rollUpCosts:Bound<typeof A.rollUpCosts>;createReworkOrder:Bound<typeof A.createReworkOrder>;
  createQualityCheck:Bound<typeof A.createQualityCheck>;resolveQuality:Bound<typeof A.resolveQuality>;createQualityAlert:Bound<typeof A.createQualityAlert>;
  createPurchaseOrder:Bound<typeof A.createPurchaseOrder>;createPurchaseOrders:Bound<typeof A.createPurchaseOrders>;linkSupplierMaterial:Bound<typeof A.linkSupplierMaterial>;updateSupplierMaterial:Bound<typeof A.updateSupplierMaterial>;removeSupplierMaterial:Bound<typeof A.removeSupplierMaterial>;setPreferredSupplier:Bound<typeof A.setPreferredSupplier>;saveSupplier:(p:Parameters<typeof A.saveSupplier>[2])=>ActionResult;confirmPurchase:Bound<typeof A.confirmPurchase>;markPurchaseInTransit:Bound<typeof A.markPurchaseInTransit>;cancelPurchase:Bound<typeof A.cancelPurchase>;closePurchaseShort:Bound<typeof A.closePurchaseShort>;updatePurchaseMeta:Bound<typeof A.updatePurchaseMeta>;receivePurchase:Bound<typeof A.receivePurchase>;returnPurchaseToSupplier:Bound<typeof A.returnPurchaseToSupplier>;updatePurchaseDraft:Bound<typeof A.updatePurchaseDraft>;inspectReceipt:Bound<typeof A.inspectReceipt>;scrapRejectedReceipt:Bound<typeof A.scrapRejectedReceipt>;advanceSubcontract:Bound<typeof A.advanceSubcontract>;
  createSalesOrder:Bound<typeof A.createSalesOrder>;reserveSalesOrder:Bound<typeof A.reserveSalesOrder>;deliverSalesOrder:Bound<typeof A.deliverSalesOrder>;resolveReturnCredit:Bound<typeof A.resolveReturnCredit>;requestSupplierReplacement:Bound<typeof A.requestSupplierReplacement>;receiveSupplierReplacement:Bound<typeof A.receiveSupplierReplacement>;closeSupplierReplacement:Bound<typeof A.closeSupplierReplacement>;cancelSalesOrder:Bound<typeof A.cancelSalesOrder>;updateSalesMeta:Bound<typeof A.updateSalesMeta>;recordCustomerPayment:Bound<typeof A.recordCustomerPayment>;adjustCustomerBalance:Bound<typeof A.adjustCustomerBalance>;createReturn:Bound<typeof A.createReturn>;dispositionReturn:Bound<typeof A.dispositionReturn>;
  transferStock:Bound<typeof A.transferStock>;adjustStock:Bound<typeof A.adjustStock>;countStock:Bound<typeof A.countStock>;
  moveStockBin:Bound<typeof A.moveStockBin>;assignVariantStock:Bound<typeof A.assignVariantStock>;setVariantStock:Bound<typeof A.setVariantStock>;allocateLegacyLots:Bound<typeof A.allocateLegacyLots>;
  startDowntime:Bound<typeof A.startDowntime>;endDowntime:Bound<typeof A.endDowntime>;approveMaintenanceRequest:Bound<typeof A.approveMaintenanceRequest>;startMaintenance:Bound<typeof A.startMaintenance>;completeMaintenance:Bound<typeof A.completeMaintenance>;cancelMaintenance:Bound<typeof A.cancelMaintenance>;planPreventiveMaintenance:Bound<typeof A.planPreventiveMaintenance>;advanceRepair:Bound<typeof A.advanceRepair>;createMaintenanceOrder:Bound<typeof A.createMaintenanceOrder>;updateMaintenanceOrder:Bound<typeof A.updateMaintenanceOrder>;saveMaintenancePlan:Bound<typeof A.saveMaintenancePlan>;recordEquipmentRuntime:Bound<typeof A.recordEquipmentRuntime>;
  createBomDraft:Bound<typeof A.createBomDraft>;saveBom:Bound<typeof A.saveBom>;deleteBomDraft:Bound<typeof A.deleteBomDraft>;activateBom:Bound<typeof A.activateBom>;createEngineeringChange:Bound<typeof A.createEngineeringChange>;setEcoStatus:Bound<typeof A.setEcoStatus>;applyEngineeringChange:Bound<typeof A.applyEngineeringChange>;cancelEngineeringChange:Bound<typeof A.cancelEngineeringChange>;archiveBom:Bound<typeof A.archiveBom>;saveRouting:Bound<typeof A.saveRouting>;copyRouting:Bound<typeof A.copyRouting>;saveVariant:Bound<typeof A.saveVariant>;
  updateRolePermission:Bound<typeof A.updateRolePermission>;createRole:Bound<typeof A.createRole>;duplicateRole:Bound<typeof A.duplicateRole>;updateRole:Bound<typeof A.updateRole>;deleteRole:Bound<typeof A.deleteRole>;addAttachment:Bound<typeof A.addAttachment>;removeAttachment:Bound<typeof A.removeAttachment>;
}
const DOMAIN_ACTIONS={createProductionOrder:A.createProductionOrder,updateProductionOrder:A.updateProductionOrder,transitionProduction:A.transitionProduction,shortCloseProduction:A.shortCloseProduction,reportOutput:A.reportOutput,recordScrap:A.recordScrap,issueExtraMaterial:A.issueExtraMaterial,splitProduction:A.splitProduction,mergeProduction:A.mergeProduction,createBackorder:A.createBackorder,unbuildProduct:A.unbuildProduct,checkAvailability:A.checkAvailability,refreshMaterialReservation:A.refreshMaterialReservation,startWorkOrder:A.startWorkOrder,pauseWorkOrder:A.pauseWorkOrder,finishWorkOrder:A.finishWorkOrder,markSetupDone:A.markSetupDone,reportOperationOutput:A.reportOperationOutput,assignWorkOrder:A.assignWorkOrder,rescheduleProductionOrder:A.rescheduleProductionOrder,confirmMrpSuggestion:A.confirmMrpSuggestion,setForecast:A.setForecast,recordMaterialScan:A.recordMaterialScan,rollUpCosts:A.rollUpCosts,createReworkOrder:A.createReworkOrder,createQualityCheck:A.createQualityCheck,resolveQuality:A.resolveQuality,createQualityAlert:A.createQualityAlert,createPurchaseOrder:A.createPurchaseOrder,createPurchaseOrders:A.createPurchaseOrders,linkSupplierMaterial:A.linkSupplierMaterial,updateSupplierMaterial:A.updateSupplierMaterial,removeSupplierMaterial:A.removeSupplierMaterial,setPreferredSupplier:A.setPreferredSupplier,confirmPurchase:A.confirmPurchase,markPurchaseInTransit:A.markPurchaseInTransit,cancelPurchase:A.cancelPurchase,closePurchaseShort:A.closePurchaseShort,updatePurchaseMeta:A.updatePurchaseMeta,receivePurchase:A.receivePurchase,returnPurchaseToSupplier:A.returnPurchaseToSupplier,updatePurchaseDraft:A.updatePurchaseDraft,inspectReceipt:A.inspectReceipt,scrapRejectedReceipt:A.scrapRejectedReceipt,requestSupplierReplacement:A.requestSupplierReplacement,receiveSupplierReplacement:A.receiveSupplierReplacement,closeSupplierReplacement:A.closeSupplierReplacement,advanceSubcontract:A.advanceSubcontract,createSalesOrder:A.createSalesOrder,reserveSalesOrder:A.reserveSalesOrder,deliverSalesOrder:A.deliverSalesOrder,cancelSalesOrder:A.cancelSalesOrder,updateSalesMeta:A.updateSalesMeta,recordCustomerPayment:A.recordCustomerPayment,adjustCustomerBalance:A.adjustCustomerBalance,resolveReturnCredit:A.resolveReturnCredit,createReturn:A.createReturn,dispositionReturn:A.dispositionReturn,transferStock:A.transferStock,moveStockBin:A.moveStockBin,assignVariantStock:A.assignVariantStock,setVariantStock:A.setVariantStock,allocateLegacyLots:A.allocateLegacyLots,adjustStock:A.adjustStock,countStock:A.countStock,startDowntime:A.startDowntime,endDowntime:A.endDowntime,approveMaintenanceRequest:A.approveMaintenanceRequest,startMaintenance:A.startMaintenance,completeMaintenance:A.completeMaintenance,cancelMaintenance:A.cancelMaintenance,planPreventiveMaintenance:A.planPreventiveMaintenance,advanceRepair:A.advanceRepair,createMaintenanceOrder:A.createMaintenanceOrder,updateMaintenanceOrder:A.updateMaintenanceOrder,saveMaintenancePlan:A.saveMaintenancePlan,recordEquipmentRuntime:A.recordEquipmentRuntime,createBomDraft:A.createBomDraft,saveBom:A.saveBom,deleteBomDraft:A.deleteBomDraft,activateBom:A.activateBom,createEngineeringChange:A.createEngineeringChange,setEcoStatus:A.setEcoStatus,applyEngineeringChange:A.applyEngineeringChange,cancelEngineeringChange:A.cancelEngineeringChange,archiveBom:A.archiveBom,saveRouting:A.saveRouting,copyRouting:A.copyRouting,saveVariant:A.saveVariant,updateRolePermission:A.updateRolePermission,createRole:A.createRole,duplicateRole:A.duplicateRole,updateRole:A.updateRole,deleteRole:A.deleteRole,addAttachment:A.addAttachment,removeAttachment:A.removeAttachment} as const

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
  /** Set while stored data could not be opened (see Recovery); every save is suspended meanwhile. */
  recovery:Recovery|null;startClean:(withoutCopy?:boolean)=>ActionResult;recoveryCopies:()=>RecoveryCopy[];
  /** True while the browser refuses to save: changes live only in this tab until a save succeeds again. */
  storageError:boolean;
  /** Saved size of the business data and of everything this app keeps in the browser (characters ≈ bytes). */
  storageUsage:()=>{data:number;total:number};
  createEntity:(key:EntityKey,payload:Record<string,unknown>)=>ActionResult;updateEntity:(key:EntityKey,id:string,patch:Record<string,unknown>)=>ActionResult;deleteEntity:(key:EntityKey,id:string)=>ActionResult;duplicateEntity:(key:EntityKey,id:string)=>ActionResult;
}

const Ctx=createContext<AppContextValue|null>(null)

/** Shown while nobody is signed in: it has no role, so every permission check fails. */
const NOBODY:Employee={id:'',name:'—',roleId:'',department:'',workCenterId:'',shift:'',status:'Arxiv',attendance:0,efficiency:0,hourlyCost:0}
const hhmm=(d:Date)=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
const NO_ROLE:Role={id:'',name:'—',scope:'all',permissions:{}}
const NOTICE:Record<SessionProblem|'logout'|'elsewhere',string>={missing:'',logout:'Tizimdan chiqdingiz.',expired:'Session muddati tugadi — qayta kiring.',idle:'Uzoq vaqt harakatsizlik sababli session yopildi — qayta kiring.',blocked:'Akkauntingiz bloklangan yoki o‘zgartirilgan — administratorga murojaat qiling.',elsewhere:'Boshqa oynada tizimdan chiqildi.',credentials:'Parolingiz o‘zgartirildi — yangi parol bilan qayta kiring.'}

type Notice={text:string;tone:ToastTone}
/** `unsaved`: the stored text, kept only in memory because its copy did not fit before an upgrade or repair. */
type Boot={state:ManufacturingState;recovery:Recovery|null;notices:Notice[];unsaved?:RecoveryCopy}

/** Stored text → state (repair, new defaults, migrations); null when it is not ZENIX data at all or of a newer schema. */
const parseStored=(raw:string):ManufacturingState|null=>{
  const parsed=JSON.parse(raw) as unknown
  return looksLikeState(parsed)&&newerSchema(parsed)===undefined?prepareStored(parsed,createInitialState()).state:null
}
/** What a save did: 'suspended' while recovery mode keeps the stored data untouched. */
type SaveOutcome=WriteResult|'suspended'

/**
 * Opens the stored data. Unreadable data, or data that cannot be loaded at all, is never replaced
 * automatically: the app starts in recovery mode with saving suspended, and the user decides (BUG-14).
 * Whatever loading repairs or upgrades, the original is kept aside first.
 */
function hydrate():Boot{
  const seed=createInitialState()
  const raw=storage.getRaw(STORAGE_KEY)
  if(!raw)return {state:hydrateFresh(seed),recovery:null,notices:[]}
  let parsed:unknown
  try{parsed=JSON.parse(raw)}catch{parsed=undefined}
  if(!looksLikeState(parsed))return {state:seed,recovery:{reason:'unreadable',raw},notices:[]}
  // A newer app version saved this: loading it here would migrate it "back" and the next save would downgrade it (audit #8).
  const newer=newerSchema(parsed)
  if(newer!==undefined)return {state:seed,recovery:{reason:'newer',raw,version:newer},notices:[]}
  try{
    const {state,report}=prepareStored(parsed,seed)
    const notices:Notice[]=[]
    // A copy that does not fit (storage near quota) is kept in memory instead, and the stored original is not
    // written over by the load itself — only by the user's first change, after they were told to download it.
    let unsaved:RecoveryCopy|undefined
    const original:RecoveryCopy={key:'original',label:'Asl ma’lumot (brauzerda nusxasi saqlanmadi)',savedAt:stamp(new Date()),text:raw}
    const HELD='Asl ma’lumot o‘zgartirilmadi — birinchi o‘zgarishdan oldin uni Tizim → Tiklash nusxalari bo‘limidan yuklab oling.'
    if(changedRecords(report)&&!storage.setRaw(REPAIR_KEY,JSON.stringify({savedAt:stamp(new Date()),raw}))){unsaved=original;notices.push({text:`Tiklashdan oldingi nusxa saqlanmadi (brauzer xotirasi to‘la). ${HELD}`,tone:'danger'})}
    if(report.migrations.length){
      const kept=storage.getRaw(MIGRATION_BACKUP_KEY)!==null||storage.set(MIGRATION_BACKUP_KEY,{savedAt:stamp(new Date()),from:parsed.schemaVersion??3,to:SCHEMA_VERSION,state:parsed})
      if(!kept)unsaved=original
      notices.push(kept?{text:`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi (${report.migrations.map(m=>m.split(':')[0]).join(', ')}). Oldingi nusxa zaxirada saqlandi.`,tone:'info'}:{text:`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi, lekin zaxira nusxasi saqlanmadi (brauzer xotirasi to‘la). ${HELD}`,tone:'warning'})
    }
    const found=describeReport(report)
    if(found)notices.push({text:`Saqlangan ma’lumot tekshirildi: ${found}. Asl nusxa Tizim → Tiklash nusxalari bo‘limida.`,tone:'warning'})
    return {state:hydrateLoaded(parsed,state),recovery:null,notices,unsaved}
  }catch(error){
    console.error('Stored data could not be loaded',error)
    return {state:seed,recovery:{reason:'crashed',raw},notices:[]}
  }
}

function hydrateLoaded(loaded:Partial<ManufacturingState>,state:ManufacturingState):ManufacturingState{
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
  if(legacy?.settings){const ui={...seed.settings,...pickUi(legacy.settings)};seed.settings={...ui,...normalizePrefs(ui)};storage.remove(LEGACY_KEY)}
  storage.set(CLEAN_KEY,stamp(new Date()))
  return seed
}

export function AppProvider({children}:{children:ReactNode}){
  const [boot]=useState(hydrate)
  const [state,setState]=useState<ManufacturingState>(boot.state)
  const stateRef=useRef(state)
  const [recovery,setRecovery]=useState<Recovery|null>(boot.recovery)
  const recoveryRef=useRef(recovery)
  const [storageError,setStorageError]=useState(false)
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia?.('(prefers-color-scheme: dark)').matches??false)
  const [toasts,setToasts]=useState<Toast[]>([])
  const [sidebarMobile,setSidebarMobile]=useState(false),[searchOpen,setSearchOpen]=useState(false),[notifOpen,setNotifOpen]=useState(false),[aiOpen,setAiOpen]=useState(false)
  const [auth,setAuth]=useState<AuthStore>(()=>Auth.normalizeAuthStore(storage.get(AUTH_KEY,null)))
  const authRef=useRef(auth)
  const [session,setSession]=useState<Session|null>(()=>Auth.normalizeSession(storage.get<unknown>(SESSION_KEY,null)))
  const sessionRef=useRef(session)
  const [authNotice,setAuthNotice]=useState('')
  const storageWarned=useRef(false)
  /** The stored copy shared with other tabs: read before every action, written right after it (BUG-14). */
  // Data of a newer schema is never written over, and a value JSON cannot keep (NaN, ±Infinity) stops the save.
  const slot=useRef(createSyncedSlot<ManufacturingState>(storage,STORAGE_KEY,parseStored,storage.getRaw(STORAGE_KEY),{locked:isNewerSchemaText,stringify:strictStringify})).current

  /** Another tab of a newer app version saved: this tab stops writing and offers export / reload (audit #8). */
  const enterNewerRecovery=(raw:string)=>{
    let version:number|undefined
    try{version=newerSchema(JSON.parse(raw))}catch{version=undefined}
    const next:Recovery={reason:'newer',raw,version}
    recoveryRef.current=next;setRecovery(next)
  }

  /** Saves now; true only when the data is durably stored. Suspended in recovery mode, so unreadable data is never overwritten. */
  const persist=(value:ManufacturingState):boolean=>{const out=save(value);return out==='saved'||out==='same'}
  const save=(value:ManufacturingState):SaveOutcome=>{
    if(recoveryRef.current)return 'suspended'
    // The loaded data, unchanged, is not saved over an original that has no copy aside (see hydrate).
    if(boot.unsaved&&value===boot.state)return 'same'
    const out=slot.write(value)
    if(out==='locked'){enterNewerRecovery(storage.getRaw(STORAGE_KEY)||'');return out}
    if(out==='invalid'){
      console.error('State not saved: it holds a number JSON cannot store')
      pushToast('Ma’lumotda saqlab bo‘lmaydigan son (NaN/cheksiz) bor — o‘zgarish saqlanmadi.','danger')
      return out
    }
    if(out==='conflict'){
      // Another tab saved in between: its data wins, and this tab says what it could not keep.
      const base=slot.latest(value)
      if(base.changed){stateRef.current=base.state;setState(base.state)}
      pushToast('Boshqa oynada ma’lumot o‘zgartirildi — shu oynadagi oxirgi o‘zgarish saqlanmadi, uni qayta bajaring.','warning')
      return out
    }
    if(out!=='failed'){if(storageWarned.current){storageWarned.current=false;setStorageError(false)}return out}
    setStorageError(true)
    if(!storageWarned.current){
      storageWarned.current=true
      pushToast('Brauzer xotirasi to‘ldi — oxirgi o‘zgarishlar saqlanmadi. Katta hujjatlarni o‘chiring yoki Tizim → Eksport qiling.','danger')
    }
    return out
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
      if(isNewerSchemaText(e.newValue)){enterNewerRecovery(e.newValue!);return}
      const next=slot.receive(e.newValue)
      if(!next)return
      stateRef.current=next;setState(next)
      // Another tab saved readable data: there is nothing left to recover here.
      if(recoveryRef.current){recoveryRef.current=null;setRecovery(null)}
    }
    window.addEventListener('storage',synced)
    for(const n of boot.notices)pushToast(n.text,n.tone)
    return()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('storage',synced)}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  useEffect(()=>{const mq=window.matchMedia?.('(prefers-color-scheme: dark)');if(!mq)return;const fn=(e:MediaQueryListEvent)=>setSystemDark(e.matches);mq.addEventListener?.('change',fn);return()=>mq.removeEventListener?.('change',fn)},[])

  // Presentation-only: money()/compactMoney() read this before any page renders in this pass.
  setDisplayCurrency(state.settings.currency||'UZS')
  const resolvedTheme=resolveTheme(state.settings.theme,systemDark)
  // Theme, family, font size, densities and motion go onto <html>; tokens carry them to every page and portal.
  const prefs=normalizePrefs(state.settings),prefsKey=JSON.stringify(prefs)
  useEffect(()=>{
    applyAppearance(document.documentElement,prefs,resolvedTheme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolvedTheme==='dark'?'#111315':'#f3f4f4')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resolvedTheme,prefsKey])

  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSearchOpen(true)}}
    window.addEventListener('keydown',key)
    return()=>window.removeEventListener('keydown',key)
  },[])

  // Identity comes only from the signed-in session, never from the business data (A-C3).
  const currentEmployee=(session&&state.employees.find(x=>x.id===session.employeeId))||NOBODY
  const currentRole=(session&&roleOf(state,currentEmployee.id))||NO_ROLE
  const can=useCallback((module:string,action:PermissionAction='view')=>Boolean(session)&&hasPermission(currentRole,module,action),[currentRole,session])
  // A scoped role reads only its branch / warehouse / work center (P1-2); actions still validate against the full data.
  // Every date helper reads "today" and wall-clock times in the company timezone (audit #20); set before anything renders.
  setTimeZone(state.settings.company?.timezone)
  setZoneHistory(state.settings.company?.zoneHistory)
  const view=useMemo(()=>scopedView(state,session?currentEmployee:undefined),[state,session,currentEmployee])

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
  // An action rolled back after a failed save may leave archived entries that are still in the working data.
  const activityArchive=()=>{const live=new Set(stateRef.current.activity.map(a=>a.id));return storage.get<ManufacturingState['activity']>(ACTIVITY_ARCHIVE_KEY,[]).filter(a=>!live.has(a.id))}
  const me=()=>sessionRef.current?.employeeId||''
  const actor=()=>stateRef.current.employees.find(e=>e.id===me())
  const makeCtx=():Ctx=>({now:new Date(),user:actor()||NOBODY,id:uid})
  const allowed=(rules:Rules|undefined)=>Boolean(sessionRef.current)&&allowedBy(roleOf(stateRef.current,me()),rules)
  const execute=(name:string,fn:(s:ManufacturingState,ctx:Ctx)=>Outcome,rules?:Rules,silentSuccess=false):ActionResult=>{
    if(!sessionRef.current){const message='Avval tizimga kiring';pushToast(message,'danger');return {ok:false,message}}
    if(!allowed(rules)){const message='Rolingizda bu amal uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    if(recoveryRef.current){const message='Saqlangan ma’lumot ochilmagan — avval tiklash usulini tanlang';pushToast(message,'danger');return {ok:false,message}}
    // Continue from another tab's newer save, so this action cannot overwrite what it did (BUG-14).
    const base=slot.latest(stateRef.current)
    if(base.changed){stateRef.current=base.state;setState(base.state)}
    let out:Outcome
    const ctx=makeCtx()
    try{out=fn(stateRef.current,ctx)}catch(error){console.error(`[${name}]`,error);const message=error instanceof A.StockError?error.message:'Kutilmagan xatolik — amal bajarilmadi';pushToast(message,'danger');return {ok:false,message}}
    // Whatever the action, at least one Super Admin must still be able to sign in (A-H2), checked with the accounts too.
    if(out.result.ok&&!Auth.superAdminInvariant(authRef.current,out.state)){const message='Bu amal oxirgi faol Super Admin kirish huquqini olib qo‘yadi — bajarilmadi';pushToast(message,'danger');return {ok:false,message}}
    // Conditions the committed command leaves behind (delays, shortages, due services…) become keyed notifications
    // (audit #27); only after success, so a refused command never announces anything. A scan error never undoes the command.
    if(out.result.ok){try{out={...out,state:scanNotifications(out.state,ctx)}}catch(error){console.error('[notifications]',error)}}
    if(!out.result.ok){
      // A refusal may still record something (an order put on "material wait"): that is kept and saved as before.
      if(out.state!==stateRef.current){commit(out.state);persist(stateRef.current)}
      pushToast(out.result.message,'warning');return out.result
    }
    const before=stateRef.current
    commit(out.state)
    // Saved at once rather than after the debounce: a tab closed or another tab acting right after cannot lose it.
    // What is saved is the committed state (older activity already moved to its archive).
    const saved=save(stateRef.current)
    if(saved!=='saved'&&saved!=='same'){
      // Success means durably saved (audit #9): an action that could not be saved is undone here, so the form stays
      // open with what was typed and pressing save again cannot apply it twice. On a conflict the other tab's data is
      // already in place; with newer-version data nothing is written at all.
      if(saved==='failed'||saved==='invalid'){stateRef.current=before;setState(before)}
      const why=saved==='conflict'?'boshqa oynada ma’lumot o‘zgardi — yangilangan ma’lumot bilan qayta bajaring'
        :saved==='locked'||saved==='suspended'?'saqlangan ma’lumot ilovaning yangiroq versiyasiga tegishli — sahifani yangilang'
        :saved==='invalid'?'ma’lumotda saqlab bo‘lmaydigan son bor'
        :'brauzer xotirasiga yozib bo‘lmadi — joy bo‘shating (Tizim → Eksport, katta hujjatlarni o‘chirish) va qayta urinib ko‘ring'
      const message=`Saqlanmadi: ${why}. Amal bajarilmadi.`
      pushToast(message,'danger')
      return {ok:false,message,code:'not-saved'}
    }
    if(!silentSuccess)pushToast(out.result.message,'success')
    return out.result
  }
  /** Changes outside domain actions (preferences, settings, read marks) start from the newest save too, and are saved at once. */
  const commitLatest=(update:(s:ManufacturingState)=>ManufacturingState)=>{
    const base=slot.latest(stateRef.current)
    if(base.changed){stateRef.current=base.state;setState(base.state)}
    const next=update(stateRef.current)
    commit(next)
    persist(stateRef.current)
  }

  // Every domain action is checked against its rule for these exact arguments (e.g. running vs cancelling an order).
  // The role's rule and scope (own work center / branch / warehouse) are checked again on the same call, against
  // the very data it runs on, by the one domain gate (A-H6 / audit #6).
  const domain=Object.fromEntries(Object.entries(DOMAIN_ACTIONS).map(([name,fn])=>[name,(...args:unknown[])=>execute(name,(s,ctx)=>{
    const outside=commandBlocker(s,ctx.user,name,args)
    return outside?{state:s,result:{ok:false,message:outside}}:(fn as (s:ManufacturingState,ctx:Ctx,...a:unknown[])=>Outcome)(s,ctx,...args)
  },actionRules(name,args)??[['__unlisted__','view']])])) as unknown as DomainApi

  const rulesFor=(key:EntityKey,action:PermissionAction,patch?:Record<string,unknown>):Rules=>{
    // Giving someone a role or blocking them is user administration: it needs users.edit on top of the HR record right.
    if(key==='employees'&&patch&&(patch.roleId!==undefined||patch.status==='Arxiv'))return [['users','edit']]
    return entityRules(key as EntityKeyName,action)
  }
  // Location-bound master data (sites, equipment, maintenance) is checked against the role's scope too (P1-2).
  const scoped=(name:string,args:unknown[],run:(s:ManufacturingState,ctx:Ctx)=>Outcome)=>(s:ManufacturingState,ctx:Ctx):Outcome=>{
    const outside=scopeBlocker(s,ctx.user,name,args)
    return outside?{state:s,result:{ok:false,message:outside}}:run(s,ctx)
  }
  const createEntity=(key:EntityKey,payload:Record<string,unknown>)=>execute('createEntity',scoped('createEntity',[key,payload],(s,ctx)=>A.createEntity(s,ctx,key,payload,ENTITY_LABEL[key])),rulesFor(key,'create'))
  const updateEntity=(key:EntityKey,id:string,patch:Record<string,unknown>)=>{
    const before=(stateRef.current[key] as unknown as Record<string,unknown>[]).find(x=>x.id===id)
    const changes=Object.fromEntries(Object.entries(patch).filter(([k,v])=>before?.[k]!==v))
    return execute('updateEntity',scoped('updateEntity',[key,id,patch],(s,ctx)=>A.updateEntity(s,ctx,key,id,patch,ENTITY_LABEL[key])),rulesFor(key,'edit',changes))
  }
  const deleteEntity=(key:EntityKey,id:string)=>execute('deleteEntity',scoped('deleteEntity',[key,id],(s,ctx)=>A.deleteEntity(s,ctx,key,id,ENTITY_LABEL[key])),key==='employees'?[['users','delete']]:rulesFor(key,'delete'))
  const duplicateEntity=(key:EntityKey,id:string)=>execute('duplicateEntity',scoped('duplicateEntity',[key,id],(s,ctx)=>A.duplicateEntity(s,ctx,key,id,ENTITY_LABEL[key])),rulesFor(key,'create'))

  const saveSupplier=(p:Parameters<typeof A.saveSupplier>[2])=>execute('saveSupplier',(s,ctx)=>A.saveSupplier(s,ctx,p),[['purchases',p.id?'edit':'create']])
  const addAttachment=(a:Parameters<typeof A.addAttachment>[2])=>{const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('addAttachment',(s,ctx)=>A.addAttachment(s,ctx,a),[[module,'edit']])}
  const removeAttachment=(id:string)=>{const a=stateRef.current.attachments.find(x=>x.id===id);if(!a){const message='Hujjat topilmadi';pushToast(message,'warning');return {ok:false,message}}const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('removeAttachment',(s,ctx)=>A.removeAttachment(s,ctx,id),[[module,'edit']])}

  const setPreferences=(patch:Partial<UiPreferences>)=>commitLatest(s=>({...s,settings:{...s.settings,...patch}}))
  const saveSettings=(patch:Partial<SettingsState>)=>{
    const businessChange=Object.keys(patch).some(k=>!UI_KEYS.includes(k as keyof UiPreferences))
    if(businessChange&&!allowed([['settings','edit']])){pushToast('Sozlamalarni o‘zgartirish uchun ruxsat yo‘q','danger');return}
    commitLatest(s=>{
      // A company clock change keeps the zone history, so timestamps written before it keep their real instant.
      const company=patch.company&&patch.company.timezone!==s.settings.company.timezone?recordZoneChange(s.settings.company,patch.company,new Date()):patch.company
      const next={...s,settings:{...s.settings,...patch,...(company?{company}:{})}}
      return businessChange?A.logActivity(next,makeCtx(),'Sozlamani o‘zgartirdi','Sozlamalar',Object.keys(patch).join(', ')):next
    })
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
    commitLatest(clearTransactions)
    const message='Tranzaksiyalar tozalandi — master ma’lumotlar va sozlamalar saqlandi'
    pushToast(message,'info')
    return {ok:true,message}
  }
  /** Replaces all data with a backup. Permission-checked here, not only in the UI; the current data is kept as the undo copy (BUG-14). */
  const replaceAll=(data:unknown,reason:string):ActionResult=>{
    if(!allowed([['settings','edit']])){const message='Backup tiklash uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    const shape=data as Partial<ManufacturingState>|null
    // A backup of a newer app version would be migrated "back" and saved in the older schema (audit #8).
    const newer=newerSchema(shape)
    if(newer!==undefined){const message=`Backup ilovaning yangiroq versiyasida (v${newer}) yaratilgan — bu versiya (v${SCHEMA_VERSION}) uni tiklay olmaydi. Ilovani yangilang.`;pushToast(message,'danger');return {ok:false,message}}
    const arrays:(keyof ManufacturingState)[]=['productionOrders','stockBalances','products','rawMaterials','warehouses','employees','roles']
    if(!shape||typeof shape!=='object'||arrays.some(k=>!Array.isArray(shape[k]))||!(shape.employees||[]).length||!(shape.roles||[]).length){
      const message='Fayl ZENIX backup formatiga mos emas';pushToast(message,'danger');return {ok:false,message}
    }
    if(!storage.set(BACKUP_KEY,{savedAt:stamp(new Date()),reason,state:stateRef.current})){
      const message='Joriy ma’lumot zaxiralanmadi (brauzer xotirasi to‘la) — avval Backup eksport qiling';pushToast(message,'danger');return {ok:false,message}
    }
    // A backup from an older version is upgraded (and repaired) the same way as stored data.
    let prepared:ReturnType<typeof prepareStored>
    try{prepared=prepareStored(shape,createInitialState())}catch(error){console.error('Backup could not be loaded',error);const message='Backup faylini o‘qib bo‘lmadi — import bekor qilindi';pushToast(message,'danger');return {ok:false,message}}
    const next=prepared.state,found=describeReport(prepared.report)
    // Accounts are not in the backup: the restored data must still contain a Super Admin who can sign in (A-H3).
    if(!Auth.superAdminInvariant(authRef.current,next)){
      const message='Bu backup’da hozirgi Super Admin akkauntiga mos xodim yo‘q — tiklansa hech kim boshqara olmaydi. Import bekor qilindi.';pushToast(message,'danger');return {ok:false,message}
    }
    // Restoring replaces whatever another tab holds too; the replaced data is the undo copy above.
    slot.latest(stateRef.current)
    commit(A.logActivity(next,makeCtx(),'Backup tiklandi','Tizim',reason,'warning'))
    if(!persist(stateRef.current)){const message='Backup tiklandi, lekin brauzerda saqlanmadi';return {ok:false,message}}
    pushToast(found?`Backup tiklandi — ${found}`:'Backup tiklandi — oldingi ma’lumot zaxirada saqlandi',found?'warning':'success')
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
  const markAllRead=()=>commitLatest(s=>({...s,notifications:s.notifications.map(markRead)}))
  const markNotificationRead=(id:string)=>commitLatest(s=>({...s,notifications:s.notifications.map(n=>n.id===id?markRead(n):n)}))

  /* -------------------------------------------------------------- recovery of unreadable data -- */

  /**
   * Leaves recovery mode with an empty working copy. The unreadable text is kept under CORRUPT_KEY first;
   * if that copy cannot be stored, the user must download it and confirm (`withoutCopy`).
   */
  const startClean=(withoutCopy=false):ActionResult=>{
    const current=recoveryRef.current
    if(!current)return {ok:false,message:'Tiklash talab qilinmaydi'}
    // Data of a newer version is not replaced from an older build: export it and open the newer app instead.
    if(current.reason==='newer'){const message='Ma’lumot ilovaning yangiroq versiyasiga tegishli — uni bu versiyada almashtirib bo‘lmaydi. Nusxani yuklab oling va sahifani yangilang.';pushToast(message,'danger');return {ok:false,message}}
    const kept=storage.setRaw(CORRUPT_KEY,JSON.stringify({savedAt:stamp(new Date()),reason:current.reason,raw:current.raw}))
    if(!kept&&!withoutCopy){const message='Nusxa brauzerda saqlanmadi — avval faylni yuklab oling';pushToast(message,'danger');return {ok:false,message}}
    recoveryRef.current=null;setRecovery(null)
    // The first-run administrator keeps Super Admin, otherwise nobody could act on the clean data.
    const fresh=Auth.restoreSuperAdmin(authRef.current,hydrateFresh(createInitialState()))
    stateRef.current=fresh;setState(fresh)
    persist(fresh)
    const message=kept?'Ilova toza holatda ochildi — o‘qilmagan ma’lumot nusxasi Tizim → Tiklash nusxalari bo‘limida':'Ilova toza holatda ochildi'
    pushToast(message,'info')
    return {ok:true,message}
  }
  const recoveryCopies=():RecoveryCopy[]=>{
    const read=(key:string)=>{try{const raw=storage.getRaw(key);return raw?JSON.parse(raw) as {savedAt?:string;raw?:string;state?:unknown}:null}catch{return null}}
    const list:RecoveryCopy[]=boot.unsaved?[boot.unsaved]:[]
    const unreadable=read(CORRUPT_KEY),repair=read(REPAIR_KEY)
    if(unreadable?.raw)list.push({key:'unreadable',label:'O‘qilmagan ma’lumot',savedAt:unreadable.savedAt,text:unreadable.raw})
    if(repair?.raw)list.push({key:'repair',label:'Tiklashdan oldingi ma’lumot',savedAt:repair.savedAt,text:repair.raw})
    // Every upgrade keeps its own copy (before v4, before v5 …), newest first.
    for(let v=SCHEMA_VERSION;v>=4;v--){
      const migration=read(migrationBackupKey(v))
      if(migration?.state)list.push({key:v===SCHEMA_VERSION?'migration':`migration-v${v}`,label:`v${v} yangilanishidan oldingi ma’lumot`,savedAt:migration.savedAt,text:JSON.stringify(migration.state)})
    }
    return list
  }

  /* ------------------------------------------------------------ sign-in, sessions and accounts -- */

  const authCtx=():Auth.AuthCtx=>({now:new Date(),actor:actor(),id:uid})
  const commitAuth=(next:AuthStore)=>{authRef.current=next;setAuth(next);if(!storage.set(AUTH_KEY,next))pushToast('Akkaunt ma’lumotlari saqlanmadi (brauzer xotirasi to‘la)','danger')}
  const commitSession=(next:Session|null)=>{sessionRef.current=next;setSession(next);if(next)storage.set(SESSION_KEY,next);else storage.remove(SESSION_KEY)}
  const authResult=(out:AuthOutcome,silent=false):ActionResult=>{
    if(out.error!==undefined){pushToast(out.error,'warning');return {ok:false,message:out.error}}
    if(out.state&&out.state!==stateRef.current){commit(out.state);persist(stateRef.current)}
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
      if(e.key===AUTH_KEY){const next=Auth.normalizeAuthStore(parseJson(e.newValue));authRef.current=next;setAuth(next)}
      if(e.key===SESSION_KEY){
        const next=Auth.normalizeSession(parseJson(e.newValue))
        if(!next&&sessionRef.current){sessionRef.current=null;setSession(null);setAuthNotice(NOTICE.elsewhere)}
        else if(next){sessionRef.current=next;setSession(next)}
      }
    }
    window.addEventListener('storage',synced)
    return()=>{for(const e of events)window.removeEventListener(e,touch);window.removeEventListener('storage',synced)}
  },[])

  const account=session?auth.accounts.find(a=>a.id===session.accountId)||null:null
  const authInfo=useMemo(()=>({needsSetup:!auth.accounts.length,signedIn:Boolean(session&&account),session,account,accounts:auth.accounts,events:auth.events,policy:auth.policy,notice:authNotice}),[auth,session,account,authNotice])

  const value=useMemo<AppContextValue>(()=>({
    ...domain,state:view,resolvedTheme,toasts,dismissToast,sidebarMobile,setSidebarMobile,searchOpen,setSearchOpen,notifOpen,setNotifOpen,aiOpen,setAiOpen,
    currentEmployee,currentRole,can,toast,saveSettings,setPreferences,setTheme,setAppearance,setCurrency,resetTransactions,importState,restoreLastBackup,lastBackup,markAllRead,markNotificationRead,activityArchive,
    recovery,startClean,recoveryCopies,storageError,storageUsage:()=>{const u=storage.usage(STORAGE_KEY);return {data:u.key,total:u.total}},
    createEntity,updateEntity,deleteEntity,duplicateEntity,addAttachment,removeAttachment,saveSupplier,
    auth:authInfo,login,logout,clearAuthNotice:()=>setAuthNotice(''),setupSuperAdmin,changePassword,createUser,updateUser,setUserStatus,resetUserPassword,deleteUser,updateSecurityPolicy,
  // Actions read the latest state through stateRef, so re-creating them only when state changes is sufficient.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[view,resolvedTheme,toasts,sidebarMobile,searchOpen,notifOpen,aiOpen,currentEmployee,currentRole,can,toast,dismissToast,authInfo,recovery,storageError])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(){const v=useContext(Ctx);if(!v)throw new Error('useApp must be inside AppProvider');return v}
