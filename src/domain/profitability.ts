import type {ManufacturingState,StockMovement} from '../types'
import {actualOrderCost,costInputGaps,lotOrigin} from './manufacturingEngine'

const money=(n:number)=>Math.round(n*100)/100

/** Delivery freezes a released QC LOT's cost even when its MO has not yet been closed. */
export function deliveredLotCost(s:ManufacturingState,productId:string,lot?:string,atDelivery=false):{unitCost:number;basis:'actual'|'estimated'|'provisional'}|undefined{
  if(!lot)return undefined
  const physical=s.lots.find(l=>l.code===lot&&l.itemId===productId)
  if(physical?.unitCost!==undefined&&physical.costBasis)return {unitCost:physical.unitCost,basis:physical.costBasis}
  const row=physical?.reworkOrderId?physical:undefined
  const origin=lotOrigin(s,row?.sourceLotCode||lot,productId)
  if(origin?.sourceType!=='production')return undefined
  const source=s.productionOrders.find(o=>o.id===origin.sourceId)
  const rework=row?.reworkOrderId?s.productionOrders.find(o=>o.id===row.reworkOrderId):undefined
  const released=(order:NonNullable<typeof source>)=>atDelivery&&order.status==='Sifat nazoratida'&&order.workOrders.every(w=>w.status==='Yakunlangan')&&(
    s.qualityChecks.some(q=>q.type==='Final'&&q.sourceType==='production'&&q.sourceId===order.id&&q.status==='Passed')||
    order.id===source?.id&&Boolean(rework&&s.qualityChecks.some(q=>q.type==='Final'&&q.sourceType==='production'&&q.sourceId===rework.id&&q.status==='Passed'))
  )
  if(!source||source.completed<=0||!source.costSnapshot&&!released(source))return undefined
  let unitCost=(source.costSnapshot?.actual.total??actualOrderCost(s,source).total)/source.completed
  let estimated=source.costSnapshot?.at==='migration-v4'||costInputGaps(s,source).length>0
  let provisional=!source.costSnapshot
  if(rework){
    if(rework.completed<=0||!rework.costSnapshot&&!released(rework))return undefined
    unitCost+=(rework.costSnapshot?.actual.total??actualOrderCost(s,rework).total)/rework.completed
    estimated ||= rework.costSnapshot?.at==='migration-v4'||costInputGaps(s,rework).length>0
    provisional ||= !rework.costSnapshot
  }
  return {unitCost:money(unitCost),basis:estimated?'estimated':provisional?'provisional':'actual'}
}

function movementCost(s:ManufacturingState,m:StockMovement){
  return m.unitCost!==undefined&&m.costBasis?{unitCost:m.unitCost,basis:m.costBasis}:deliveredLotCost(s,m.itemId,m.lot)
}

/** Net delivered sales and the exact original shipped LOT cost for returns. Unknown provenance stays visible. */
export function profitabilityByProduct(s:ManufacturingState,since:string){
  const totals=new Map<string,{qty:number;revenue:number;cogs:number;unknown:number;estimated:number;provisional:number}>()
  const add=(productId:string,qty:number,price:number,cost?:{unitCost:number;basis:'actual'|'estimated'|'provisional'})=>{
    const row=totals.get(productId)||{qty:0,revenue:0,cogs:0,unknown:0,estimated:0,provisional:0}
    row.qty+=qty;row.revenue=money(row.revenue+qty*price)
    if(cost){row.cogs=money(row.cogs+qty*cost.unitCost);if(cost.basis==='estimated')row.estimated+=Math.abs(qty);if(cost.basis==='provisional')row.provisional+=Math.abs(qty)}
    else row.unknown+=Math.abs(qty)
    totals.set(productId,row)
  }
  const shipment=(soCode:string,productId:string,variantId?:string)=>s.stockMovements.filter(m=>m.type==='Sale -'&&m.source===soCode&&m.itemId===productId&&(!variantId||m.variantId===variantId))
  for(const so of s.salesOrders)for(const item of so.items){
    const moves=shipment(so.code,item.productId,item.variantId)
    if(moves.length){for(const m of moves)if(m.date.slice(0,10)>=since)add(item.productId,-m.qty,item.price,movementCost(s,m))}
    else if(item.delivered>0&&(so.deliveredAt||so.createdAt).slice(0,10)>=since)add(item.productId,item.delivered,item.price)
  }
  for(const ret of s.returns)if(ret.createdAt.slice(0,10)>=since){
    const so=s.salesOrders.find(o=>o.id===ret.salesOrderId)
    const line=so?.items.find(i=>i.productId===ret.productId&&(!ret.variantId||i.variantId===ret.variantId))
    if(!line||!so)continue
    const allocations=ret.allocations?.length?ret.allocations:[{lot:ret.lot,qty:ret.qty}]
    for(const a of allocations){
      const original=shipment(so.code,ret.productId,ret.variantId).find(m=>m.lot===a.lot)
      add(ret.productId,-a.qty,line.price,original?movementCost(s,original):undefined)
    }
  }
  return s.products.flatMap(product=>{
    const row=totals.get(product.id)
    if(!row||Math.abs(row.qty)<1e-9&&Math.abs(row.revenue)<1e-9)return []
    const basis=row.unknown>1e-9?'unavailable' as const:row.estimated>1e-9?'estimated' as const:row.provisional>1e-9?'provisional' as const:'actual' as const
    const cogs=basis==='unavailable'?null:money(row.cogs)
    const margin=cogs===null?null:money(row.revenue-cogs)
    return [{product,qty:row.qty,revenue:row.revenue,cogs,margin,costBasis:basis}]
  })
}
