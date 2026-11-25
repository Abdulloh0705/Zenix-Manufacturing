// Deterministic business data for the browser tests, built with the real domain commands (never hand-written
// records), so stock, lots, QC and reservations are consistent exactly as the app would have produced them.
import {expect,type Page} from '@playwright/test'
import {createInitialState} from '../src/data/mockData'
import * as A from '../src/domain/actions'
import type {Ctx,Outcome} from '../src/domain/actions'
import type {ManufacturingState} from '../src/types'

export const STATE_KEY='zenix-manufacturing-v3-state'
export const AUTH_KEY='zenix-auth-v1'
export const SESSION_KEY='zenix-session-v1'

let n=0
const ctx=(s:ManufacturingState):Ctx=>({now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:p=>`${p}-e2e${++n}`})
const ok=(o:Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}

/** The master data as after first-run set-up: em1 is the Business Owner (auth.setup.ts signs in as em1). */
export function adminState():ManufacturingState{
  const s=createInitialState()
  return {...s,employees:s.employees.map(e=>e.id==='em1'?{...e,roleId:'role_owner'}:e)}
}

/** A confirmed PO of 100 kg steel sheet (rm2), not yet received. */
export function confirmedPurchase(){
  let s=adminState()
  const link=s.supplierMaterials.find(l=>l.materialId==='rm2')!
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:link.supplierId,lines:[{materialId:'rm2',qty:100,price:1000}],allowBelowMoq:true});s=ok(po)
  return {state:s,poId:po.result.id!,poCode:s.purchaseOrders.find(p=>p.id===po.result.id)!.code}
}

/** A confirmed MO for 20 brackets (p3) with its material received, inspected and reserved. */
export function reservedOrder(){
  const purchase=confirmedPurchase(),poId=purchase.poId
  let s=purchase.state
  s=ok(A.receivePurchase(s,ctx(s),poId,'rm2',100))
  const qc=s.qualityChecks.find(q=>q.sourceId===poId&&q.status==='Pending')!
  s=ok(A.resolveQuality(s,ctx(s),qc.id,'Passed'))
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:20});s=ok(mo)
  s=ok(A.transitionProduction(s,ctx(s),mo.result.id!,'Tasdiqlangan'))
  return {state:s,moId:mo.result.id!}
}

/** Replaces the stored business data and opens `path`. The open tab never overwrites it (newer save wins). */
export async function openWith(page:Page,state:ManufacturingState,path:string){
  await page.goto('/')
  await page.evaluate(([key,value])=>localStorage.setItem(key,value),[STATE_KEY,JSON.stringify(state)])
  await page.goto(path)
}

export const stored=(page:Page)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null') as ManufacturingState,STATE_KEY)

/** Page errors and console errors fail the test: the smoke flows must run clean. */
export function watchErrors(page:Page){
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`))
  page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)})
  return {assertClean:()=>expect(errors,errors.join('\n')).toEqual([])}
}

/** Finishes CSS animations (dialogs fade in) so clicks land on settled elements. */
export const settle=(page:Page)=>page.evaluate(()=>document.getAnimations().filter(a=>Number.isFinite(Number(a.effect?.getComputedTiming().endTime))).forEach(a=>a.finish()))

/** Three serial units of p2 (SN-E2E-1…3) in the finished-goods store and an MTS order for 2, which pins units 1 and 2. */
export function serialSalesOrder(){
  let s=adminState()
  const at='2026-11-01 08:00'
  const units=[1,2,3].map(i=>({id:`lot-sn-e2e-${i}`,code:`SN-E2E-${i}`,kind:'serial' as const,serialFrom:`SN-E2E-${i}`,serialTo:`SN-E2E-${i}`,itemId:'p2',itemType:'finished' as const,qty:1,originalQty:1,warehouseId:'w3',status:'available' as const,sourceType:'production' as const,sourceId:'mo-e2e',sourceCode:'MO-E2E',createdAt:`${at.slice(0,9)}${i} 08:00`,consumedBy:[] as string[]}))
  s={...s,lots:[...s.lots,...units] as ManufacturingState['lots'],stockBalances:[...s.stockBalances.filter(b=>!(b.itemId==='p2'&&b.warehouseId==='w3')),{id:'st-p2-w3-e2e',warehouseId:'w3',itemId:'p2',itemType:'finished',onHand:3,reserved:0,incoming:0,quarantine:0,unit:'dona'}] as ManufacturingState['stockBalances']}
  const so=A.createSalesOrder(s,ctx(s),{customerId:'cu1',mode:'Make-to-stock',lines:[{productId:'p2',qty:2,price:180000}]});s=ok(so)
  return {state:s,soId:so.result.id!,soCode:s.salesOrders.find(o=>o.id===so.result.id)!.code}
}

/** 50 kg steel sheet (rm2) and 100 bolts (rm4) found in the raw store by adjustment, each as its own LOT. */
export function stockedRawStore(){
  let s=adminState()
  s=ok(A.adjustStock(s,ctx(s),'rm2','w1',50,'E2E opening'))
  s=ok(A.adjustStock(s,ctx(s),'rm4','w1',100,'E2E opening'))
  return s
}

/** The confirmed steel PO with 60 of its 100 kg received (debt accrued for the received part). */
export function partlyReceivedPurchase(){
  const {state,poId,poCode}=confirmedPurchase()
  return {state:ok(A.receivePurchase(state,ctx(state),poId,'rm2',60)),poId,poCode}
}

/** An open NCR and a planned corrective maintenance work (from an approved request) with 50 bolts in the raw store. */
export function qualityMaintenanceState(){
  let s=adminState()
  // An NCR names a real document (SEC-02): a draft MO stands in for the inspected order.
  const mo=A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:5});s=ok(mo)
  s=ok(A.createQualityAlert(s,ctx(s),{title:'E2E teshik katta',sourceId:mo.result.id!,severity:'Yuqori',reason:'Final QC',ownerId:'em1'}))
  const alertId=s.qualityAlerts[0].id
  s=ok(A.adjustStock(s,ctx(s),'rm4','w1',50,'E2E opening'))
  s={...s,maintenanceRequests:[{id:'mr-e2e',code:'MR-E2E',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em1',scheduled:new Date().toISOString().slice(0,10),reason:'Moy oqmoqda',downtimeHours:2},...s.maintenanceRequests]}
  const approved=A.approveMaintenanceRequest(s,ctx(s),'mr-e2e');s=ok(approved)
  return {state:s,alertId,orderId:approved.result.id!}
}
