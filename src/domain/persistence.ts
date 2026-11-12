// Turning stored text (localStorage, a backup file, another tab's save) into a state the app can run on.
// Order: structural repair → fill what older versions did not save → versioned migrations (migrations.ts).
// Nothing a user entered is rewritten: only entries that cannot be records are set aside, missing lists get an
// empty list, and missing numbers become 0. The caller keeps the original text whenever anything was repaired.
import type {Bom,ManufacturingState,QuarantinedRecord,SettingsState} from '../types'
import {migrateSupplierLinks} from './supplierMaterials'
import {openingEntries} from './receivables'
import {payableOpenings} from './payables'
import {stamp} from '../utils/dates'
import {SCHEMA_VERSION,migrateState} from './migrations'
import {normalizePrefs} from '../app/theme/preferences'

export type CollectionIssue={collection:string;dropped:number;repaired:number;duplicateIds:string[];
  /** Later copies of a duplicated id moved to `quarantinedRecords` (audit #14); absent on reports made before. */
  quarantined?:number}
export type LoadReport={issues:CollectionIssue[];migrations:string[];
  /** Set when the data was saved by a newer version of the app than this one. */
  newerVersion?:number}

/** Lists inside records that the pages and the engine read without a guard. */
const NESTED_LISTS:Partial<Record<keyof ManufacturingState,string[]>>={
  productionOrders:['workOrders','consumed'],purchaseOrders:['items','receipts'],salesOrders:['items'],boms:['components','operations'],
  products:['variants'],warehouses:['locations'],workCenters:['machineIds'],lots:['consumedBy'],engineeringChanges:['documents'],subcontractOrders:['materialIds'],
}
/** Quantities that feed stock and production totals: a missing value would turn every sum into NaN. */
const QUANTITIES:Partial<Record<keyof ManufacturingState,string[]>>={
  stockBalances:['onHand','reserved','incoming'],productionOrders:['quantity','completed','scrap'],lots:['qty'],stockMovements:['qty'],
}

const isRecord=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v)

/** An order saved without its BOM snapshot gets an empty, clearly marked one — never a copy of today's BOM. */
function emptySnapshot(o:Record<string,unknown>):Bom{
  return {id:String(o.bomId||''),code:'',productId:String(o.productId||''),version:String(o.bomVersion||''),revision:0,status:'Arxiv',effectiveDate:'',waste:0,components:[],operations:[],notes:'BOM snapshot saqlanmagan (tiklangan yozuv)'}
}

function repairRecord(key:keyof ManufacturingState,r:Record<string,unknown>):Record<string,unknown>|null{
  let next:Record<string,unknown>|null=null
  const set=(field:string,value:unknown)=>{next??={...r};next[field]=value}
  for(const field of NESTED_LISTS[key]||[])if(!Array.isArray(r[field]))set(field,[])
  for(const field of QUANTITIES[key]||[])if(typeof r[field]!=='number'||!Number.isFinite(r[field]))set(field,Number.isFinite(Number(r[field]))&&r[field]!==null&&r[field]!==''?Number(r[field]):0)
  if(key==='productionOrders'){
    const snap=r.bomSnapshot
    if(!isRecord(snap))set('bomSnapshot',emptySnapshot(r))
    else if(!Array.isArray(snap.components)||!Array.isArray(snap.operations))set('bomSnapshot',{...snap,components:Array.isArray(snap.components)?snap.components:[],operations:Array.isArray(snap.operations)?snap.operations:[]})
  }
  if(key==='roles'&&!isRecord(r.permissions))set('permissions',{})
  return next
}

/**
 * Structural repair of every list the seed defines. Entries that are not records with an id are set aside
 * (counted, never silently). A duplicated id is ambiguous (audit #14): every lookup by id already resolves to
 * the first copy in the list, so that copy stays in use and every later copy moves, unchanged and with its
 * collection, to `quarantinedRecords` — nothing is deleted or given a new id. Running it again changes nothing.
 */
export function repairCollections(loaded:Record<string,unknown>,seed:ManufacturingState):{state:Record<string,unknown>;issues:CollectionIssue[]}{
  const state:Record<string,unknown>={...loaded}
  const issues:CollectionIssue[]=[]
  const quarantine:QuarantinedRecord[]=Array.isArray(loaded.quarantinedRecords)?(loaded.quarantinedRecords as unknown[]).filter(isQuarantined):[]
  const known=new Set(quarantine.map(q=>quarantineKey(q.collection,q.record)))
  let added=0
  for(const key of Object.keys(seed) as (keyof ManufacturingState)[]){
    const list=loaded[key]
    if(!Array.isArray(seed[key])||!Array.isArray(list))continue
    let dropped=0,repaired=0,quarantined=0
    const seen=new Set<string>(),dupes=new Set<string>()
    const kept:unknown[]=[]
    for(const entry of list){
      if(!isRecord(entry)||typeof entry.id!=='string'||!entry.id){dropped+=1;continue}
      if(seen.has(entry.id)){
        dupes.add(entry.id);quarantined+=1
        const k=quarantineKey(key,entry)
        if(!known.has(k)){known.add(k);added+=1;quarantine.push({collection:key,id:entry.id,reason:'duplicate-id',record:entry})}
        continue
      }
      seen.add(entry.id)
      const fixed=repairRecord(key,entry)
      if(fixed)repaired+=1
      kept.push(fixed||entry)
    }
    if(dropped||repaired||quarantined)state[key]=kept
    if(dropped||repaired||dupes.size)issues.push({collection:key,dropped,repaired,duplicateIds:[...dupes],quarantined})
  }
  if(added)state.quarantinedRecords=quarantine
  return {state,issues}
}

const isQuarantined=(v:unknown):v is QuarantinedRecord=>isRecord(v)&&typeof v.collection==='string'&&isRecord(v.record)
const quarantineKey=(collection:string,record:unknown)=>`${collection}\u0000${JSON.stringify(record)}`

/** The saved schema version when it is newer than this build understands (audit #8); undefined otherwise. */
export function newerSchema(v:unknown):number|undefined{
  const saved=isRecord(v)?v.schemaVersion:undefined
  return typeof saved==='number'&&saved>SCHEMA_VERSION?saved:undefined
}

/** True when stored text holds data of a newer schema: this build must neither load nor overwrite it. */
export function isNewerSchemaText(raw:string|null):boolean{
  if(!raw)return false
  try{return newerSchema(JSON.parse(raw))!==undefined}catch{return false}
}

export class NonFiniteNumberError extends Error{
  constructor(public field:string,public value:number){super(`${field||'qiymat'} = ${value}: saqlab bo‘lmaydigan son`)}
}

/**
 * JSON for durable storage. Plain JSON.stringify writes NaN and ±Infinity as null, which would come back as
 * a different number (or a crash) on the next load; here such a value stops the save instead (audit #1).
 */
export function strictStringify(value:unknown):string{
  return JSON.stringify(value,function(this:Record<string,unknown>,key:string,v:unknown){
    if(typeof v==='number'&&!Number.isFinite(v))throw new NonFiniteNumberError(typeof this?.id==='string'?`${this.id}.${key}`:key,v)
    return v
  })
}

/** Merges stored data over the current seed: lists added by later versions start empty, settings gain new defaults. */
export function normalizeLoaded(loaded:Partial<ManufacturingState>,seed:ManufacturingState):ManufacturingState{
  const merged={...seed,...loaded} as ManufacturingState
  // The seed is always current; the saved version decides which migrations still have to run.
  merged.schemaVersion=loaded.schemaVersion
  for(const key of Object.keys(seed) as (keyof ManufacturingState)[]){
    if(Array.isArray(seed[key])&&!Array.isArray(merged[key]))(merged as unknown as Record<string,unknown>)[key]=seed[key]
  }
  // Saved before supplier ↔ material links existed: rebuild them from the relationships that data confirms.
  if(!Array.isArray(loaded.supplierMaterials))merged.supplierMaterials=migrateSupplierLinks(merged)
  // Saved before the receivables ledger (audit #19): each customer's stored debt becomes its opening entry, so the
  // balance stays the same and from now on changes only through ledger entries.
  if(!Array.isArray(loaded.receivables))merged.receivables=openingEntries(merged.customers,stamp(new Date()))
  if(!Array.isArray(loaded.payables))merged.payables=payableOpenings(merged.suppliers,stamp(new Date()))
  const s=(isRecord(loaded.settings)?loaded.settings:undefined) as Partial<SettingsState>|undefined
  const part=<T,>(v:T|undefined)=>(isRecord(v)?v:{}) as Partial<T>
  merged.settings={...seed.settings,...(s||{}),notifications:{...seed.settings.notifications,...part(s?.notifications)},ai:{...seed.settings.ai,...part(s?.ai)},company:{...seed.settings.company,...part(s?.company)},policies:{...seed.settings.policies,...part(s?.policies)}}
  // Saved appearance values from older builds (renamed families, missing density) migrate to supported ones.
  merged.settings={...merged.settings,...normalizePrefs(merged.settings)}
  return merged
}

/** True when parsed text has the shape of ZENIX business data at all (anything else is "unreadable"). */
export function looksLikeState(v:unknown):v is Partial<ManufacturingState>{
  return isRecord(v)&&Array.isArray(v.productionOrders)
}

/** Repair → normalize → migrate. Throws only on data so broken that no state can be built from it. */
export function prepareStored(loaded:Partial<ManufacturingState>,seed:ManufacturingState):{state:ManufacturingState;report:LoadReport}{
  const {state:repaired,issues}=repairCollections(loaded as Record<string,unknown>,seed)
  const {state,applied}=migrateState(normalizeLoaded(repaired as Partial<ManufacturingState>,seed))
  const saved=typeof loaded.schemaVersion==='number'?loaded.schemaVersion:undefined
  return {state,report:{issues,migrations:applied,newerVersion:saved!==undefined&&saved>SCHEMA_VERSION?saved:undefined}}
}

/** True when the report describes records that were changed or set aside (a copy of the original must be kept). */
export const changedRecords=(r:LoadReport)=>r.issues.some(i=>i.dropped||i.repaired||i.quarantined)

/** One sentence for the user about what loading found; empty when there is nothing to say. */
export function describeReport(r:LoadReport):string{
  const parts:string[]=[]
  const dropped=r.issues.reduce((a,i)=>a+i.dropped,0),repaired=r.issues.reduce((a,i)=>a+i.repaired,0),dupes=r.issues.reduce((a,i)=>a+i.duplicateIds.length,0)
  if(dropped)parts.push(`${dropped} ta o‘qib bo‘lmaydigan yozuv chetga olindi`)
  if(repaired)parts.push(`${repaired} ta yozuvning yetishmayotgan maydonlari to‘ldirildi`)
  const quarantined=r.issues.reduce((a,i)=>a+(i.quarantined||0),0)
  if(dupes)parts.push(`${dupes} ta takroriy ID topildi (${r.issues.filter(i=>i.duplicateIds.length).map(i=>i.collection).join(', ')})${quarantined?` — birinchi nusxa ishlatiladi, qolgan ${quarantined} tasi karantinga olindi`:''}`)
  if(r.newerVersion)parts.push(`ma’lumot ilovaning yangiroq versiyasida (v${r.newerVersion}) saqlangan`)
  return parts.join('; ')
}
