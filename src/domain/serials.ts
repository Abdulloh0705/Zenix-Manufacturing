import type {LotRecord,ManufacturingState as S,StockMovement} from '../types'
import {keyOf} from './inventory'

/*
 * Serial-number traceability (audit #25). A serial unit is a lot record of kind 'serial' holding one unit
 * (serialFrom === serialTo === code), so the existing lot engine — FEFO, pins, QC status, bins, transfers, returns —
 * moves it like any lot and nothing here keeps a second inventory. A unit's place is the record that holds it now
 * (quantity 1); where it went is read from the immutable ledger rows written with its number.
 * Serial records written before unit tracking cover a range with one quantity: which numbers are still in stock is
 * unknown, so they are reported as a legacy range and never split into invented units.
 */

export const isSerialUnit=(l:Pick<LotRecord,'kind'|'serialFrom'|'serialTo'|'code'>)=>l.kind==='serial'&&(!l.serialFrom||l.serialFrom===l.serialTo)&&(!l.serialFrom||l.serialFrom===l.code)
export const isLegacyRange=(l:Pick<LotRecord,'kind'|'serialFrom'|'serialTo'|'code'>)=>l.kind==='serial'&&!isSerialUnit(l)

/** Whether an item key is serial-tracked: a product with tracking 'serial' or a material with serialTracking. */
export function serialTracked(s:Pick<S,'products'|'rawMaterials'>,key:string){
  const id=key.split('~')[0]
  const p=s.products.find(x=>x.id===id)
  if(p)return p.tracking==='serial'
  return Boolean(s.rawMaterials.find(m=>m.id===id)?.serialTracking)
}

/** A record belongs to a lot code: its own code, or the receipt lot / output range a serial unit arrived in. */
export const inLot=(l:Pick<LotRecord,'code'|'batch'>,code?:string)=>Boolean(code)&&(l.code===code||l.batch===code)

export type SerialPhysical='available'|'quarantine'|'hold'|'rework'|'sold'|'consumed'|'supplier-returned'|'scrapped'|'written-off'|'unknown'
export type SerialStatus={serial:string;itemId:string;status:SerialPhysical;
  /** The record holding the unit now (in stock), else undefined. */
  record?:LotRecord;warehouseId?:string;location?:string;
  /** First record of the unit: where it came from (receipt / production) and its batch. */
  origin?:LotRecord;
  /** Every record of the unit in time order (receipt, transfers, return …). */
  records:LotRecord[];
  /** Ledger rows written with this number, oldest first. */
  history:StockMovement[];
  /** More than one record holds the unit at once — data the engine never writes; shown, never repaired here. */
  conflict?:string}

const OUT_STATUS:Record<string,SerialPhysical>={'Sale -':'sold','Material Issue -':'consumed','Subcontract -':'consumed','Unbuild -':'consumed','Supplier Return -':'supplier-returned','QC Scrap -':'scrapped','Adjustment -':'written-off'}

/** Where a serial unit is and what it is now — read from its records and ledger rows, never stored twice. */
export function serialStatus(s:Pick<S,'lots'|'stockMovements'>,serial:string,itemId?:string):SerialStatus|undefined{
  const code=serial.trim()
  const records=s.lots.filter(l=>l.kind==='serial'&&isSerialUnit(l)&&l.code===code&&(!itemId||l.itemId===itemId.split('~')[0])).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
  if(!records.length)return undefined
  const item=records[0].itemId
  const history=s.stockMovements.filter(m=>m.lot===code&&m.itemId===item).slice().reverse()
  const held=records.filter(l=>l.qty>1e-9)
  // The origin is the record in the store of the unit's first ledger row — not a transfer copy or a return record.
  const first=history[0]
  const origin=records.find(l=>l.sourceType!=='return'&&(!first||l.warehouseId===first.warehouseId))||records.find(l=>l.sourceType!=='return')||records[0]
  const base={serial:code,itemId:item,origin,records,history}
  if(held.length>1)return {...base,status:'unknown',conflict:`${code}: ${held.length} ta yozuvda bir vaqtda turibdi (${held.map(l=>l.warehouseId).join(', ')})`}
  if(held.length===1){const r=held[0];return {...base,status:(r.status||'available') as SerialPhysical,record:r,warehouseId:r.warehouseId,...(r.location?{location:r.location}:{})}}
  const last=[...history].reverse().find(m=>m.qty<0)
  return {...base,status:last?OUT_STATUS[last.type]||(last.type.includes('Scrap')?'scrapped':'written-off'):'unknown'}
}

/** Units of an item that are in stock right now (quantity 1), one row each. */
export const serialUnitsInStock=(s:Pick<S,'lots'>,key?:string)=>s.lots.filter(l=>l.kind==='serial'&&isSerialUnit(l)&&l.qty>1e-9&&(!key||keyOf(l)===key))

/**
 * Why a serial number cannot be registered now for `itemId`: it is in stock already (any store, any status), or it
 * left by sale / consumption / scrap — only a unit that went back to its supplier may come in again.
 */
export function serialConflict(s:Pick<S,'lots'|'stockMovements'>,itemId:string,serial:string):string|null{
  const st=serialStatus(s,serial,itemId)
  if(!st)return s.lots.some(l=>isLegacyRange(l)&&l.itemId===itemId.split('~')[0]&&inRange(l,serial))?`${serial}: eski serial oralig‘iga kiradi — takroriy raqam bo‘lishi mumkin`:null
  if(st.record)return `${serial}: allaqachon omborda (${st.status})`
  if(st.status==='supplier-returned')return null
  return `${serial}: avval ro‘yxatga olingan va chiqib ketgan (${st.status}) — takroriy serial qabul qilinmaydi`
}

const digits=(v:string)=>/(\d+)$/.exec(v)
function inRange(l:LotRecord,serial:string){
  if(!l.serialFrom||!l.serialTo)return false
  const a=digits(l.serialFrom),b=digits(l.serialTo),x=digits(serial)
  if(!a||!b||!x)return false
  const prefix=l.serialFrom.slice(0,a.index)
  return serial.startsWith(prefix)&&serial.length===l.serialFrom.length&&Number(x[1])>=Number(a[1])&&Number(x[1])<=Number(b[1])
}

/** Clean, de-duplicated list of typed serial numbers (comma / space / new-line separated), or why it is not one. */
export function parseSerials(input:string|string[]|undefined):{serials:string[]}|{error:string}{
  const list=(Array.isArray(input)?input:String(input||'').split(/[\s,;]+/)).map(x=>String(x).trim()).filter(Boolean)
  const seen=new Set<string>()
  for(const x of list){
    if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(x))return {error:`Serial raqam noto‘g‘ri: “${x}”`}
    if(seen.has(x))return {error:`${x} ikki marta kiritilgan`}
    seen.add(x)
  }
  return {serials:list}
}

/**
 * Serial data the engine should never hold (audit #25 integrity check): a unit in two records at once, a unit record
 * with a quantity other than 0 / 1. Legacy range records are listed apart — readable, not errors.
 */
export function serialIssues(s:Pick<S,'lots'>){
  const held=new Map<string,LotRecord[]>()
  const problems:string[]=[]
  for(const l of s.lots){
    if(l.kind!=='serial'||!isSerialUnit(l))continue
    if(l.qty<-1e-9||l.qty>1+1e-9)problems.push(`${l.code}: serial yozuvi miqdori ${l.qty}`)
    if(l.qty>1e-9){const k=`${l.itemId}|${l.code}`;held.set(k,[...(held.get(k)||[]),l])}
  }
  for(const [k,rows] of held)if(rows.length>1)problems.push(`${k.split('|')[1]}: ${rows.length} ta yozuvda bir vaqtda`)
  return {problems,legacyRanges:s.lots.filter(isLegacyRange)}
}

export const SERIAL_STATUS_LABEL:Record<SerialPhysical,string>={available:'Omborda','quarantine':'QC karantin',hold:'Hold',rework:'Rework',sold:'Sotilgan',consumed:'Sarflangan','supplier-returned':'Supplierga qaytarilgan',scrapped:'Scrap','written-off':'Hisobdan chiqarilgan',unknown:'Noma’lum'}

/** Every serial unit with its status (indexed once — the register page reads thousands without rescanning). */
export function serialRegister(s:Pick<S,'lots'|'stockMovements'>):SerialStatus[]{
  const byUnit=new Map<string,LotRecord[]>(),moves=new Map<string,StockMovement[]>()
  for(const l of s.lots)if(l.kind==='serial'&&isSerialUnit(l)){const k=`${l.itemId}|${l.code}`;byUnit.set(k,[...(byUnit.get(k)||[]),l])}
  for(const m of s.stockMovements)if(m.lot){const k=`${m.itemId}|${m.lot}`;if(byUnit.has(k))moves.set(k,[...(moves.get(k)||[]),m])}
  return [...byUnit].map(([k,records])=>serialStatus({lots:records,stockMovements:moves.get(k)||[]},records[0].code,records[0].itemId)!)
}
