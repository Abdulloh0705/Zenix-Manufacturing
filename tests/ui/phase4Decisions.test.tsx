import './setup'
import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {byText,cleanup,click,flush,type} from './helpers'
import {STATE_KEY,mountApp,seedState} from './appFixture'
import * as A from '../../src/domain/actions'
import {money} from '../../src/utils/format'
import type {ManufacturingState} from '../../src/types'

// Phase 4 business decisions in the UI (2026-11-20):
//  P4-M-04 BOTH — the spare-part button shows for exactly the roles the domain command accepts (engineer on the
//  maintenance order, store keeper on Ombor → Ehtiyot qism chiqimi) and the click really books the issue;
//  P4-I-01 STANDARD — inventory screens keep the standard book value and show the lot value and variance beside it.
afterEach(cleanup)
const stored=()=>JSON.parse(localStorage.getItem(STATE_KEY)!) as ManufacturingState
const lastDialog=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const text=()=>document.body.textContent||''
let n=0
const must=(o:A.Outcome)=>{if(!o.result.ok)throw new Error(o.result.message);return o.state}

/**
 * One open maintenance order on eq1 (wc1, branch b1) and one free raw line: rm4 lot HW-UI, 20 pcs at 8 000 in w1.
 * Extra people: wh-mgr store keeper (role6) and wh-op1 a warehouse operator with view/create only, both of w1.
 */
function seedMaintenance(){
  let orderId=''
  seedState(base=>{
    const keeper=(id:string,roleId:string)=>({id,name:`Keeper ${id}`,roleId,department:'Warehouse',workCenterId:'',warehouseId:'w1',shift:'A',status:'Faol',attendance:100,efficiency:100,hourlyCost:30000})
    let s:ManufacturingState={...base,
      roles:[...base.roles,{id:'role-whop-view',name:'Ombor operatori',scope:'warehouse',permissions:{warehouse:{view:true,create:true},materials:{view:true}},rank:1}],
      employees:[...base.employees,keeper('wh-mgr','role6'),keeper('wh-op1','role-whop-view'),
        {...base.employees.find(e=>e.id==='em5')!,id:'em5-peer',name:'Second Maintenance Engineer',branchId:'b1'}],
      lots:[...base.lots.filter(l=>l.itemType!=='raw'),{id:'lot-hwui',code:'HW-UI',kind:'lot',itemId:'rm4',itemType:'raw',qty:20,originalQty:20,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-x',sourceCode:'PO-X',createdAt:'2026-11-01 08:00',consumedBy:[],unitCost:8000}],
      stockBalances:[...base.stockBalances.filter(b=>b.itemType!=='raw'),{id:'st-rm4-w1',warehouseId:'w1',itemId:'rm4',itemType:'raw',onHand:20,reserved:0,incoming:0,quarantine:0,unit:'dona'}],
      maintenanceRequests:[{id:'mr-ui',code:'MR-UI',equipmentId:'eq1',type:'Corrective',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:new Date().toISOString().slice(0,10),reason:'Moy oqmoqda',downtimeHours:2},...base.maintenanceRequests],
    }
    const out=A.approveMaintenanceRequest(s,{now:new Date(),user:s.employees.find(e=>e.id==='em1')!,id:p=>`${p}-p4dui${++n}`},'mr-ui');orderId=out.result.id!
    s=must(out)
    return s
  })
  return orderId
}
async function issueFour(){
  await click(byText('Qism berish'))
  const dialog=lastDialog()
  await type(dialog.querySelector('input[aria-label="Qism miqdori"]'),'4')
  await click(byText('Berish','button',dialog));await flush(40)
}
const partsOf=(id:string)=>stored().maintenanceOrders.find(m=>m.id===id)!.parts||[]

test('P4-M-04: the Maintenance Engineer sees “Qism berish” on the order and issues the part',async()=>{
  const orderId=seedMaintenance()
  await mountApp(`/equipment?view=maintenance&id=${orderId}`,'em5')
  assert.ok(byText('Qism berish'),'engineer (equipment.edit, warehouse view only) gets the button')
  await issueFour()
  const parts=partsOf(orderId)
  assert.deepEqual(parts.map(p=>[p.materialId,p.warehouseId,p.qty,p.by,p.unitCost,p.lots[0]?.lot]),[['rm4','w1',4,'em5',8000,'HW-UI']])
  assert.equal(stored().stockBalances.find(b=>b.id==='st-rm4-w1')!.onHand,16)
})

test('P4-M-04: another engineer in the same branch cannot open the issue action',async()=>{
  const orderId=seedMaintenance()
  await mountApp(`/equipment?view=maintenance&id=${orderId}`,'em5-peer')
  assert.equal(byText('Qism berish'),null)
  assert.ok(text().includes('Bu maintenance ishi sizga biriktirilmagan'))
  assert.equal(partsOf(orderId).length,0)
  assert.equal(stored().stockBalances.find(b=>b.id==='st-rm4-w1')!.onHand,20)
})

test('P4-M-04: the Warehouse Manager issues from Ombor → Ehtiyot qism chiqimi without the equipment module',async()=>{
  const orderId=seedMaintenance()
  await mountApp('/warehouse?view=maintenance','wh-mgr')
  assert.ok(text().includes('Ehtiyot qism chiqimi'))
  const code=stored().maintenanceOrders.find(m=>m.id===orderId)!.code
  assert.ok(text().includes(code),'the open maintenance order of the keeper’s branch is listed')
  await cleanup();const reopened=seedMaintenance()
  await mountApp(`/warehouse?view=maintenance&mo=${reopened}`,'wh-mgr')
  assert.ok(lastDialog()?.textContent?.includes(code),'the order drawer is open')
  assert.ok(byText('Qism berish'),'store keeper (warehouse.edit) gets the button')
  await issueFour()
  const parts=partsOf(reopened)
  assert.deepEqual(parts.map(p=>[p.qty,p.by,p.warehouseId]),[[4,'wh-mgr','w1']])
  assert.ok(stored().stockMovements.some(m=>m.type==='Maintenance Issue -'&&m.source===code&&m.qty===-4&&m.lot==='HW-UI'&&m.user==='Keeper wh-mgr'))
})

test('P4-M-04: no button for a warehouse operator without warehouse.edit, nor for the quality inspector',async()=>{
  for(const user of ['wh-op1','em4']){
    const orderId=seedMaintenance()
    await mountApp(`/warehouse?view=maintenance&mo=${orderId}`,user)
    const code=stored().maintenanceOrders.find(m=>m.id===orderId)!.code
    assert.ok(lastDialog()?.textContent?.includes(code),`${user}: the order drawer is open`)
    assert.equal(byText('Qism berish'),null,`${user}: no issue button`)
    assert.ok(text().includes('Qism berish uchun ombor yoki uskunalar modulida tahrirlash huquqi kerak'),`${user}: says why`)
    await cleanup()
  }
})

/** rmX at standard 12 000, 49 kg of lot LOT-V received at a lot cost of 10 000 (the Phase 4 run’s 588 000 vs 490 000). */
function seedValuation(){
  seedState(s=>({...s,
    rawMaterials:[...s.rawMaterials,{id:'rmX',name:'Valuation test steel',sku:'RM-VX',category:'Metall',unit:'kg',status:'Faol',standardCost:12000,minStock:0,reorderPoint:0,supplierId:'su1',leadTime:1,lotTracking:true,expiryTracking:false}],
    lots:[...s.lots,{id:'lot-v',code:'LOT-V',kind:'lot',itemId:'rmX',itemType:'raw',qty:49,originalQty:49,warehouseId:'w1',status:'available',sourceType:'purchase',sourceId:'po-v',sourceCode:'PO-V',createdAt:'2026-11-10 08:00',consumedBy:[],unitCost:10000}],
    stockBalances:[...s.stockBalances,{id:'st-v',warehouseId:'w1',itemId:'rmX',itemType:'raw',onHand:49,reserved:0,incoming:0,quarantine:0,unit:'kg'}],
  }))
}

test('P4-I-01: the stock table keeps the standard value and shows the lot value and the variance beside it',async()=>{
  seedValuation()
  await mountApp('/warehouse?view=stock&q=Valuation')
  assert.ok(text().includes('Zaxira qiymati · standart'))
  const lotKpi=[...document.querySelectorAll('.kpi')].find(k=>k.textContent?.includes('LOT tannarxida'))
  assert.ok(lotKpi?.textContent?.includes('490 ming'),'a KPI of its own shows the lot value')
  assert.ok(lotKpi?.textContent?.includes(`farq −${money(98000)}`),'and the variance, not truncated into a sub-line of the standard KPI')
  const headers=[...document.querySelectorAll('th')].map(th=>th.textContent?.trim())
  assert.ok(headers.some(h=>h?.startsWith('Qiymat (standart)')),'standard column is labelled')
  assert.ok(headers.some(h=>h?.startsWith('Qiymat (LOT)')),'lot column is labelled')
  const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent?.includes('Valuation test steel'))
  assert.ok(row,'the rmX row is shown')
  assert.ok(row!.textContent!.includes(money(588000)),'standard 49 × 12 000')
  assert.ok(row!.textContent!.includes(money(490000)),'lot 49 × 10 000')
  assert.ok(row!.textContent!.includes(`−${money(98000)}`),'variance −98 000')
})

test('P4-I-01: the inventory report names both bases and the variance',async()=>{
  seedValuation()
  await mountApp('/reports?view=inventory')
  for(const label of ['Zaxira qiymati · standart','LOT xarid tannarxida','Narx farqi (LOT − standart)','Ko‘rsatiladi, hisobga o‘tkazilmaydi'])assert.ok(text().includes(label),label)
})
