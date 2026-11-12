import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react'
import type {ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {createEmptyTenantState,createInitialState} from '../../../data/mockData'
import {storage} from '../../../shared/lib/storage'
import {hasDirtyForms} from '../../../shared/ui/Forms'
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
import {backupSecurityBlocker,privilegedBackupBlocker} from '../../../domain/backupSecurity'
import {actionRules,commandBlocker,entityRules,hasPermission,isOwnerRole,roleOf,scopeBlocker,scopedView} from '../../../domain/access'
import {SCHEMA_VERSION} from '../../../domain/migrations'
import {changedRecords,describeReport,isNewerSchemaText,looksLikeState,newerSchema,prepareStored,strictStringify} from '../../../domain/persistence'
import * as Auth from '../../../domain/auth'
import * as SaaS from '../../../domain/saas'
import * as Platform from '../../../domain/platform'
import type {Account,AuthOutcome,AuthStore,SecurityPolicy,Session,SessionProblem} from '../../../domain/auth'
import {PBKDF2_ITERATIONS,hashPassword,makeCredential,newRecoveryKey,normalizeRecoveryKey,randomSalt,verifyPassword,verifyRecoveryTicket} from '../../../shared/lib/crypto'
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
const SAAS_KEY='zenix-saas-v1'
export const REGISTRATION_CLOSED='Yangi kompaniya ro‘yxati platforma tomonidan vaqtincha yopilgan. Support bilan bog‘laning.'
/** The signed-in session of this browser, shared by its tabs (signing out in one tab signs out all). */
const SESSION_KEY='zenix-session-v1'
/** Activity older than the newest ACTIVITY_LIMIT entries (BUG-07); read by the audit log, not part of backups of the working data. */
const ACTIVITY_ARCHIVE_KEY='zenix-activity-archive-v1'
const uid=(p:string)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`
const parseJson=(raw:string|null):unknown=>{if(!raw)return null;try{return JSON.parse(raw)}catch{return null}}
const tenantAuxKey=(legacyKey:string,tenantId:string)=>tenantId===SaaS.LEGACY_TENANT_ID?legacyKey:`${legacyKey}:${tenantId}`
/** Activity refreshes are harmless; identity, tenant and employee changes invalidate a draft. */
const sameSessionIdentity=(a:Session|null,b:Session|null)=>a?.id===b?.id&&a?.accountId===b?.accountId&&a?.tenantId===b?.tenantId&&a?.employeeId===b?.employeeId
const storedSession=()=>Auth.normalizeSession(parseJson(storage.getRaw(SESSION_KEY)))

export type ToastTone='success'|'warning'|'danger'|'info'
export type Toast={id:string;message:string;tone:ToastTone}
export type UiPreferences=Pick<SettingsState,'theme'|'appearance'|'currency'|'fontSize'|'reducedMotion'|'uiDensity'|'tableDensity'>
export type {EntityKey}
/**
 * Stored business data that could not be opened: nothing is written over it until the user chooses what to do.
 * 'newer': saved by a newer version of the app (`version`) — this build only offers export and reload (audit #8).
 */
/** An action that may hand out a new recovery key: shown to the user once, stored only as a hash. */
export type KeyResult=ActionResult&{recoveryKey?:string}
export type Recovery={reason:'unreadable'|'crashed'|'newer';raw:string;version?:number}
/** A copy kept aside by the app (unreadable data, pre-upgrade or pre-repair data) that the user can download. */
export type RecoveryCopy={key:string;label:string;savedAt?:string;text:string}

const UI_KEYS:(keyof UiPreferences)[]=['theme','appearance','currency','fontSize','reducedMotion','uiDensity','tableDensity']
const pickUi=(settings:Partial<SettingsState>|undefined)=>Object.fromEntries(UI_KEYS.filter(k=>settings?.[k]!==undefined).map(k=>[k,settings![k]])) as Partial<UiPreferences>

// Module permissions per action live in domain/access.ts (ACTION_RULES), where they are unit-tested.
const ENTITY_LABEL:Record<EntityKey,string>={products:'Mahsulot',rawMaterials:'Xomashyo',suppliers:'Supplier',customers:'Mijoz',employees:'Xodim',expenses:'Xarajat',qualityAlerts:'Quality alert',maintenanceOrders:'Maintenance',engineeringChanges:'ECO',qualityControlPoints:'Control point',maintenanceRequests:'Maintenance request',subcontractOrders:'Subcontract',repairOrders:'Repair order',warehouses:'Ombor',workCenters:'Work center',productionLines:'Liniya',equipment:'Uskuna',branches:'Filial'}
const ATTACHMENT_MODULE:Record<string,string>={product:'products',bom:'products',eco:'products',material:'materials',purchase:'purchases',supplier:'purchases',production:'production',sales:'sales',customer:'sales',equipment:'equipment',quality:'quality'}
const ROLE_AUDIT_ACTIONS=new Set(['updateRolePermission','createRole','duplicateRole','updateRole','deleteRole'])

type Bound<F>=F extends (s:ManufacturingState,ctx:Ctx,...args:infer P)=>Outcome?(...args:P)=>ActionResult:never
type DomainApi={
  createProductionOrder:Bound<typeof A.createProductionOrder>;updateProductionOrder:Bound<typeof A.updateProductionOrder>;transitionProduction:Bound<typeof A.transitionProduction>;shortCloseProduction:Bound<typeof A.shortCloseProduction>;reportOutput:Bound<typeof A.reportOutput>;recordScrap:Bound<typeof A.recordScrap>;reconcileReworkOwnership:Bound<typeof A.reconcileReworkOwnership>;
  splitProduction:Bound<typeof A.splitProduction>;mergeProduction:Bound<typeof A.mergeProduction>;createBackorder:Bound<typeof A.createBackorder>;unbuildProduct:Bound<typeof A.unbuildProduct>;issueExtraMaterial:Bound<typeof A.issueExtraMaterial>;returnUnusedMaterial:Bound<typeof A.returnUnusedMaterial>;checkAvailability:Bound<typeof A.checkAvailability>;refreshMaterialReservation:Bound<typeof A.refreshMaterialReservation>;
  startWorkOrder:Bound<typeof A.startWorkOrder>;pauseWorkOrder:Bound<typeof A.pauseWorkOrder>;finishWorkOrder:Bound<typeof A.finishWorkOrder>;markSetupDone:Bound<typeof A.markSetupDone>;reportOperationOutput:Bound<typeof A.reportOperationOutput>;assignWorkOrder:Bound<typeof A.assignWorkOrder>;rescheduleProductionOrder:Bound<typeof A.rescheduleProductionOrder>;confirmMrpSuggestion:Bound<typeof A.confirmMrpSuggestion>;setForecast:Bound<typeof A.setForecast>;recordMaterialScan:Bound<typeof A.recordMaterialScan>;rollUpCosts:Bound<typeof A.rollUpCosts>;createReworkOrder:Bound<typeof A.createReworkOrder>;
  createQualityCheck:Bound<typeof A.createQualityCheck>;resolveQuality:Bound<typeof A.resolveQuality>;createQualityAlert:Bound<typeof A.createQualityAlert>;
  createPurchaseOrder:Bound<typeof A.createPurchaseOrder>;createPurchaseOrders:Bound<typeof A.createPurchaseOrders>;linkSupplierMaterial:Bound<typeof A.linkSupplierMaterial>;updateSupplierMaterial:Bound<typeof A.updateSupplierMaterial>;removeSupplierMaterial:Bound<typeof A.removeSupplierMaterial>;setPreferredSupplier:Bound<typeof A.setPreferredSupplier>;saveSupplier:(p:Parameters<typeof A.saveSupplier>[2])=>ActionResult;confirmPurchase:Bound<typeof A.confirmPurchase>;markPurchaseInTransit:Bound<typeof A.markPurchaseInTransit>;cancelPurchase:Bound<typeof A.cancelPurchase>;closePurchaseShort:Bound<typeof A.closePurchaseShort>;updatePurchaseMeta:Bound<typeof A.updatePurchaseMeta>;recordSupplierPayment:Bound<typeof A.recordSupplierPayment>;adjustSupplierBalance:Bound<typeof A.adjustSupplierBalance>;receivePurchase:Bound<typeof A.receivePurchase>;returnPurchaseToSupplier:Bound<typeof A.returnPurchaseToSupplier>;updatePurchaseDraft:Bound<typeof A.updatePurchaseDraft>;inspectReceipt:Bound<typeof A.inspectReceipt>;scrapRejectedReceipt:Bound<typeof A.scrapRejectedReceipt>;advanceSubcontract:Bound<typeof A.advanceSubcontract>;correctSubcontractServiceCost:Bound<typeof A.correctSubcontractServiceCost>;cancelSubcontract:Bound<typeof A.cancelSubcontract>;
  createSalesOrder:Bound<typeof A.createSalesOrder>;reserveSalesOrder:Bound<typeof A.reserveSalesOrder>;deliverSalesOrder:Bound<typeof A.deliverSalesOrder>;resolveReturnCredit:Bound<typeof A.resolveReturnCredit>;requestSupplierReplacement:Bound<typeof A.requestSupplierReplacement>;receiveSupplierReplacement:Bound<typeof A.receiveSupplierReplacement>;closeSupplierReplacement:Bound<typeof A.closeSupplierReplacement>;cancelSalesOrder:Bound<typeof A.cancelSalesOrder>;updateSalesMeta:Bound<typeof A.updateSalesMeta>;recordCustomerPayment:Bound<typeof A.recordCustomerPayment>;adjustCustomerBalance:Bound<typeof A.adjustCustomerBalance>;createReturn:Bound<typeof A.createReturn>;dispositionReturn:Bound<typeof A.dispositionReturn>;
  transferStock:Bound<typeof A.transferStock>;adjustStock:Bound<typeof A.adjustStock>;countStock:Bound<typeof A.countStock>;
  moveStockBin:Bound<typeof A.moveStockBin>;assignVariantStock:Bound<typeof A.assignVariantStock>;setVariantStock:Bound<typeof A.setVariantStock>;allocateLegacyLots:Bound<typeof A.allocateLegacyLots>;
  startDowntime:Bound<typeof A.startDowntime>;endDowntime:Bound<typeof A.endDowntime>;approveMaintenanceRequest:Bound<typeof A.approveMaintenanceRequest>;startMaintenance:Bound<typeof A.startMaintenance>;completeMaintenance:Bound<typeof A.completeMaintenance>;cancelMaintenance:Bound<typeof A.cancelMaintenance>;planPreventiveMaintenance:Bound<typeof A.planPreventiveMaintenance>;advanceRepair:Bound<typeof A.advanceRepair>;createMaintenanceOrder:Bound<typeof A.createMaintenanceOrder>;updateMaintenanceOrder:Bound<typeof A.updateMaintenanceOrder>;saveMaintenancePlan:Bound<typeof A.saveMaintenancePlan>;recordEquipmentRuntime:Bound<typeof A.recordEquipmentRuntime>;
  createBomDraft:Bound<typeof A.createBomDraft>;saveBom:Bound<typeof A.saveBom>;deleteBomDraft:Bound<typeof A.deleteBomDraft>;activateBom:Bound<typeof A.activateBom>;createEngineeringChange:Bound<typeof A.createEngineeringChange>;setEcoStatus:Bound<typeof A.setEcoStatus>;applyEngineeringChange:Bound<typeof A.applyEngineeringChange>;cancelEngineeringChange:Bound<typeof A.cancelEngineeringChange>;archiveBom:Bound<typeof A.archiveBom>;saveRouting:Bound<typeof A.saveRouting>;copyRouting:Bound<typeof A.copyRouting>;saveVariant:Bound<typeof A.saveVariant>;
  updateRolePermission:Bound<typeof A.updateRolePermission>;createRole:Bound<typeof A.createRole>;duplicateRole:Bound<typeof A.duplicateRole>;updateRole:Bound<typeof A.updateRole>;deleteRole:Bound<typeof A.deleteRole>;addAttachment:Bound<typeof A.addAttachment>;removeAttachment:Bound<typeof A.removeAttachment>;
}
const DOMAIN_ACTIONS={createProductionOrder:A.createProductionOrder,updateProductionOrder:A.updateProductionOrder,transitionProduction:A.transitionProduction,shortCloseProduction:A.shortCloseProduction,reportOutput:A.reportOutput,recordScrap:A.recordScrap,reconcileReworkOwnership:A.reconcileReworkOwnership,issueExtraMaterial:A.issueExtraMaterial,returnUnusedMaterial:A.returnUnusedMaterial,splitProduction:A.splitProduction,mergeProduction:A.mergeProduction,createBackorder:A.createBackorder,unbuildProduct:A.unbuildProduct,checkAvailability:A.checkAvailability,refreshMaterialReservation:A.refreshMaterialReservation,startWorkOrder:A.startWorkOrder,pauseWorkOrder:A.pauseWorkOrder,finishWorkOrder:A.finishWorkOrder,markSetupDone:A.markSetupDone,reportOperationOutput:A.reportOperationOutput,assignWorkOrder:A.assignWorkOrder,rescheduleProductionOrder:A.rescheduleProductionOrder,confirmMrpSuggestion:A.confirmMrpSuggestion,setForecast:A.setForecast,recordMaterialScan:A.recordMaterialScan,rollUpCosts:A.rollUpCosts,createReworkOrder:A.createReworkOrder,createQualityCheck:A.createQualityCheck,resolveQuality:A.resolveQuality,createQualityAlert:A.createQualityAlert,createPurchaseOrder:A.createPurchaseOrder,createPurchaseOrders:A.createPurchaseOrders,linkSupplierMaterial:A.linkSupplierMaterial,updateSupplierMaterial:A.updateSupplierMaterial,removeSupplierMaterial:A.removeSupplierMaterial,setPreferredSupplier:A.setPreferredSupplier,confirmPurchase:A.confirmPurchase,markPurchaseInTransit:A.markPurchaseInTransit,cancelPurchase:A.cancelPurchase,closePurchaseShort:A.closePurchaseShort,updatePurchaseMeta:A.updatePurchaseMeta,recordSupplierPayment:A.recordSupplierPayment,adjustSupplierBalance:A.adjustSupplierBalance,receivePurchase:A.receivePurchase,returnPurchaseToSupplier:A.returnPurchaseToSupplier,updatePurchaseDraft:A.updatePurchaseDraft,inspectReceipt:A.inspectReceipt,scrapRejectedReceipt:A.scrapRejectedReceipt,requestSupplierReplacement:A.requestSupplierReplacement,receiveSupplierReplacement:A.receiveSupplierReplacement,closeSupplierReplacement:A.closeSupplierReplacement,advanceSubcontract:A.advanceSubcontract,correctSubcontractServiceCost:A.correctSubcontractServiceCost,cancelSubcontract:A.cancelSubcontract,createSalesOrder:A.createSalesOrder,reserveSalesOrder:A.reserveSalesOrder,deliverSalesOrder:A.deliverSalesOrder,cancelSalesOrder:A.cancelSalesOrder,updateSalesMeta:A.updateSalesMeta,recordCustomerPayment:A.recordCustomerPayment,adjustCustomerBalance:A.adjustCustomerBalance,resolveReturnCredit:A.resolveReturnCredit,createReturn:A.createReturn,dispositionReturn:A.dispositionReturn,transferStock:A.transferStock,moveStockBin:A.moveStockBin,assignVariantStock:A.assignVariantStock,setVariantStock:A.setVariantStock,allocateLegacyLots:A.allocateLegacyLots,adjustStock:A.adjustStock,countStock:A.countStock,startDowntime:A.startDowntime,endDowntime:A.endDowntime,approveMaintenanceRequest:A.approveMaintenanceRequest,startMaintenance:A.startMaintenance,completeMaintenance:A.completeMaintenance,cancelMaintenance:A.cancelMaintenance,planPreventiveMaintenance:A.planPreventiveMaintenance,advanceRepair:A.advanceRepair,createMaintenanceOrder:A.createMaintenanceOrder,updateMaintenanceOrder:A.updateMaintenanceOrder,saveMaintenancePlan:A.saveMaintenancePlan,recordEquipmentRuntime:A.recordEquipmentRuntime,createBomDraft:A.createBomDraft,saveBom:A.saveBom,deleteBomDraft:A.deleteBomDraft,activateBom:A.activateBom,createEngineeringChange:A.createEngineeringChange,setEcoStatus:A.setEcoStatus,applyEngineeringChange:A.applyEngineeringChange,cancelEngineeringChange:A.cancelEngineeringChange,archiveBom:A.archiveBom,saveRouting:A.saveRouting,copyRouting:A.copyRouting,saveVariant:A.saveVariant,updateRolePermission:A.updateRolePermission,createRole:A.createRole,duplicateRole:A.duplicateRole,updateRole:A.updateRole,deleteRole:A.deleteRole,addAttachment:A.addAttachment,removeAttachment:A.removeAttachment} as const

type AppContextValue=DomainApi&{
  state:ManufacturingState;resolvedTheme:'light'|'dark';toasts:Toast[];dismissToast:(id:string)=>void;
  sidebarMobile:boolean;setSidebarMobile:(v:boolean)=>void;searchOpen:boolean;setSearchOpen:(v:boolean)=>void;notifOpen:boolean;setNotifOpen:(v:boolean)=>void;aiOpen:boolean;setAiOpen:(v:boolean)=>void;
  currentEmployee:Employee;currentRole:Role;can:(module:string,action?:PermissionAction)=>boolean;
  auth:{needsSetup:boolean;setupBlocked:string|null;
    /** True right after a deliberate sign-out: the next person starts at a clean Login, not at the previous user's page. */
    signedOut:boolean;
    /** Whether public business registration is offered (platform policy; the first company of a browser is always allowed). */
    registration:{open:boolean;trialDays:number};ownerRecovery:boolean;signedIn:boolean;session:Session|null;account:Account|null;accounts:Account[];events:AuthStore['events'];policy:SecurityPolicy;notice:string};
  saas:{tenant:SaaS.Tenant|null;availableTenants:SaaS.Tenant[];subscription:SaaS.Subscription|null;plan:SaaS.Plan|null;usage:ReturnType<typeof SaaS.usage>;plans:typeof SaaS.PLAN_CATALOG};
  switchTenant:(tenantId:string)=>ActionResult;
  changePlan:(plan:SaaS.PlanId)=>ActionResult;
  login:(login:string,password:string,remember:boolean)=>Promise<ActionResult>;logout:(reason?:SessionProblem|'logout')=>void;clearAuthNotice:()=>void;
  setupSuperAdmin:(p:{employeeId:string;name:string;company:string;phone:string;username:string;email?:string;password:string})=>Promise<KeyResult>;
  recoverWithKey:(login:string,key:string,password:string)=>Promise<KeyResult>;recoverWithTicket:(login:string,ticket:string,code:string,password:string)=>Promise<KeyResult>;
  createRecoveryKey:(password:string)=>Promise<KeyResult>;
  changePassword:(current:string,next:string)=>Promise<ActionResult>;
  createUser:(p:{employeeId:string;username:string;email?:string;password:string;mustChangePassword?:boolean})=>Promise<ActionResult>;
  updateUser:(accountId:string,patch:{username?:string;email?:string})=>ActionResult;setUserStatus:(accountId:string,status:Account['status'])=>ActionResult;
  resetUserPassword:(accountId:string,password:string)=>Promise<ActionResult>;deleteUser:(accountId:string)=>ActionResult;updateSecurityPolicy:(patch:Partial<SecurityPolicy>)=>ActionResult;
  toast:(message:string,tone?:ToastTone)=>void;
  saveSettings:(patch:Partial<SettingsState>)=>void;setPreferences:(patch:Partial<UiPreferences>)=>void;setTheme:(theme:ThemeMode)=>void;setAppearance:(family:AppearanceFamily)=>void;setCurrency:(currency:CurrencyCode)=>void;
  resetTransactions:()=>ActionResult;importState:(data:unknown)=>ActionResult;importPrivilegedState:(data:unknown)=>ActionResult;restoreLastBackup:()=>ActionResult;lastBackup:()=>{savedAt?:string;reason?:string;state?:unknown}|null;markAllRead:()=>void;markNotificationRead:(id:string)=>void;activityArchive:()=>ManufacturingState['activity'];
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
function hydrate(tenantId:string):Boot{
  const dataKey=SaaS.tenantStateKey(tenantId)
  const seed=createInitialState()
  if(!dataKey)return {state:seed,recovery:{reason:'unreadable',raw:''},notices:[]}
  const raw=storage.getRaw(dataKey)
  if(!raw)return tenantId===SaaS.LEGACY_TENANT_ID?{state:hydrateFresh(seed,tenantId),recovery:null,notices:[]}:{state:seed,recovery:{reason:'unreadable',raw:''},notices:[]}
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
    if(changedRecords(report)&&!storage.setRaw(tenantAuxKey(REPAIR_KEY,tenantId),JSON.stringify({savedAt:stamp(new Date()),raw}))){unsaved=original;notices.push({text:`Tiklashdan oldingi nusxa saqlanmadi (brauzer xotirasi to‘la). ${HELD}`,tone:'danger'})}
    if(report.migrations.length){
      const migrationKey=tenantAuxKey(MIGRATION_BACKUP_KEY,tenantId)
      const kept=storage.getRaw(migrationKey)!==null||storage.set(migrationKey,{savedAt:stamp(new Date()),from:parsed.schemaVersion??3,to:SCHEMA_VERSION,state:parsed})
      if(!kept)unsaved=original
      notices.push(kept?{text:`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi (${report.migrations.map(m=>m.split(':')[0]).join(', ')}). Oldingi nusxa zaxirada saqlandi.`,tone:'info'}:{text:`Ma’lumotlar v${SCHEMA_VERSION} ga yangilandi, lekin zaxira nusxasi saqlanmadi (brauzer xotirasi to‘la). ${HELD}`,tone:'warning'})
    }
    const found=describeReport(report)
    if(found)notices.push({text:`Saqlangan ma’lumot tekshirildi: ${found}. Asl nusxa Tizim → Tiklash nusxalari bo‘limida.`,tone:'warning'})
    return {state:hydrateLoaded(parsed,state,tenantId),recovery:null,notices,unsaved}
  }catch(error){
    console.error('Stored data could not be loaded',error)
    return {state:seed,recovery:{reason:'crashed',raw},notices:[]}
  }
}

function hydrateLoaded(loaded:Partial<ManufacturingState>,state:ManufacturingState,tenantId:string):ManufacturingState{
  const cleanKey=tenantAuxKey(CLEAN_KEY,tenantId),backupKey=tenantAuxKey(BACKUP_KEY,tenantId),dataKey=SaaS.tenantStateKey(tenantId)!
  if(storage.get(cleanKey,null))return state
  // One-time cleanup of the generated demo history this browser was initialised with. Only when every
  // transaction and added record is provably generated demo data, and only after a backup is stored;
  // anything entered in the app is left alone (Tizim → "Tranzaksiyalarni tozalash" is the manual path).
  const hasHistory=TRANSACTION_KEYS.some(key=>(loaded[key] as unknown[]|undefined)?.length)
  if(hasHistory&&holdsOnlyDemoRecords(loaded)){
    if(!storage.set(backupKey,{savedAt:stamp(new Date()),reason:'demo-history-cleanup',state:loaded}))return state
    const clean=clearTransactions(state)
    // Persist now: StrictMode runs this initialiser twice and the second run must read the clean data.
    if(!storage.set(dataKey,clean))return state
    storage.set(cleanKey,stamp(new Date()))
    return clean
  }
  storage.set(cleanKey,stamp(new Date()))
  return state
}

function hydrateFresh(seed:ManufacturingState,tenantId=SaaS.LEGACY_TENANT_ID):ManufacturingState{
  // First run on the v3 model: keep the person's appearance preferences from the previous version.
  const legacy=tenantId===SaaS.LEGACY_TENANT_ID?storage.get<{settings?:Partial<SettingsState>}|null>(LEGACY_KEY,null):null
  if(legacy?.settings){const ui={...seed.settings,...pickUi(legacy.settings)};seed.settings={...ui,...normalizePrefs(ui)}}
  storage.set(tenantAuxKey(CLEAN_KEY,tenantId),stamp(new Date()))
  return seed
}

/** The owner's public key from the build; only the matching private key, kept outside the app, can sign a recovery ticket. */
const RECOVERY_PUBLIC_KEY=(import.meta as ImportMeta&{env?:Record<string,string|undefined>}).env?.VITE_RECOVERY_PUBLIC_KEY||''

function authorizedStoredTenantId():string|null{
  const session=storedSession()
  if(!session)return null
  const tenantId=session.tenantId||SaaS.LEGACY_TENANT_ID
  const saas=SaaS.normalizeSaaSStore(storage.get(SAAS_KEY,null))
  const account=Auth.normalizeAuthStore(storage.get(AUTH_KEY,null)).accounts.find(a=>a.id===session.accountId&&a.status==='active')
  return account&&SaaS.tenantStateKey(tenantId)&&saas?.tenants.some(t=>t.id===tenantId&&t.status==='active')&&saas.memberships.some(m=>m.tenantId===tenantId&&m.accountId===session.accountId&&m.employeeId===session.employeeId&&m.status==='active')?tenantId:null
}
const storedTenantId=()=>authorizedStoredTenantId()||SaaS.LEGACY_TENANT_ID

export function AppProvider({children,recoveryPublicKey=RECOVERY_PUBLIC_KEY}:{children:ReactNode;recoveryPublicKey?:string}){
  const [tenantId,setTenantId]=useState(storedTenantId)
  const activeSession=useRef(storedSession())
  const [sessionConflict,setSessionConflict]=useState(false)
  const switchActiveTenant=(id:string)=>{activeSession.current=storedSession();setSessionConflict(false);setTenantId(id)}
  useEffect(()=>{
    const changed=(e:StorageEvent)=>{
      if(e.key!==SESSION_KEY&&e.key!==SAAS_KEY)return
      const next=storedSession()
      if(!sameSessionIdentity(activeSession.current,next)){
        if(hasDirtyForms()){setSessionConflict(true);return}
        activeSession.current=next;setSessionConflict(false)
      }
      const nextId=storedTenantId()
      if(next&&authorizedStoredTenantId()!==tenantId&&hasDirtyForms()){setSessionConflict(true);return}
      if(nextId!==tenantId&&hasDirtyForms()){setSessionConflict(true);return}
      if(!sessionConflict)setTenantId(nextId)
    }
    window.addEventListener('storage',changed)
    return()=>window.removeEventListener('storage',changed)
  },[sessionConflict,tenantId])
  return <>
    <div className="tenant-session-content" inert={sessionConflict}><TenantProvider key={tenantId} tenantId={tenantId} onTenantChange={switchActiveTenant} recoveryPublicKey={recoveryPublicKey}>{children}</TenantProvider></div>
    {sessionConflict&&createPortal(<div className="tenant-session-overlay" role="alertdialog" aria-modal="true" aria-labelledby="tenant-session-title" aria-describedby="tenant-session-copy">
      <div className="tenant-session-card" tabIndex={-1} ref={node=>node?.focus()}>
        <h2 id="tenant-session-title">Boshqa oynada sessiya o‘zgardi</h2>
        <p id="tenant-session-copy">Bu oynadagi kiritilgan ma’lumotlar hali saqlanmagan. Eski sessiyada saqlash bloklandi. Davom etsangiz, kiritilgan o‘zgarishlar bekor qilinadi va joriy sessiya ochiladi.</p>
        <button type="button" className="primary-glass-btn" onClick={()=>window.location.reload()}>O‘zgarishlarni bekor qilish va yangilash</button>
      </div>
    </div>,document.body)}
  </>
}

function TenantProvider({children,tenantId,onTenantChange,recoveryPublicKey}:{children:ReactNode;tenantId:string;onTenantChange:(id:string)=>void;recoveryPublicKey:string}){
  const dataKey=SaaS.tenantStateKey(tenantId)||STORAGE_KEY
  const backupKey=tenantAuxKey(BACKUP_KEY,tenantId),corruptKey=tenantAuxKey(CORRUPT_KEY,tenantId),repairKey=tenantAuxKey(REPAIR_KEY,tenantId),activityArchiveKey=tenantAuxKey(ACTIVITY_ARCHIVE_KEY,tenantId)
  const migrationKey=(version:number)=>tenantAuxKey(migrationBackupKey(version),tenantId)
  const [boot]=useState(()=>hydrate(tenantId))
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
  const registrationPending=useRef(false)
  const recoveryPending=useRef(false)
  const [saas,setSaaS]=useState<SaaS.SaaSStore>(()=>SaaS.normalizeSaaSStore(storage.get(SAAS_KEY,null))||(!storage.getRaw(SAAS_KEY)?SaaS.legacyTenant(boot.state,auth,new Date()):SaaS.emptySaaSStore()))
  const saasRef=useRef(saas)
  const policyFor=(id=tenantId)=>authRef.current.policies?.[id]||authRef.current.policy
  const authFor=(id=tenantId):AuthStore=>({...authRef.current,policy:policyFor(id)})
  const saasDamaged=useRef(Boolean(storage.getRaw(SAAS_KEY)&&!SaaS.normalizeSaaSStore(storage.get(SAAS_KEY,null))))
  useEffect(()=>{if(!saasDamaged.current&&!storage.getRaw(SAAS_KEY)&&saas.tenants.length)storage.set(SAAS_KEY,saas)},[saas])
  // Accounts that cannot be read stay in storage as they are: nothing is saved over them.
  const authDamaged=useRef(Auth.authStorageDamaged(storage.getRaw(AUTH_KEY)))
  const [session,setSession]=useState<Session|null>(()=>Auth.normalizeSession(storage.get<unknown>(SESSION_KEY,null)))
  const sessionRef=useRef(session)
  const sessionCurrent=useCallback(()=>sameSessionIdentity(sessionRef.current,storedSession())&&(!sessionRef.current||authorizedStoredTenantId()===tenantId),[tenantId])
  const [authNotice,setAuthNotice]=useState('')
  const storageWarned=useRef(false)
  /** The stored copy shared with other tabs: read before every action, written right after it (BUG-14). */
  // Data of a newer schema is never written over, and a value JSON cannot keep (NaN, ±Infinity) stops the save.
  const slot=useRef(createSyncedSlot<ManufacturingState>(storage,dataKey,parseStored,storage.getRaw(dataKey),{locked:isNewerSchemaText,stringify:strictStringify})).current

  /** Another tab of a newer app version saved: this tab stops writing and offers export / reload (audit #8). */
  const enterNewerRecovery=(raw:string)=>{
    let version:number|undefined
    try{version=newerSchema(JSON.parse(raw))}catch{version=undefined}
    const next:Recovery={reason:'newer',raw,version}
    recoveryRef.current=next;setRecovery(next)
  }

  /** Saves now; true only when the data is durably stored. Suspended in recovery mode, so unreadable data is never overwritten. */
  const persist=(value:ManufacturingState,explicitRecovery=false):boolean=>{const out=save(value,explicitRecovery);return out==='saved'||out==='same'}
  const save=(value:ManufacturingState,explicitRecovery=false):SaveOutcome=>{
    if(recoveryRef.current)return 'suspended'
    if(!sameSessionIdentity(sessionRef.current,storedSession())||!explicitRecovery&&!sessionCurrent())return 'suspended'
    // The loaded data, unchanged, is not saved over an original that has no copy aside (see hydrate).
    if(boot.unsaved&&value===boot.state)return 'same'
    const out=slot.write(value)
    if(out==='locked'){enterNewerRecovery(storage.getRaw(dataKey)||'');return out}
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
    if(!authRef.current.accounts.length)return
    const timer=window.setTimeout(()=>persist(state),250)
    return()=>window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state])
  useEffect(()=>{
    // Closing or hiding the tab within the save delay must not lose the last action (BUG-14).
    const flush=()=>{if(authRef.current.accounts.length)persist(stateRef.current)}
    const hidden=()=>{if(document.visibilityState==='hidden')flush()}
    window.addEventListener('pagehide',flush)
    document.addEventListener('visibilitychange',hidden)
    // Another tab saved: continue from its data instead of overwriting it with this tab's older copy (BUG-14).
    const synced=(e:StorageEvent)=>{
      if(e.key!==dataKey)return
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
  const sessionValid=Boolean(session&&!Auth.sessionProblem(session,{...auth,policy:auth.policies?.[tenantId]||auth.policy},state,new Date()))
  const sessionAccount=sessionValid?auth.accounts.find(a=>a.id===session?.accountId):undefined
  const activeMembership=saas.memberships.find(m=>m.tenantId===(session?.tenantId||SaaS.LEGACY_TENANT_ID)&&m.tenantId===tenantId&&m.accountId===sessionAccount?.id&&m.employeeId===session?.employeeId&&m.status==='active'&&saas.tenants.some(t=>t.id===m.tenantId&&t.status==='active'))
  const tenant=saas.tenants.find(t=>t.id===activeMembership?.tenantId)||null
  const currentEmployee=(sessionValid&&activeMembership&&session&&state.employees.find(x=>x.id===session.employeeId))||NOBODY
  const currentRole=(sessionValid&&roleOf(state,currentEmployee.id))||NO_ROLE
  const can=useCallback((module:string,action:PermissionAction='view')=>Boolean(sessionValid&&tenant)&&hasPermission(currentRole,module,action)&&SaaS.entitlement(saas,tenant!.id,module,new Date()),[currentRole,sessionValid,tenant,saas])
  // A scoped role reads only its branch / warehouse / work center (P1-2); actions still validate against the full data.
  // Every date helper reads "today" and wall-clock times in the company timezone (audit #20); set before anything renders.
  setTimeZone(state.settings.company?.timezone)
  setZoneHistory(state.settings.company?.zoneHistory)
  const view=useMemo(()=>scopedView(state,tenant?currentEmployee:undefined),[state,tenant,currentEmployee])

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
      const archive=storage.get<ManufacturingState['activity']>(activityArchiveKey,[])
      const ids=new Set(archive.map(a=>a.id))
      if(storage.set(activityArchiveKey,[...split.overflow.filter(a=>!ids.has(a.id)),...archive]))next=split.state
      else if(!archiveWarned.current){archiveWarned.current=true;pushToast('Faoliyat arxivi saqlanmadi (brauzer xotirasi to‘la) — Admin Panel → Audit jurnalidan CSV eksport qiling','warning')}
    }
    stateRef.current=next;setState(next)
  }
  // An action rolled back after a failed save may leave archived entries that are still in the working data.
  const activityArchive=()=>{const live=new Set(stateRef.current.activity.map(a=>a.id));return storage.get<ManufacturingState['activity']>(activityArchiveKey,[]).filter(a=>!live.has(a.id))}
  const me=()=>sessionRef.current?.employeeId||''
  const actor=()=>stateRef.current.employees.find(e=>e.id===me())
  const makeCtx=():Ctx=>({now:new Date(),user:actor()||NOBODY,id:uid})
  const allowed=(rules:Rules|undefined)=>{
    const current=sessionRef.current,account=authRef.current.accounts.find(a=>a.id===current?.accountId)
    if(!sessionCurrent())return false
    if(Auth.sessionProblem(current,authFor(),stateRef.current,new Date()))return false
    const membership=saasRef.current.memberships.find(m=>m.tenantId===tenantId&&m.tenantId===(current?.tenantId||SaaS.LEGACY_TENANT_ID)&&m.accountId===account?.id&&m.employeeId===current?.employeeId&&m.status==='active')
    if(!membership||!saasRef.current.tenants.some(t=>t.id===membership.tenantId&&t.status==='active'))return false
    const role=roleOf(stateRef.current,me())
    return !rules||rules.some(([module,action])=>hasPermission(role,module,action)&&SaaS.entitlement(saasRef.current,membership.tenantId,module,new Date()))
  }
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
    // Every company keeps a signable owner account (A-H2), checked with account state too.
    if(out.result.ok&&!Auth.superAdminInvariant(scopedAuth(),out.state)){const message='Bu amal oxirgi faol biznes egasining kirish huquqini olib qo‘yadi — bajarilmadi';pushToast(message,'danger');return {ok:false,message}}
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
      if(saved==='failed'||saved==='invalid'||saved==='suspended'){stateRef.current=before;setState(before)}
      const why=saved==='conflict'?'boshqa oynada ma’lumot o‘zgardi — yangilangan ma’lumot bilan qayta bajaring'
        :saved==='suspended'?'sessiya boshqa oynada o‘zgardi yoki ma’lumot tiklashni kutmoqda — sahifani yangilang'
        :saved==='locked'?'saqlangan ma’lumot ilovaning yangiroq versiyasiga tegishli — sahifani yangilang'
        :saved==='invalid'?'ma’lumotda saqlab bo‘lmaydigan son bor'
        :'brauzer xotirasiga yozib bo‘lmadi — joy bo‘shating (Tizim → Eksport, katta hujjatlarni o‘chirish) va qayta urinib ko‘ring'
      const message=`Saqlanmadi: ${why}. Amal bajarilmadi.`
      pushToast(message,'danger')
      return {ok:false,message,code:'not-saved'}
    }
    if(ROLE_AUDIT_ACTIONS.has(name)){
      const event:SaaS.SaaSEvent={id:uid('saas-event'),tenantId,actorAccountId:sessionRef.current?.accountId,action:`role.${name}`,targetId:out.result.id||name,at:new Date().toISOString(),result:'success'}
      if(!commitSaaS({...saasRef.current,events:[event,...saasRef.current.events].slice(0,SaaS.SAAS_EVENT_LIMIT)}))pushToast('Rol auditi platforma metama’lumotiga saqlanmadi','warning')
    }
    if(!silentSuccess)pushToast(out.result.message,'success')
    return out.result
  }
  /** Changes outside domain actions (preferences, settings, read marks) start from the newest save too, and are saved at once. */
  const commitLatest=(update:(s:ManufacturingState)=>ManufacturingState)=>{
    if(!sessionCurrent())return
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
  const createEntity=(key:EntityKey,payload:Record<string,unknown>)=>{
    const kind=key==='employees'||key==='branches'||key==='warehouses'?key:null
    if(kind&&tenant){const limit=SaaS.limitBlocker(stateRef.current,saasRef.current,tenant.id,kind);if(limit)return {ok:false,message:limit}}
    return execute('createEntity',scoped('createEntity',[key,payload],(s,ctx)=>A.createEntity(s,ctx,key,payload,ENTITY_LABEL[key])),rulesFor(key,'create'))
  }
  const updateEntity=(key:EntityKey,id:string,patch:Record<string,unknown>)=>{
    const before=(stateRef.current[key] as unknown as Record<string,unknown>[]).find(x=>x.id===id)
    const kind=key==='employees'||key==='branches'||key==='warehouses'?key:null
    if(kind&&tenant&&before?.status==='Arxiv'&&patch.status==='Faol'){
      const limit=SaaS.limitBlocker(stateRef.current,saasRef.current,tenant.id,kind)
      if(limit)return {ok:false,message:limit}
    }
    const changes=Object.fromEntries(Object.entries(patch).filter(([k,v])=>before?.[k]!==v))
    return execute('updateEntity',scoped('updateEntity',[key,id,patch],(s,ctx)=>A.updateEntity(s,ctx,key,id,patch,ENTITY_LABEL[key])),rulesFor(key,'edit',changes))
  }
  const deleteEntity=(key:EntityKey,id:string)=>{
    if(key==='employees'&&authRef.current.accounts.some(a=>saasRef.current.memberships.some(m=>m.tenantId===tenantId&&m.accountId===a.id&&m.employeeId===id)))return {ok:false,message:'Xodimga akkaunt bog‘langan — o‘chirish o‘rniga arxivlang'}
    return execute('deleteEntity',scoped('deleteEntity',[key,id],(s,ctx)=>A.deleteEntity(s,ctx,key,id,ENTITY_LABEL[key])),key==='employees'?[['users','delete']]:rulesFor(key,'delete'))
  }
  const duplicateEntity=(key:EntityKey,id:string)=>{
    const kind=key==='employees'||key==='branches'||key==='warehouses'?key:null
    if(kind&&tenant){const limit=SaaS.limitBlocker(stateRef.current,saasRef.current,tenant.id,kind);if(limit)return {ok:false,message:limit}}
    return execute('duplicateEntity',scoped('duplicateEntity',[key,id],(s,ctx)=>A.duplicateEntity(s,ctx,key,id,ENTITY_LABEL[key])),rulesFor(key,'create'))
  }

  const saveSupplier=(p:Parameters<typeof A.saveSupplier>[2])=>execute('saveSupplier',(s,ctx)=>A.saveSupplier(s,ctx,p),[['purchases',p.id?'edit':'create']])
  const addAttachment=(a:Parameters<typeof A.addAttachment>[2])=>{const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('addAttachment',(s,ctx)=>A.addAttachment(s,ctx,a),[[module,'edit']])}
  const removeAttachment=(id:string)=>{const a=stateRef.current.attachments.find(x=>x.id===id);if(!a){const message='Hujjat topilmadi';pushToast(message,'warning');return {ok:false,message}}const module=ATTACHMENT_MODULE[a.entityType];if(!module){const message='Bu hujjat turi uchun permission aniqlanmagan';pushToast(message,'danger');return {ok:false,message}}return execute('removeAttachment',(s,ctx)=>A.removeAttachment(s,ctx,id),[[module,'edit']])}

  const setPreferences=(patch:Partial<UiPreferences>)=>{
    if(!authRef.current.accounts.length){commit({...stateRef.current,settings:{...stateRef.current.settings,...patch}});return}
    commitLatest(s=>({...s,settings:{...s.settings,...patch}}))
  }
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
    if(!storage.set(backupKey,{savedAt:stamp(new Date()),reason:'manual-reset',state:stateRef.current})){
      const message='Backup saqlanmadi (brauzer xotirasi to‘la) — avval Backup eksport qiling';pushToast(message,'danger');return {ok:false,message}
    }
    commitLatest(clearTransactions)
    const message='Tranzaksiyalar tozalandi — master ma’lumotlar va sozlamalar saqlandi'
    pushToast(message,'info')
    return {ok:true,message}
  }
  /** Replaces all data with a backup. Permission-checked here, not only in the UI; the current data is kept as the undo copy (BUG-14). */
  const replaceAll=(data:unknown,reason:string,includeSecurity=false):ActionResult=>{
    const latest=slot.latest(stateRef.current)
    if(latest.changed){stateRef.current=latest.state;setState(latest.state)}
    if(!allowed(includeSecurity?[['subscription','edit']]:[['settings','edit']])){const message='Backup tiklash uchun ruxsat yo‘q';pushToast(message,'danger');return {ok:false,message}}
    const shape=data as Partial<ManufacturingState>|null
    // A backup of a newer app version would be migrated "back" and saved in the older schema (audit #8).
    const newer=newerSchema(shape)
    if(newer!==undefined){const message=`Backup ilovaning yangiroq versiyasida (v${newer}) yaratilgan — bu versiya (v${SCHEMA_VERSION}) uni tiklay olmaydi. Ilovani yangilang.`;pushToast(message,'danger');return {ok:false,message}}
    const arrays:(keyof ManufacturingState)[]=['productionOrders','stockBalances','products','rawMaterials','warehouses','employees','roles']
    if(!shape||typeof shape!=='object'||arrays.some(k=>!Array.isArray(shape[k]))||!(shape.employees||[]).length||!(shape.roles||[]).length){
      const message='Fayl ZENIX backup formatiga mos emas';pushToast(message,'danger');return {ok:false,message}
    }
    // A backup from an older version is upgraded (and repaired) the same way as stored data.
    let prepared:ReturnType<typeof prepareStored>
    try{prepared=prepareStored(shape,createInitialState())}catch(error){console.error('Backup could not be loaded',error);const message='Backup faylini o‘qib bo‘lmadi — import bekor qilindi';pushToast(message,'danger');return {ok:false,message}}
    const next=prepared.state,found=describeReport(prepared.report)
    const securityProblem=includeSecurity
      ?privilegedBackupBlocker(stateRef.current,next,me(),scopedAuth().accounts.map(a=>a.employeeId))
      :backupSecurityBlocker(stateRef.current,next)
    if(securityProblem){pushToast(securityProblem,'danger');return {ok:false,message:securityProblem}}
    if(includeSecurity&&tenant){
      const plan=SaaS.PLAN_CATALOG[SaaS.subscriptionFor(saasRef.current,tenant.id)?.planId||'free']
      if(next.employees.filter(e=>e.status!=='Arxiv').length>plan.maxEmployees&&next.employees.filter(e=>e.status!=='Arxiv').length>stateRef.current.employees.filter(e=>e.status!=='Arxiv').length)return {ok:false,message:'Backupdagi faol xodimlar reja limitidan ko‘p'}
    }
    // Accounts are not in the backup: the restored data must still contain an owner who can sign in (A-H3).
    if(!Auth.superAdminInvariant(scopedAuth(),next)){
      const message='Bu backup’da hozirgi biznes egasi akkauntiga mos xodim yo‘q — tiklansa hech kim boshqara olmaydi. Import bekor qilindi.';pushToast(message,'danger');return {ok:false,message}
    }
    if(slot.latest(stateRef.current).changed)return {ok:false,message:'Boshqa oynada ma’lumot o‘zgardi — importni qayta tekshiring'}
    if(!storage.set(backupKey,{savedAt:stamp(new Date()),reason,state:stateRef.current})){
      const message='Joriy ma’lumot zaxiralanmadi (brauzer xotirasi to‘la) — avval Backup eksport qiling';pushToast(message,'danger');return {ok:false,message}
    }
    // Restoring replaces whatever another tab holds too; the replaced data is the undo copy above.
    commit(A.logActivity(next,makeCtx(),'Backup tiklandi','Tizim',reason,'warning'))
    if(!persist(stateRef.current)){const message='Backup tiklandi, lekin brauzerda saqlanmadi';return {ok:false,message}}
    pushToast(found?`Backup tiklandi — ${found}`:'Backup tiklandi — oldingi ma’lumot zaxirada saqlandi',found?'warning':'success')
    return {ok:true,message:'Backup tiklandi'}
  }
  const importState=(data:unknown)=>replaceAll(data,'before-import')
  const importPrivilegedState=(data:unknown)=>replaceAll(data,'before-owner-recovery',true)
  const lastBackup=()=>storage.get<{savedAt?:string;reason?:string;state?:unknown}|null>(backupKey,null)
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
    if(!sameSessionIdentity(sessionRef.current,storedSession()))return {ok:false,message:'Sessiya boshqa oynada o‘zgardi — sahifani yangilang'}
    // Data of a newer version is not replaced from an older build: export it and open the newer app instead.
    if(current.reason==='newer'){const message='Ma’lumot ilovaning yangiroq versiyasiga tegishli — uni bu versiyada almashtirib bo‘lmaydi. Nusxani yuklab oling va sahifani yangilang.';pushToast(message,'danger');return {ok:false,message}}
    const kept=storage.setRaw(corruptKey,JSON.stringify({savedAt:stamp(new Date()),reason:current.reason,raw:current.raw}))
    if(!kept&&!withoutCopy){const message='Nusxa brauzerda saqlanmadi — avval faylni yuklab oling';pushToast(message,'danger');return {ok:false,message}}
    recoveryRef.current=null;setRecovery(null)
    // No owner is inferred from the clean demo data; recovery must preserve explicit identity.
    const fresh=Auth.restoreSuperAdmin(authRef.current,hydrateFresh(createInitialState(),tenantId))
    stateRef.current=fresh;setState(fresh)
    persist(fresh,true)
    const message=kept?'Ilova toza holatda ochildi — o‘qilmagan ma’lumot nusxasi Tizim → Tiklash nusxalari bo‘limida':'Ilova toza holatda ochildi'
    pushToast(message,'info')
    return {ok:true,message}
  }
  const recoveryCopies=():RecoveryCopy[]=>{
    const read=(key:string)=>{try{const raw=storage.getRaw(key);return raw?JSON.parse(raw) as {savedAt?:string;raw?:string;state?:unknown}:null}catch{return null}}
    const list:RecoveryCopy[]=boot.unsaved?[boot.unsaved]:[]
    const unreadable=read(corruptKey),repair=read(repairKey)
    if(unreadable?.raw)list.push({key:'unreadable',label:'O‘qilmagan ma’lumot',savedAt:unreadable.savedAt,text:unreadable.raw})
    if(repair?.raw)list.push({key:'repair',label:'Tiklashdan oldingi ma’lumot',savedAt:repair.savedAt,text:repair.raw})
    // Every upgrade keeps its own copy (before v4, before v5 …), newest first.
    for(let v=SCHEMA_VERSION;v>=4;v--){
      const migration=read(migrationKey(v))
      if(migration?.state)list.push({key:v===SCHEMA_VERSION?'migration':`migration-v${v}`,label:`v${v} yangilanishidan oldingi ma’lumot`,savedAt:migration.savedAt,text:JSON.stringify(migration.state)})
    }
    return list
  }

  /* ------------------------------------------------------------ sign-in, sessions and accounts -- */

  const authCtx=():Auth.AuthCtx=>({now:new Date(),actor:actor(),tenantId,id:uid})
  const scopedAuth=(includeDisabled=false):AuthStore=>{
    const members=new Map(saasRef.current.memberships.filter(m=>m.tenantId===tenantId&&(includeDisabled||m.status==='active')).map(m=>[m.accountId,m]))
    return {...authFor(),accounts:authRef.current.accounts.filter(a=>members.has(a.id)).map(a=>({...a,employeeId:members.get(a.id)!.employeeId}))}
  }
  const sharedAccount=(accountId:string)=>saasRef.current.memberships.some(m=>m.accountId===accountId&&m.tenantId!==tenantId&&m.status==='active')
  const commitSaaS=(next:SaaS.SaaSStore)=>{if(!sessionCurrent()||saasDamaged.current||!storage.set(SAAS_KEY,next))return false;saasRef.current=next;setSaaS(next);return true}
  const commitAuth=(next:AuthStore)=>{
    if(!sessionCurrent()||authDamaged.current||!storage.set(AUTH_KEY,next)){pushToast('Akkaunt ma’lumotlari saqlanmadi — sessiya o‘zgargan yoki brauzer xotirasi to‘la','danger');return false}
    authRef.current=next;setAuth(next);return true
  }
  const commitSession=(next:Session|null)=>{sessionRef.current=next;setSession(next);if(next)storage.set(SESSION_KEY,next);else storage.remove(SESSION_KEY)}
  const authResult=(out:AuthOutcome,silent=false,scoped=false):ActionResult=>{
    if(out.error!==undefined){pushToast(out.error,'warning');return {ok:false,message:out.error}}
    if(out.state&&out.state!==stateRef.current){commit(out.state);persist(stateRef.current)}
    let nextStore=out.store
    if(scoped){
      const original=authRef.current,scopeIds=new Set(scopedAuth().accounts.map(a=>a.id))
      const merged=out.store.accounts.map(a=>{const prior=original.accounts.find(x=>x.id===a.id);return prior?{...a,employeeId:prior.employeeId}:{...a,tenantId}})
      nextStore={...out.store,policy:original.policy,policies:{...original.policies,[tenantId]:out.store.policy},accounts:[...original.accounts.filter(a=>!scopeIds.has(a.id)),...merged]}
    }
    if(!commitAuth(nextStore))return {ok:false,message:'Akkaunt ma’lumoti saqlanmadi'}
    if(scoped){
      const authEvent=out.store.events[0]
      if(authEvent){
        const event:SaaS.SaaSEvent={id:uid('saas-event'),tenantId,actorAccountId:sessionRef.current?.accountId,action:`account.${authEvent.type}`,targetId:authEvent.accountId||out.id||'policy',at:authEvent.at,result:'success'}
        if(!commitSaaS({...saasRef.current,events:[event,...saasRef.current.events].slice(0,SaaS.SAAS_EVENT_LIMIT)}))pushToast('Akkaunt auditi platforma metama’lumotiga saqlanmadi','warning')
      }
    }
    if(!silent)pushToast(out.message)
    return {ok:true,message:out.message,id:out.id}
  }
  const needs=(rules:Rules):string|null=>allowed(rules)?null:'Rolingizda bu amal uchun ruxsat yo‘q'

  const logout=(reason:SessionProblem|'logout'='logout')=>{
    const current=sessionRef.current
    if(!sessionCurrent())return
    if(current){
      const type=reason==='expired'?'session_expired':reason==='idle'?'session_idle':'logout'
      commitAuth(Auth.logAuth(authRef.current,authCtx(),{type,accountId:current.accountId,login:authRef.current.accounts.find(a=>a.id===current.accountId)?.username,detail:reason==='blocked'?'akkaunt bloklangan':reason==='credentials'?'parol o‘zgargan':''}))
    }
    commitSession(null)
    onTenantChange(SaaS.LEGACY_TENANT_ID)
    setAuthNotice(NOTICE[reason]||'')
  }

  const login=async(loginName:string,password:string,remember:boolean):Promise<ActionResult>=>{
    const fail=(message:string):ActionResult=>({ok:false,message})
    if(!loginName.trim()||!password)return fail('Login va parolni kiriting')
    const locked=Auth.lockState(authRef.current,loginName,new Date())
    if(locked)return fail(`Juda ko‘p noto‘g‘ri urinish — ${hhmm(new Date(locked))} dan keyin qayta urinib ko‘ring`)
    const account=Auth.findAccount(authRef.current,loginName)
    const accountTenants=account?saasRef.current.memberships.filter(m=>m.accountId===account.id).map(m=>m.tenantId):[]
    const loginPolicy=Auth.loginFailurePolicy(authRef.current,accountTenants)
    const failedLogin=(known?:Account)=>{
      const primary=accountTenants[0]
      let next=Auth.recordFailure({...authRef.current,policy:loginPolicy},{now:new Date(),id:uid,tenantId:primary},loginName,known)
      next={...next,policy:authRef.current.policy}
      for(const id of accountTenants.slice(1)){
        const events=next.events.slice(0,next.events[0]?.type==='lockout'?2:1)
        next={...next,events:[...events.map(e=>({...e,id:uid('ae'),tenantId:id})),...next.events].slice(0,Auth.AUTH_EVENT_LIMIT)}
      }
      commitAuth(next)
    }
    // An unknown login costs the same hashing time as a known one, so the two cannot be told apart.
    const valid=account?await verifyPassword(password,account):(await hashPassword(password,randomSalt(),PBKDF2_ITERATIONS),false)
    if(!valid||!account){failedLogin(account);return fail('Login yoki parol noto‘g‘ri')}
    const memberships=saasRef.current.memberships.filter(m=>m.accountId===account.id&&m.status==='active'&&saasRef.current.tenants.some(t=>t.id===m.tenantId&&t.status==='active'))
    const preferred=sessionRef.current?.accountId===account.id?sessionRef.current.tenantId:undefined
    const membership=memberships.find(m=>m.tenantId===preferred)||memberships[0]
    if(!membership)return fail('Kompaniyaga kirish hozir mavjud emas')
    const candidateKey=SaaS.tenantStateKey(membership.tenantId)
    let candidate:ManufacturingState|null=null
    try{candidate=candidateKey?parseStored(storage.getRaw(candidateKey)||''):null}catch{candidate=null}
    if(!candidate)return fail('Kompaniya ma’lumoti topilmadi yoki o‘qib bo‘lmadi — asl nusxa saqlandi')
    const blocked=Auth.signInBlocker(candidate,account,membership.employeeId)
    if(blocked){commitAuth(Auth.logAuth(authRef.current,{now:new Date(),id:uid,tenantId:membership.tenantId},{type:'login_failed',accountId:account.id,login:account.username,detail:blocked}));return fail(blocked)}
    const employee=candidate.employees.find(e=>e.id===membership.employeeId)
    const done=Auth.recordSuccess(authFor(membership.tenantId),{now:new Date(),id:uid,actor:employee,tenantId:membership.tenantId},account,remember,membership.tenantId,membership.employeeId)
    if(!commitAuth({...done.store,policy:authRef.current.policy}))return fail('Kirish holati saqlanmadi')
    commitSession(done.session);setAuthNotice('');onTenantChange(membership.tenantId)
    return {ok:true,message:`Xush kelibsiz, ${employee?.name||account.username}`}
  }

  const setupSuperAdmin=async(p:{employeeId:string;name:string;company:string;phone:string;username:string;email?:string;password:string}):Promise<KeyResult>=>{
    if(registrationPending.current)return {ok:false,message:'Ro‘yxatdan o‘tish jarayoni davom etmoqda'}
    // Platform registration policy (demo: browser-local, the server must enforce it). Applies to additional companies only.
    const policy=Platform.registrationPolicy(storage.get(Platform.PLATFORM_KEY,null))
    if(!policy.open&&saasRef.current.tenants.length&&authRef.current.accounts.length)return {ok:false,message:REGISTRATION_CLOSED}
    const problem=Auth.registrationProblem(authRef.current.policy,{...p,confirm:p.password})
    if(problem)return {ok:false,message:problem.message}
    registrationPending.current=true
    try{
    if(boot.unsaved)return {ok:false,message:'Avval asl ma’lumot nusxasini saqlang; ro‘yxatdan o‘tish to‘xtatildi'}
    if(saasDamaged.current||authDamaged.current)return {ok:false,message:'Akkaunt yoki kompaniya yozuvi shikastlangan — ro‘yxatdan o‘tish to‘xtatildi'}
    if(saasRef.current.tenants.length&&authRef.current.accounts.length){
      const weak=Auth.validatePassword(authRef.current.policy,p.password)
      if(weak)return {ok:false,message:weak}
      if(Auth.findAccount(authRef.current,p.username)||p.email&&Auth.findAccount(authRef.current,p.email))return {ok:false,message:'Bu login yoki e-pochta band'}
      if(Auth.findAccount(authRef.current,p.phone))return {ok:false,message:'Bu telefon raqami boshqa akkauntda ro‘yxatdan o‘tgan'}
      const fresh=createEmptyTenantState(p.company,p.name),owner=fresh.employees[0],recoveryKey=newRecoveryKey()
      const first=Auth.registerCompanyOwner({...Auth.emptyAuthStore(),policy:authRef.current.policy},fresh,{now:new Date(),id:uid},{employeeId:owner.id,name:p.name,company:p.company,phone:p.phone,username:p.username,email:p.email,credential:await makeCredential(p.password),recovery:await makeCredential(normalizeRecoveryKey(recoveryKey))})
      if(first.error!==undefined||!first.state)return {ok:false,message:first.error||'Kompaniya yaratilmadi'}
      const created=SaaS.newTenant(first.state,first.store.accounts[0],new Date(),policy.trialDays),id=created.tenants[0].id,key=SaaS.tenantStateKey(id)
      const account={...first.store.accounts[0],tenantId:id}
      if(!key||storage.getRaw(key)!==null)return {ok:false,message:'Kompaniya identifikatori band — qayta urinib ko‘ring'}
      const beforeSaaS=saasRef.current,beforeAuth=authRef.current
      if(!storage.set(key,first.state))return {ok:false,message:'Kompaniya ma’lumoti saqlanmadi'}
      const mergedSaaS={...beforeSaaS,tenants:[...beforeSaaS.tenants,...created.tenants],memberships:[...beforeSaaS.memberships,...created.memberships],subscriptions:[...beforeSaaS.subscriptions,...created.subscriptions],events:[...created.events,...beforeSaaS.events]}
      if(!commitSaaS(mergedSaaS)){storage.remove(key);return {ok:false,message:'Kompaniya a’zoligi saqlanmadi'}}
      const mergedAuth={...beforeAuth,accounts:[...beforeAuth.accounts,account],events:[...first.store.events.map(e=>({...e,tenantId:id})),...beforeAuth.events].slice(0,Auth.AUTH_EVENT_LIMIT)}
      if(!commitAuth(mergedAuth)){commitSaaS(beforeSaaS);storage.remove(key);return {ok:false,message:'Akkaunt saqlanmadi'}}
      return {ok:true,message:'Yangi kompaniya yaratildi. Tiklash kalitini saqlab, yangi login bilan kiring.',recoveryKey}
    }
    if(saasRef.current.tenants.length)return {ok:false,message:'Eski kompaniya akkauntlari topilmadi — uning ma’lumoti yangi egaga berilmaydi'}
    const closed=Auth.bootstrapBlocker(authRef.current,stateRef.current,storage.getRaw(AUTH_KEY),Boolean(storage.getRaw(dataKey)))
    if(closed)return {ok:false,message:closed}
    const weak=Auth.validatePassword(authRef.current.policy,p.password)
    if(weak)return {ok:false,message:weak}
    const recoveryKey=newRecoveryKey()
    const fresh=createEmptyTenantState(p.company,p.name)
    const out=Auth.registerCompanyOwner(authRef.current,fresh,{now:new Date(),id:uid},{employeeId:fresh.employees[0].id,name:p.name,company:p.company,phone:p.phone,username:p.username,email:p.email,credential:await makeCredential(p.password),recovery:await makeCredential(normalizeRecoveryKey(recoveryKey))})
    if(out.error!==undefined)return {ok:false,message:out.error}
    const before=stateRef.current,authBefore=authRef.current
    const rollback=()=>{stateRef.current=before;setState(before);persist(before);saasRef.current=SaaS.emptySaaSStore();setSaaS(saasRef.current);storage.remove(SAAS_KEY);commitAuth(authBefore)}
    if(out.state){commit(A.logActivity(out.state,{now:new Date(),user:out.state.employees.find(e=>e.id===p.employeeId)||NOBODY,id:uid},'Biznes egasi tayinlandi','Foydalanuvchilar',p.username,'warning'));if(!persist(stateRef.current)){stateRef.current=before;setState(before);return {ok:false,message:'Kompaniya ma’lumoti saqlanmadi'}}}
    const first=SaaS.newTenant(out.state||stateRef.current,out.store.accounts[0],new Date(),policy.trialDays)
    const created={...first,tenants:first.tenants.map(t=>({...t,id:SaaS.LEGACY_TENANT_ID})),memberships:first.memberships.map(m=>({...m,tenantId:SaaS.LEGACY_TENANT_ID})),subscriptions:first.subscriptions.map(s=>({...s,tenantId:SaaS.LEGACY_TENANT_ID})),events:first.events.map(e=>({...e,tenantId:SaaS.LEGACY_TENANT_ID,targetId:SaaS.LEGACY_TENANT_ID}))}
    if(!commitSaaS(created)){rollback();return {ok:false,message:'Kompaniya a’zoligi saqlanmadi'}}
    if(!commitAuth(out.store)){rollback();return {ok:false,message:'Akkaunt saqlanmadi'}}
    const account=out.store.accounts[0]
    const done=Auth.recordSuccess(out.store,{now:new Date(),id:uid},account,false,SaaS.LEGACY_TENANT_ID)
    if(!commitAuth(done.store)){rollback();return {ok:false,message:'Akkaunt saqlanmadi'}}
    commitSession(done.session)
    return {ok:true,message:out.message,recoveryKey}
    }finally{registrationPending.current=false}
  }

  /* Recovery changes only the account: business data, roles and other accounts stay as they are. */
  const finishRecovery=async(account:Account,password:string,method:'key'|'ticket',ticketFingerprint?:string):Promise<KeyResult>=>{
    if(recoveryPending.current)return {ok:false,message:'Tiklash jarayoni davom etmoqda'}
    recoveryPending.current=true
    try{
    const recoveryKey=newRecoveryKey()
    const out=Auth.recoverPassword(authRef.current,{now:new Date(),id:uid},account.id,{credential:await makeCredential(password),recovery:await makeCredential(normalizeRecoveryKey(recoveryKey)),method})
    if(out.error!==undefined)return {ok:false,message:out.error}
    const stored=Auth.normalizeAuthStore(storage.get(AUTH_KEY,null))
    if(ticketFingerprint&&stored.consumedRecoveryTickets?.includes(ticketFingerprint))return {ok:false,message:'Bu tiklash chiptasi allaqachon ishlatilgan'}
    if(!commitAuth({...out.store,consumedRecoveryTickets:ticketFingerprint?[...(stored.consumedRecoveryTickets||[]),ticketFingerprint].slice(-1000):stored.consumedRecoveryTickets}))return {ok:false,message:'Tiklash holati saqlanmadi'}
    return {ok:true,message:out.message,recoveryKey}
    }finally{recoveryPending.current=false}
  }

  const recoveryOwner=(account:Account|undefined):string|null=>{
    if(!account||account.status!=='active')return 'Bu yo‘l faqat faol biznes egasi uchun'
    for(const membership of saasRef.current.memberships.filter(m=>m.accountId===account.id&&m.status==='active')){
      if(!saasRef.current.tenants.some(t=>t.id===membership.tenantId&&t.status==='active'))continue
      const key=SaaS.tenantStateKey(membership.tenantId)
      let candidate:ManufacturingState|null=null
      try{candidate=key?parseStored(storage.getRaw(key)||''):null}catch{candidate=null}
      if(candidate&&!Auth.signInBlocker(candidate,account,membership.employeeId)&&isOwnerRole(roleOf(candidate,membership.employeeId)))return null
    }
    return 'Bu yo‘l faqat faol biznes egasi uchun'
  }

  const recoverWithKey=async(loginName:string,key:string,password:string):Promise<KeyResult>=>{
    const fail=(message:string):KeyResult=>({ok:false,message})
    if(!loginName.trim()||!key.trim())return fail('Login va tiklash kalitini kiriting')
    const weak=Auth.validatePassword(policyFor(),password)
    if(weak)return fail(weak)
    const attempt=Auth.recoveryAttemptKey(loginName)
    const locked=Auth.lockState(authRef.current,attempt,new Date())
    if(locked)return fail(`Juda ko‘p noto‘g‘ri urinish — ${hhmm(new Date(locked))} dan keyin qayta urinib ko‘ring`)
    const account=Auth.findAccount(authRef.current,loginName)
    // Same hashing time with or without an account or a key, as in login.
    const valid=account?.recovery?await verifyPassword(normalizeRecoveryKey(key),account.recovery):(await hashPassword(key,randomSalt(),PBKDF2_ITERATIONS),false)
    if(!valid||!account){commitAuth(Auth.recordFailure(authRef.current,{now:new Date(),id:uid},attempt));return fail('Login yoki tiklash kaliti noto‘g‘ri')}
    const blocked=recoveryOwner(account)
    return blocked?fail(blocked):finishRecovery(account,password,'key')
  }

  const recoverWithTicket=async(loginName:string,ticket:string,code:string,password:string):Promise<KeyResult>=>{
    const fail=(message:string):KeyResult=>({ok:false,message})
    if(!recoveryPublicKey)return fail('Bu versiyada egasi tiklashi sozlanmagan')
    if(!loginName.trim()||!ticket.trim())return fail('Login va chiptani kiriting')
    const weak=Auth.validatePassword(policyFor(),password)
    if(weak)return fail(weak)
    // Checked first: whether a login exists is told only to someone holding a valid ticket.
    const login=Auth.normalizeLogin(loginName)
    if(!await verifyRecoveryTicket(recoveryPublicKey,ticket,expiresAt=>Auth.recoveryTicketMessage(login,code,expiresAt),Date.now()))return fail('Chipta noto‘g‘ri yoki muddati o‘tgan')
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${login}|${ticket.trim()}`))
    const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')
    if(Auth.normalizeAuthStore(storage.get(AUTH_KEY,null)).consumedRecoveryTickets?.includes(fingerprint))return fail('Bu tiklash chiptasi allaqachon ishlatilgan')
    const account=Auth.findAccount(authRef.current,loginName)
    const blocked=recoveryOwner(account)
    return blocked||!account?fail(blocked||'Akkaunt topilmadi'):finishRecovery(account,password,'ticket',fingerprint)
  }

  const createRecoveryKey=async(password:string):Promise<KeyResult>=>{
    const account=authRef.current.accounts.find(a=>a.id===sessionRef.current?.accountId)
    if(!account)return {ok:false,message:'Avval tizimga kiring'}
    if(!await verifyPassword(password,account))return {ok:false,message:'Joriy parol noto‘g‘ri'}
    const recoveryKey=newRecoveryKey()
    const out=authResult(Auth.setRecoveryKey(scopedAuth(),stateRef.current,authCtx(),account.id,await makeCredential(normalizeRecoveryKey(recoveryKey))),true,true)
    return out.ok?{...out,recoveryKey}:out
  }

  const changePassword=async(current:string,next:string):Promise<ActionResult>=>{
    const account=authRef.current.accounts.find(a=>a.id===sessionRef.current?.accountId)
    if(!account)return {ok:false,message:'Avval tizimga kiring'}
    if(!await verifyPassword(current,account))return {ok:false,message:'Joriy parol noto‘g‘ri'}
    if(current===next)return {ok:false,message:'Yangi parol eskisidan farq qilsin'}
    const weak=Auth.validatePassword(policyFor(),next)
    if(weak)return {ok:false,message:weak}
    const out=authResult(Auth.changeOwnPassword(authRef.current,authCtx(),account.id,await makeCredential(next)))
    // Older sessions end with the old password; this one continues under the new one.
    if(out.ok&&sessionRef.current)commitSession({...sessionRef.current,startedAt:new Date().toISOString(),lastActivity:new Date().toISOString()})
    return out
  }

  const createUser=async(p:{employeeId:string;username:string;email?:string;password:string;mustChangePassword?:boolean}):Promise<ActionResult>=>{
    const denied=needs([['users','create']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    const weak=Auth.validatePassword(policyFor(),p.password);if(weak)return {ok:false,message:weak}
    if(!tenant)return {ok:false,message:'Faol kompaniya topilmadi'}
    const subscription=SaaS.subscriptionFor(saasRef.current,tenant.id)
    if(!SaaS.subscriptionActive(subscription,new Date()))return {ok:false,message:'Obuna faol emas'}
    const limit=SaaS.limitBlocker(stateRef.current,saasRef.current,tenant.id,'employees');
    // An employee profile already counted toward the limit; account activation does not add another employee.
    if(limit&&stateRef.current.employees.filter(e=>e.status!=='Arxiv').length>SaaS.PLAN_CATALOG[SaaS.subscriptionFor(saasRef.current,tenant.id)?.planId||'free'].maxEmployees)return {ok:false,message:limit}
    if(Auth.findAccount(authRef.current,p.username)||p.email&&Auth.findAccount(authRef.current,p.email))return {ok:false,message:'Bu login yoki e-pochta band'}
    const out=Auth.createAccount(scopedAuth(),stateRef.current,authCtx(),{employeeId:p.employeeId,username:p.username,email:p.email,mustChangePassword:true,credential:await makeCredential(p.password)})
    if(out.error!==undefined)return {ok:false,message:out.error}
    const member={id:uid('membership'),tenantId:tenant.id,accountId:out.id!,employeeId:p.employeeId,status:'active' as const,createdAt:new Date().toISOString()}
    const previous=saasRef.current
    if(!commitSaaS({...previous,memberships:[...previous.memberships,member]}))return {ok:false,message:'A’zolik saqlanmadi'}
    const result=authResult(out,false,true)
    if(!result.ok)commitSaaS(previous)
    return result
  }
  const updateUser=(accountId:string,patch:{username?:string;email?:string})=>{
    const self=scopedAuth().accounts.find(a=>a.id===accountId)?.employeeId===me()
    const denied=self?null:needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    if(sharedAccount(accountId)&&!self)return {ok:false,message:'Bu akkaunt boshqa kompaniyada ham ishlatiladi; global loginini faqat egasi o‘zgartiradi'}
    if(patch.username&&Auth.findAccount(authRef.current,patch.username)?.id!==accountId&&Auth.findAccount(authRef.current,patch.username))return {ok:false,message:'Bu login band'}
    if(patch.email&&Auth.findAccount(authRef.current,patch.email)?.id!==accountId&&Auth.findAccount(authRef.current,patch.email))return {ok:false,message:'Bu e-pochta boshqa akkauntda'}
    return authResult(Auth.updateAccount(scopedAuth(),stateRef.current,authCtx(),accountId,patch),false,true)
  }
  const setUserStatus=(accountId:string,status:Account['status'])=>{
    const denied=needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    if(sharedAccount(accountId)){
      const out=Auth.setAccountStatus(scopedAuth(true),stateRef.current,authCtx(),accountId,status)
      if(out.error!==undefined)return {ok:false,message:out.error}
      if(status==='active'&&authRef.current.accounts.find(a=>a.id===accountId)?.status!=='active')return {ok:false,message:'Global akkaunt bloklangan'}
      const event:SaaS.SaaSEvent={id:uid('saas-event'),tenantId,actorAccountId:sessionRef.current?.accountId,action:status==='active'?'membership.activate':'membership.disable',targetId:accountId,at:new Date().toISOString(),result:'success'}
      const next={...saasRef.current,memberships:saasRef.current.memberships.map(m=>m.tenantId===tenantId&&m.accountId===accountId?{...m,status:status==='active'?'active' as const:'disabled' as const}:m),events:[event,...saasRef.current.events].slice(0,SaaS.SAAS_EVENT_LIMIT)}
      if(!commitSaaS(next))return {ok:false,message:'A’zolik holati saqlanmadi'}
      return {ok:true,message:'Kompaniya a’zoligi yangilandi'}
    }
    return authResult(Auth.setAccountStatus(scopedAuth(),stateRef.current,authCtx(),accountId,status),false,true)
  }
  const resetUserPassword=async(accountId:string,password:string):Promise<ActionResult>=>{
    const denied=needs([['users','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    if(sharedAccount(accountId))return {ok:false,message:'Boshqa kompaniyada ham ishlatiladigan akkaunt parolini tenant administratori o‘zgartira olmaydi'}
    const weak=Auth.validatePassword(policyFor(),password);if(weak)return {ok:false,message:weak}
    return authResult(Auth.resetPassword(scopedAuth(),stateRef.current,authCtx(),accountId,await makeCredential(password)),false,true)
  }
  const deleteUser=(accountId:string)=>{
    const denied=needs([['users','delete']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    if(sharedAccount(accountId)){
      const out=Auth.deleteAccount(scopedAuth(),stateRef.current,authCtx(),accountId)
      if(out.error!==undefined)return {ok:false,message:out.error}
      const event:SaaS.SaaSEvent={id:uid('saas-event'),tenantId,actorAccountId:sessionRef.current?.accountId,action:'membership.remove',targetId:accountId,at:new Date().toISOString(),result:'success'}
      const next={...saasRef.current,memberships:saasRef.current.memberships.map(m=>m.tenantId===tenantId&&m.accountId===accountId?{...m,status:'disabled' as const}:m),events:[event,...saasRef.current.events].slice(0,SaaS.SAAS_EVENT_LIMIT)}
      return commitSaaS(next)?{ok:true,message:'Faqat shu kompaniyadagi kirish olib tashlandi'}:{ok:false,message:'A’zolik saqlanmadi'}
    }
    const result=authResult(Auth.deleteAccount(scopedAuth(),stateRef.current,authCtx(),accountId),false,true)
    if(result.ok)commitSaaS({...saasRef.current,memberships:saasRef.current.memberships.map(m=>m.tenantId===tenantId&&m.accountId===accountId?{...m,status:'disabled' as const}:m)})
    return result
  }
  const updateSecurityPolicy=(patch:Partial<SecurityPolicy>)=>{
    const denied=needs([['settings','edit']]);if(denied){pushToast(denied,'danger');return {ok:false,message:denied}}
    return authResult(Auth.updatePolicy(scopedAuth(),authCtx(),patch),false,true)
  }

  // A session ends when it expires, sits idle too long, or its account/employee is blocked — checked on a timer and on every change.
  useEffect(()=>{
    const check=()=>{
      const current=sessionRef.current
      if(!current)return
      if(!sessionCurrent())return
      const problem=Auth.sessionProblem(current,authFor(),stateRef.current,new Date())
      if(problem)logout(problem)
      else if(!saasRef.current.memberships.some(m=>m.tenantId===(current.tenantId||SaaS.LEGACY_TENANT_ID)&&m.tenantId===tenantId&&m.accountId===current.accountId&&m.employeeId===current.employeeId&&m.status==='active'&&saasRef.current.tenants.some(t=>t.id===m.tenantId&&t.status==='active')))logout('blocked')
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
      if(!sessionCurrent())return
      const now=new Date()
      if(now.getTime()-new Date(current.lastActivity).getTime()<30000)return
      commitSession({...current,lastActivity:now.toISOString()})
    }
    const events=['pointerdown','keydown','wheel','touchstart'] as const
    for(const e of events)window.addEventListener(e,touch,{passive:true})
    // Accounts and the session are shared by all tabs of this browser.
    const synced=(e:StorageEvent)=>{
      if(e.key===AUTH_KEY){const next=Auth.normalizeAuthStore(parseJson(e.newValue));authDamaged.current=Auth.authStorageDamaged(e.newValue);authRef.current=next;setAuth(next)}
      if(e.key===SAAS_KEY){const next=SaaS.normalizeSaaSStore(parseJson(e.newValue));saasDamaged.current=!next;if(hasDirtyForms()&&authorizedStoredTenantId()!==tenantId)return;if(next){saasRef.current=next;setSaaS(next)}}
      if(e.key===SESSION_KEY){
        const next=Auth.normalizeSession(parseJson(e.newValue))
        if(!sameSessionIdentity(sessionRef.current,next)&&hasDirtyForms())return
        if(!next&&sessionRef.current){sessionRef.current=null;setSession(null);setAuthNotice(NOTICE.elsewhere)}
        else if(next){sessionRef.current=next;setSession(next)}
      }
    }
    window.addEventListener('storage',synced)
    return()=>{for(const e of events)window.removeEventListener(e,touch);window.removeEventListener('storage',synced)}
  },[sessionCurrent,tenantId])

  const account=session?auth.accounts.find(a=>a.id===session.accountId)||null:null
  const setupBlocked=auth.accounts.length?null:saasDamaged.current?'Kompaniya yozuvi shikastlangan — yangisi yaratilmaydi':saas.tenants.length?'Kompaniya allaqachon mavjud; akkaunt yozuvlari topilmadi — yangi egasi yaratilmaydi':Auth.bootstrapBlocker(auth,state,storage.getRaw(AUTH_KEY),Boolean(storage.getRaw(dataKey)))
  const visibleEmployeeIds=new Set(view.employees.map(e=>e.id))
  const visibleMembers=saas.memberships.filter(m=>m.tenantId===tenantId&&visibleEmployeeIds.has(m.employeeId))
  const visibleIds=new Set(visibleMembers.map(m=>m.accountId))
  const visibleAccounts=auth.accounts.filter(a=>visibleIds.has(a.id)).map(a=>{const member=visibleMembers.find(m=>m.accountId===a.id)!;return {...a,employeeId:member.employeeId,status:member.status==='active'?a.status:'blocked' as const}})
  const visibleEvents=auth.events.filter(e=>e.tenantId?e.tenantId===tenantId&&Boolean(e.accountId&&visibleIds.has(e.accountId)||currentRole.scope==='all'):tenantId===SaaS.LEGACY_TENANT_ID&&(e.accountId?visibleIds.has(e.accountId):currentRole.scope==='all'&&saas.tenants.length<=1))
  const registrationPolicy=Platform.registrationPolicy(storage.get(Platform.PLATFORM_KEY,null))
  const authInfo={needsSetup:!auth.accounts.length,setupBlocked,signedOut:authNotice===NOTICE.logout,registration:{open:registrationPolicy.open||!auth.accounts.length||!saas.tenants.length,trialDays:registrationPolicy.trialDays},ownerRecovery:Boolean(recoveryPublicKey),signedIn:Boolean(sessionValid&&account&&tenant),session,account,accounts:visibleAccounts,events:visibleEvents,policy:auth.policies?.[tenantId]||auth.policy,notice:authNotice}
  const sub=tenant?SaaS.subscriptionFor(saas,tenant.id)||null:null
  const availableTenants=account?saas.tenants.filter(t=>t.status==='active'&&saas.memberships.some(m=>m.tenantId===t.id&&m.accountId===account.id&&m.status==='active')):[]
  const saasInfo={tenant,availableTenants,subscription:sub,plan:sub?SaaS.PLAN_CATALOG[sub.planId]:null,usage:SaaS.usage(state),plans:SaaS.PLAN_CATALOG}
  const switchTenant=(nextId:string):ActionResult=>{
    const current=sessionRef.current
    if(!sessionCurrent())return {ok:false,message:'Sessiya boshqa oynada o‘zgardi — sahifani yangilang'}
    if(Auth.sessionProblem(current,authFor(),stateRef.current,new Date())||!current)return {ok:false,message:'Avval qayta tizimga kiring'}
    if(nextId===tenantId)return {ok:true,message:'Kompaniya allaqachon faol'}
    const nextTenant=saasRef.current.tenants.find(t=>t.id===nextId&&t.status==='active')
    const membership=saasRef.current.memberships.find(m=>m.tenantId===nextId&&m.accountId===current.accountId&&m.status==='active')
    if(!nextTenant||!membership)return {ok:false,message:'Bu kompaniyaga faol a’zolik yo‘q'}
    const key=SaaS.tenantStateKey(nextId)
    let nextState:ManufacturingState|null=null
    try{nextState=key?parseStored(storage.getRaw(key)||''):null}catch{nextState=null}
    if(!nextState)return {ok:false,message:'Kompaniya ma’lumoti topilmadi yoki o‘qib bo‘lmadi'}
    const target=authRef.current.accounts.find(a=>a.id===current.accountId)
    if(!target)return {ok:false,message:'Akkaunt topilmadi'}
    const blocked=Auth.signInBlocker(nextState,target,membership.employeeId)
    if(blocked)return {ok:false,message:blocked}
    commitSession({...current,tenantId:nextId,employeeId:membership.employeeId,lastActivity:new Date().toISOString()})
    onTenantChange(nextId)
    return {ok:true,message:`${nextTenant.name} ish maydoni ochildi`}
  }
  const changePlan=(plan:SaaS.PlanId):ActionResult=>{
    if(!allowed([['subscription','edit']])||!tenant||!account||!SaaS.PLAN_CATALOG[plan])return {ok:false,message:'Obunani faqat biznes egasi o‘zgartira oladi'}
    const changed=SaaS.changePlan(saasRef.current,tenant.id,plan,account.id,new Date())
    if(changed===saasRef.current)return {ok:false,message:'Reja o‘zgartirilmadi — obuna faol emas yoki yuqori reja uchun to‘lov tasdig‘i kerak'}
    if(!commitSaaS(changed))return {ok:false,message:'Obuna saqlanmadi'}
    return {ok:true,message:'Demo obuna yangilandi; to‘lov olinmadi'}
  }

  const value=useMemo<AppContextValue>(()=>({
    ...domain,state:view,resolvedTheme,toasts,dismissToast,sidebarMobile,setSidebarMobile,searchOpen,setSearchOpen,notifOpen,setNotifOpen,aiOpen,setAiOpen,
    currentEmployee,currentRole,can,toast,saveSettings,setPreferences,setTheme,setAppearance,setCurrency,resetTransactions,importState,importPrivilegedState,restoreLastBackup,lastBackup,markAllRead,markNotificationRead,activityArchive,
    recovery,startClean,recoveryCopies,storageError,storageUsage:()=>{const u=storage.usage(dataKey);return {data:u.key,total:u.total}},
    createEntity,updateEntity,deleteEntity,duplicateEntity,addAttachment,removeAttachment,saveSupplier,
    auth:authInfo,saas:saasInfo,switchTenant,changePlan,login,logout,clearAuthNotice:()=>setAuthNotice(''),setupSuperAdmin,recoverWithKey,recoverWithTicket,createRecoveryKey,changePassword,createUser,updateUser,setUserStatus,resetUserPassword,deleteUser,updateSecurityPolicy,
  // Actions read the latest state through stateRef, so re-creating them only when state changes is sufficient.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[view,resolvedTheme,toasts,sidebarMobile,searchOpen,notifOpen,aiOpen,currentEmployee,currentRole,can,toast,dismissToast,authInfo,saas,tenant,sub,recovery,storageError])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(){const v=useContext(Ctx);if(!v)throw new Error('useApp must be inside AppProvider');return v}
