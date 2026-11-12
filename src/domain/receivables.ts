// Customer receivables (audit #19): what a customer owes is the sum of its ledger entries — opening balance, invoices
// posted at delivery, payments, credit notes of returns and authorised adjustments. Pure reads here; entries are
// posted only by the domain commands in actions.ts, each with an idempotency key, never edited or deleted.
import type {Customer,ManufacturingState,ReceivableEntry,SalesOrder} from '../types'

type S=ManufacturingState
const r2=(n:number)=>Math.round(n*100)/100

export const RECEIVABLE_KINDS:Record<ReceivableEntry['kind'],string>={opening:'Boshlang‘ich qoldiq',invoice:'Hisob-faktura',payment:'To‘lov',credit:'Kredit-nota (qaytarish)',adjustment:'Tuzatish'}
export const PAYMENT_METHODS=['Bank o‘tkazmasi','Naqd','Karta','Boshqa']

export const ledger=(s:Pick<S,'receivables'>)=>s.receivables||[]
/** Entries of one customer, oldest first. */
export const customerLedger=(s:Pick<S,'receivables'>,customerId:string)=>ledger(s).filter(e=>e.customerId===customerId).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
/** Outstanding balance of a customer: + the customer owes, − the company owes the customer (credit). */
export const customerBalance=(s:Pick<S,'receivables'>,customerId:string)=>r2(ledger(s).filter(e=>e.customerId===customerId).reduce((a,e)=>a+e.amount,0))
export const hasEntry=(s:Pick<S,'receivables'>,key:string)=>ledger(s).some(e=>e.key===key)

export type OrderReceivable={invoiced:number;paid:number;credited:number;outstanding:number;
  /** Payment state derived from the ledger; null when nothing of the order was invoiced through it (older orders). */
  status:'To‘lanmagan'|'Qisman'|'To‘langan'|null}

/** Invoiced, paid and credited amounts of one sales order and what is still open on it. */
export function orderReceivable(s:Pick<S,'receivables'>,soId:string):OrderReceivable{
  const rows=ledger(s).filter(e=>e.salesOrderId===soId)
  const sum=(kind:ReceivableEntry['kind'])=>r2(rows.filter(e=>e.kind===kind).reduce((a,e)=>a+e.amount,0))
  const invoiced=sum('invoice'),paid=-sum('payment'),credited=-sum('credit')
  const outstanding=r2(invoiced-paid-credited)
  const status=invoiced<=0?null:outstanding<=0.005?'To‘langan' as const:paid>0.005?'Qisman' as const:'To‘lanmagan' as const
  return {invoiced,paid,credited,outstanding,status}
}

/** Payment status shown for an order: from its ledger, else the status stored before the ledger existed. */
export const paymentStatusOf=(s:Pick<S,'receivables'>,so:Pick<SalesOrder,'id'|'paymentStatus'>)=>orderReceivable(s,so.id).status??so.paymentStatus

/** Customer.debt written from the ledger (the stored figure is a cache of it). */
export function withDebts(s:S,customerIds?:string[]):S{
  const ids=customerIds?new Set(customerIds):undefined
  return {...s,customers:s.customers.map(c=>!ids||ids.has(c.id)?{...c,debt:customerBalance(s,c.id)}:c)}
}

/**
 * Opening entries for data saved before the ledger: each customer's stored debt becomes its opening balance, so the
 * balance it showed stays exactly the same and every later change goes through the ledger. Ids follow the pattern of
 * generated records (`aropen-N`), so the one-time demo cleanup still recognises data that held only demo figures.
 */
export function openingEntries(customers:Pick<Customer,'id'|'debt'>[],date:string):ReceivableEntry[]{
  return customers.filter(c=>typeof c.debt==='number'&&Number.isFinite(c.debt)&&Math.abs(c.debt)>0.005).map((c,i)=>({
    id:`aropen-${i+1}`,key:`opening:${c.id}`,customerId:c.id,kind:'opening' as const,amount:r2(c.debt),date,by:'system',byName:'Tizim',note:'Ledger’dan oldingi qarz (Customer.debt)'}))
}

export type AgingBucket={label:string;amount:number}
/**
 * Open invoices by age (days since the invoice) with payments and credits applied to the oldest first; the opening
 * balance and adjustments count from their own dates. Totals equal the positive balance.
 */
export function receivableAging(s:Pick<S,'receivables'>,customerId:string|undefined,today:string,daysBetween:(a:string,b:string)=>number):AgingBucket[]{
  const rows=ledger(s).filter(e=>!customerId||e.customerId===customerId)
  const buckets=[{label:'0–30 kun',max:30,amount:0},{label:'31–60 kun',max:60,amount:0},{label:'61–90 kun',max:90,amount:0},{label:'90+ kun',max:Infinity,amount:0}]
  for(const id of new Set(rows.map(e=>e.customerId))){
    const own=rows.filter(e=>e.customerId===id).sort((a,b)=>a.date.localeCompare(b.date))
    const debits=own.filter(e=>e.amount>0).map(e=>({date:e.date,open:e.amount}))
    let reduce=-own.filter(e=>e.amount<0).reduce((a,e)=>a+e.amount,0)
    for(const d of debits){const take=Math.min(d.open,reduce);d.open-=take;reduce-=take}
    for(const d of debits){if(d.open<=0.005)continue;const age=daysBetween(d.date.slice(0,10),today);buckets.find(b=>age<=b.max)!.amount+=d.open}
  }
  return buckets.map(b=>({label:b.label,amount:r2(b.amount)}))
}

/*
 * Legacy return credits (Phase 5). An order delivered before the ledger has no invoice entry: its value sits inside
 * the customer's opening balance, which cannot be split per order. A return of such units gets no automatic credit
 * note (that would guess which old invoice it reduces); it opens an audited reconciliation instead, resolved by an
 * authorised user as "credit" (a credit note keyed by the return, so never posted twice) or "no credit" (settled
 * otherwise). Orders invoiced through the ledger keep the automatic credit note unchanged.
 */

/** How an order was invoiced: through the ledger, before it (legacy), or partly each way. */
export function orderInvoicing(s:Pick<S,'receivables'|'salesOrders'>,soId:string){
  const so=s.salesOrders.find(o=>o.id===soId)
  const delivered=r2((so?.items||[]).reduce((a,i)=>a+i.delivered*i.price,0))
  const invoiced=orderReceivable(s,soId).invoiced
  const legacy=r2(Math.max(0,delivered-invoiced))
  return {delivered,invoiced,legacy,kind:legacy<=0.005?'ledger' as const:invoiced<=0.005?'legacy' as const:'mixed' as const}
}

/** Customer sales volume is fulfilled value, including historical deliveries on legacy cancelled orders. */
export function customerSalesVolume(s:Pick<S,'salesOrders'>,customerId:string){
  return r2(s.salesOrders.filter(o=>o.customerId===customerId).reduce((total,o)=>total+o.items.reduce((sum,i)=>sum+i.delivered*i.price,0),0))
}

/** Credit already posted for one return (automatic and reconciled). */
export const returnCredited=(s:Pick<S,'receivables'>,returnId:string)=>r2(-ledger(s).filter(e=>e.kind==='credit'&&e.returnId===returnId).reduce((a,e)=>a+e.amount,0))

/**
 * Value of a return no credit note covers yet, when its order has legacy (pre-ledger) deliveries — capped by that
 * legacy value minus what other returns of the order already got credited beyond the ledger invoices. 0 = nothing open.
 */
export function returnCreditGap(s:Pick<S,'receivables'|'salesOrders'|'returns'>,returnId:string){
  const r=s.returns.find(x=>x.id===returnId)
  const so=r&&s.salesOrders.find(o=>o.id===r.salesOrderId)
  const line=so?.items.find(i=>i.productId===r!.productId)
  if(!r||!so||!line)return 0
  const inv=orderInvoicing(s,so.id)
  if(inv.legacy<=0.005)return 0
  const value=r2(r.qty*line.price),done=returnCredited(s,r.id)
  // Credits of the order beyond its ledger invoices already used part of the legacy value.
  const overInvoice=r2(Math.max(0,orderReceivable(s,so.id).credited-inv.invoiced))
  return r2(Math.max(0,Math.min(value-done,inv.legacy-overInvoice)))
}
