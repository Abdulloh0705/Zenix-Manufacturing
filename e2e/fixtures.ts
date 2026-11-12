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
