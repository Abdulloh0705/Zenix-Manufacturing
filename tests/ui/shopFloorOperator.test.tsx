import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import * as A from '../../src/domain/actions'
import type {ManufacturingState} from '../../src/types'

// Phase 4: the operator screen is for operators. Their role holds production.execute (not edit), which is exactly
// what the domain asks of shop-floor actions (PROD_RUN), so START / NATIJA / SCRAP / STOP must be usable.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
let n=0
const ctx=(s:ManufacturingState):A.Ctx=>({now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:p=>`${p}-sfo${++n}`})
const must=(o:A.Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}

test('an operator (production.execute only) can start the work order from the shop floor',async()=>{
  let moId=''
  seedState(clean=>{
    // 10 kg of p3's raw material in the default raw store, so the order can be released.
    const lot={id:'lot-sfo',code:'LOT-SFO',kind:'lot' as const,itemId:'rm2',itemType:'raw' as const,qty:10,originalQty:10,warehouseId:'w1',status:'available' as const,sourceType:'purchase' as const,sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-10-01 08:00',consumedBy:[]}
    const base={...clean,lots:[...clean.lots,lot],stockBalances:[...clean.stockBalances,{id:'st-sfo',warehouseId:'w1',itemId:'rm2',itemType:'raw' as const,onHand:10,reserved:0,incoming:0,quarantine:0,unit:'kg'}]} as ManufacturingState
    const created=A.createProductionOrder(base,ctx(base),{productId:'p3',quantity:2});let s=must(created);moId=created.result.id!
    s=must(A.transitionProduction(s,ctx(s),moId,'Tasdiqlangan'))
    return must(A.transitionProduction(s,ctx(s),moId,'Jarayonda'))
  })
  // em3 is a seed Operator bound to wc2, the work center of p3's routing.
  await mountApp(`/production?view=shop-floor&mo=${moId}`,'em3')
  const start=byText('START') as HTMLButtonElement
  assert.ok(start,'START is shown')
  assert.equal(start.disabled,false,'an operator may start the operation')
  for(const label of ['NATIJA','SCRAP','STOP'])assert.equal((byText(label) as HTMLButtonElement).disabled,false,`${label} enabled for the operator`)
  await click(start);await flush(40)
  assert.equal(stored().productionOrders.find(o=>o.id===moId)!.workOrders[0].status,'Jarayonda')
})
