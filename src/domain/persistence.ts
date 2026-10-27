// Turning stored text (localStorage, a backup file, another tab's save) into a state the app can run on.
// Order: structural repair → fill what older versions did not save → versioned migrations (migrations.ts).
// Nothing a user entered is rewritten: only entries that cannot be records are set aside, missing lists get an
// empty list, and missing numbers become 0. The caller keeps the original text whenever anything was repaired.
import type {Bom,ManufacturingState,SettingsState} from '../types'
import {migrateSupplierLinks} from './supplierMaterials'
import {SCHEMA_VERSION,migrateState} from './migrations'
import {normalizePrefs} from '../app/theme/preferences'

export type CollectionIssue={collection:string;dropped:number;repaired:number;duplicateIds:string[]}
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
 * (counted, never silently); duplicate ids are reported but kept, because either copy may be the one in use.
 */
export function repairCollections(loaded:Record<string,unknown>,seed:ManufacturingState):{state:Record<string,unknown>;issues:CollectionIssue[]}{
  const state:Record<string,unknown>={...loaded}
  const issues:CollectionIssue[]=[]
  for(const key of Object.keys(seed) as (keyof ManufacturingState)[]){
    const list=loaded[key]
    if(!Array.isArray(seed[key])||!Array.isArray(list))continue
    let dropped=0,repaired=0
    const seen=new Set<string>(),dupes=new Set<string>()
    const kept:unknown[]=[]
    for(const entry of list){
      if(!isRecord(entry)||typeof entry.id!=='string'||!entry.id){dropped+=1;continue}
      if(seen.has(entry.id))dupes.add(entry.id);else seen.add(entry.id)
      const fixed=repairRecord(key,entry)
      if(fixed)repaired+=1
      kept.push(fixed||entry)
    }
    if(dropped||repaired)state[key]=kept
    if(dropped||repaired||dupes.size)issues.push({collection:key,dropped,repaired,duplicateIds:[...dupes]})
  }
  return {state,issues}
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
export const changedRecords=(r:LoadReport)=>r.issues.some(i=>i.dropped||i.repaired)

/** One sentence for the user about what loading found; empty when there is nothing to say. */
export function describeReport(r:LoadReport):string{
  const parts:string[]=[]
  const dropped=r.issues.reduce((a,i)=>a+i.dropped,0),repaired=r.issues.reduce((a,i)=>a+i.repaired,0),dupes=r.issues.reduce((a,i)=>a+i.duplicateIds.length,0)
  if(dropped)parts.push(`${dropped} ta o‘qib bo‘lmaydigan yozuv chetga olindi`)
  if(repaired)parts.push(`${repaired} ta yozuvning yetishmayotgan maydonlari to‘ldirildi`)
  if(dupes)parts.push(`${dupes} ta takroriy ID topildi (${r.issues.filter(i=>i.duplicateIds.length).map(i=>i.collection).join(', ')})`)
  if(r.newerVersion)parts.push(`ma’lumot ilovaning yangiroq versiyasida (v${r.newerVersion}) saqlangan`)
  return parts.join('; ')
}
