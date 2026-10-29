// Physical stock identity (audit #15) and warehouse locations (audit #17).
//
// A stock key names one physical item: the item id, or `productId~variantId` for a variant of a product whose
// variants are stock-tracked. Balances, lots, reservations and the ledger store the item id and the variant id in
// their own fields; the engine compares rows by key, so variant A stock can never satisfy variant B demand and
// legacy rows without a variant stay on the product's own key (unassigned to any variant) until reconciled.
//
// Locations are a breakdown of one balance, not a second ledger: `bins` holds on-hand per location and the rest
// (onHand − Σbins) is unassigned. Warehouse totals therefore always equal their location aggregate.
import type {LotRecord,ManufacturingState,StockBalance} from '../types'

type S=ManufacturingState
const q3=(n:number)=>Math.round(n*1000)/1000
export const VARIANT_SEP='~'

export const stockKey=(itemId:string,variantId?:string)=>variantId?`${itemId}${VARIANT_SEP}${variantId}`:itemId
export function splitKey(key:string):{itemId:string;variantId?:string}{
  const i=key.indexOf(VARIANT_SEP)
  return i<0?{itemId:key}:{itemId:key.slice(0,i),variantId:key.slice(i+1)}
}
/** Key of a stored row (balance, lot, movement). */
export const keyOf=(r:{itemId:string;variantId?:string})=>stockKey(r.itemId,r.variantId)
export const baseId=(key:string)=>splitKey(key).itemId

export const hasVariantStock=(s:Pick<S,'products'>,productId:string)=>Boolean(s.products.find(p=>p.id===productId)?.variantStock)
/** The physical item a document line means: its variant when the product tracks variant stock, else the product. */
export const itemKeyFor=(s:Pick<S,'products'>,productId:string,variantId?:string)=>variantId&&hasVariantStock(s,productId)?stockKey(productId,variantId):productId

/* ------------------------------------------------------------ bins -- */

export const binTotal=(b:Pick<StockBalance,'bins'>|undefined)=>q3(Object.values(b?.bins||{}).reduce((a,v)=>a+v,0))
/** On-hand not assigned to any location (legacy stock and receipts without a bin). */
export const unassignedQty=(b:Pick<StockBalance,'onHand'|'bins'>|undefined)=>b?q3(Math.max(0,b.onHand-binTotal(b))):0
/** On hand in one location; '' = unassigned. */
export const binQty=(b:Pick<StockBalance,'onHand'|'bins'>|undefined,location:string)=>location?q3(b?.bins?.[location]||0):unassignedQty(b)

/** Lot records of one item key in one store and location ('' = unassigned), with stock left. */
export const lotsAt=(s:Pick<S,'lots'>,warehouseId:string,key:string,location:string)=>
  s.lots.filter(l=>l.warehouseId===warehouseId&&keyOf(l)===key&&(l.location||'')===location&&l.qty>1e-9)
const lotSum=(rows:LotRecord[])=>q3(rows.reduce((a,l)=>a+Math.max(0,l.qty),0))

/** Stock in one location that no lot record accounts for — what an untracked deduction may take there. */
export const untrackedAt=(s:Pick<S,'lots'|'stockBalances'>,b:StockBalance,location:string)=>q3(Math.max(0,binQty(b,location)-lotSum(lotsAt(s,b.warehouseId,keyOf(b),location))))

/** Locations of a balance with stock, unassigned first ('' key). */
export function locationRows(b:StockBalance){
  const rows=[{location:'',qty:unassignedQty(b)}]
  for(const [location,qty] of Object.entries(b.bins||{}).sort(([a],[c])=>a.localeCompare(c)))if(qty>1e-9)rows.push({location,qty:q3(qty)})
  return rows
}

/* ------------------------------------------------- reconciliation -- */

export type IntegrityIssue={kind:'bins-exceed'|'bin-negative'|'bin-unknown'|'lot-location'|'variant-unassigned'|'legacy-reservation';warehouseId:string;itemKey:string;qty:number;text:string;
  /** The document holding a legacy reservation. */
  ref?:{kind:'mo'|'so';id:string;code:string}}

/**
 * What needs explicit reconciliation — never repaired automatically: bins that disagree with the balance, lots in a
 * location the bins do not cover, product stock of a variant-tracked product that no variant owns (legacy), and
 * reservations of lot-tracked items that hold no lot (legacy, before lot pins).
 */
export function inventoryIssues(s:S,lotTracked:(itemKey:string)=>boolean,derived?:(o:S['productionOrders'][number])=>{materialId:string;warehouseId:string;qty:number}[]):IntegrityIssue[]{
  const out:IntegrityIssue[]=[]
  const wh=(id:string)=>s.warehouses.find(w=>w.id===id)
  for(const b of s.stockBalances){
    const key=keyOf(b),w=wh(b.warehouseId)
    for(const [loc,qty] of Object.entries(b.bins||{})){
      if(qty<-1e-9)out.push({kind:'bin-negative',warehouseId:b.warehouseId,itemKey:key,qty,text:`${loc}: manfiy qoldiq`})
      if(qty>1e-9&&!w?.locations.includes(loc))out.push({kind:'bin-unknown',warehouseId:b.warehouseId,itemKey:key,qty,text:`${loc} joyi ${w?.name||b.warehouseId} omborida yo‘q`})
    }
    if(binTotal(b)>b.onHand+1e-6)out.push({kind:'bins-exceed',warehouseId:b.warehouseId,itemKey:key,qty:q3(binTotal(b)-b.onHand),text:'Joylar yig‘indisi ombor qoldig‘idan katta'})
    for(const loc of new Set(s.lots.filter(l=>l.warehouseId===b.warehouseId&&keyOf(l)===key&&l.location&&l.qty>1e-9).map(l=>l.location!))){
      const lots=lotSum(lotsAt(s,b.warehouseId,key,loc))
      if(lots>binQty(b,loc)+1e-6)out.push({kind:'lot-location',warehouseId:b.warehouseId,itemKey:key,qty:q3(lots-binQty(b,loc)),text:`${loc}: LOT yozuvlari ${lots}, joy qoldig‘i ${binQty(b,loc)}`})
    }
    if(!b.variantId&&b.onHand>1e-9&&hasVariantStock(s,b.itemId))out.push({kind:'variant-unassigned',warehouseId:b.warehouseId,itemKey:key,qty:q3(b.onHand),text:'Variant aniqlanmagan eski qoldiq — variantga biriktiring'})
  }
  const legacy=(warehouseId:string,itemKey:string,row:{qty:number;lots?:{qty:number}[];untracked?:number},ref:NonNullable<IntegrityIssue['ref']>)=>{
    const gap=legacyGap(row,lotTracked(itemKey))
    if(gap>1e-6)out.push({kind:'legacy-reservation',warehouseId,itemKey,qty:gap,text:`${ref.code}: ${gap} LOT’siz eski rezerv`,ref})
  }
  // Orders saved before per-order reservations hold derived rows without lots: listed by the caller's `derived` rows.
  for(const o of s.productionOrders)if(o.materialReserved&&!['Yakunlangan','Bekor qilingan'].includes(o.status))for(const r of (o.reservations||derived?.(o)||[]))legacy(r.warehouseId,r.materialId,r,{kind:'mo',id:o.id,code:o.code})
  for(const so of s.salesOrders)if(!['Yetkazildi','Bekor'].includes(so.status))for(const i of so.items)for(const r of i.reservations?.length?i.reservations:(i.warehouseId&&i.reserved?[{warehouseId:i.warehouseId,qty:i.reserved}]:[]))legacy(r.warehouseId,itemKeyFor(s,i.productId,i.variantId),r,{kind:'so',id:so.id,code:so.code})
  return out
}

/** The part of a lot-tracked reservation row that holds neither a lot pin nor an explicit untracked quantity. */
export function legacyGap(row:{qty:number;lots?:{qty:number}[];untracked?:number},tracked:boolean){
  if(!tracked)return 0
  return q3(Math.max(0,row.qty-(row.lots||[]).reduce((a,p)=>a+p.qty,0)-(row.untracked||0)))
}
