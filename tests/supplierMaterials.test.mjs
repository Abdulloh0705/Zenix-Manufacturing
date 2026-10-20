import test from 'node:test'
import assert from 'node:assert/strict'
import * as A from '../.test-dist/actions.mjs'
import {createSeedState} from '../.test-dist/mockData.mjs'
import {createMrpPlan,materialPegging,orderMaterialPlan,perUnit,stockOf} from '../.test-dist/manufacturingEngine.mjs'
import {migrateSupplierLinks,orderProposal,preferredSupplierId,supplierOptions} from '../.test-dist/supplierMaterials.mjs'

let counter=0
const ctx=(s,userId='em1')=>({now:new Date(),user:s.employees.find(e=>e.id===userId),id:p=>`${p}-sm${++counter}`})
const ok=(out)=>{assert.ok(out.result.ok,out.result.message);return out}
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<2e-3,`${msg??''} ${a} ≠ ${b}`)
const inDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
const w1=(s,itemId)=>s.stockBalances.find(b=>b.warehouseId==='w1'&&b.itemId===itemId)

/**
 * The brief's example: "Panel kronshteyn" × 420 on BOM-PK-115 v1.7 while there is no usable steel sheet
 * and nothing on the way. Open rm2 POs are cancelled and w1's free rm2 is written off.
 */
function steelShortage(qty=420,due){
  let s=createSeedState(new Date())
  for(const po of s.purchaseOrders.filter(p=>['Tasdiqlangan','Yo‘lda','Qoralama'].includes(p.status)&&p.items.some(i=>i.materialId==='rm2')))s=ok(A.cancelPurchase(s,ctx(s),po.id)).state
  const b=w1(s,'rm2'),free=b.onHand-b.reserved-(b.quarantine||0)
  if(free>0)s=ok(A.adjustStock(s,ctx(s),'rm2','w1',-free,'Test: steel sheet written off')).state
  const created=ok(A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:qty,priority:'Kritik',due}))
  return {s:created.state,id:created.result.id}
}
const line=(s,orderId,materialId)=>orderMaterialPlan(s,s.productionOrders.find(o=>o.id===orderId)).find(l=>l.materialId===materialId)

test('example: Panel kronshteyn 420 is short 314 kg of steel sheet and only its linked supplier is offered',()=>{
  const {s,id}=steelShortage()
  const order=s.productionOrders.find(o=>o.id===id)
  assert.equal(order.bomSnapshot.code,'BOM-PK-115')
  assert.equal(order.bomVersion,'v1.7')
  const l=line(s,id,'rm2')
  near(l.required,420*perUnit(order.bomSnapshot.components[0]))
  assert.equal(Math.ceil(l.toBuy),314)
  const options=supplierOptions(s,'rm2',l.toBuy,order.due)
  assert.deepEqual(options.map(o=>o.supplierName),['Metal Trade Central'],'CoatChem Asia and Fasteners UZ do not supply steel sheet')
  assert.ok(options[0].recommended)
})

test('1 · one linked supplier: proposed by MRP and the only option',()=>{
  const s=createSeedState(new Date())
  assert.equal(preferredSupplierId(s,'rm4'),'su3')
  assert.equal(createMrpPlan(s).purchases.find(p=>p.materialId==='rm4').supplierId,'su3')
  const options=supplierOptions(s,'rm4',100)
  assert.equal(options.length,1)
  assert.equal(options[0].reason,'Yagona faol supplier')
})

test('2 · several suppliers: compared on lead time and terms, never "cheapest wins"; no silent pick',()=>{
  let {s,id}=steelShortage(420,inDays(10))
  // A cheaper supplier that cannot deliver before the order is due.
  s=ok(A.linkSupplierMaterial(s,ctx(s),{supplierId:'su3',materialId:'rm2',supplierSku:'FU-ST15',price:12000,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:30,active:true})).state
  const dup=A.linkSupplierMaterial(s,ctx(s),{supplierId:'su3',materialId:'rm2',supplierSku:'',price:1,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:1,active:true})
  assert.equal(dup.result.ok,false,'the same supplier–material pair cannot be linked twice')
  const order=s.productionOrders.find(o=>o.id===id),need=line(s,id,'rm2').toBuy
  const options=supplierOptions(s,'rm2',need,order.due)
  assert.equal(options.length,2)
  const cheap=options.find(o=>o.link.supplierId==='su3'),fast=options.find(o=>o.link.supplierId==='su1')
  assert.ok(cheap.cheapest&&!cheap.recommended&&cheap.onTime===false,'cheapest but late is not recommended')
  assert.ok(fast.recommended&&fast.onTime,'the supplier that arrives in time is recommended')
  // With two orderable suppliers and no preference MRP leaves the choice to people.
  s=ok(A.setPreferredSupplier(s,ctx(s),'rm2','')).state
  assert.equal(preferredSupplierId(s,'rm2'),undefined)
  const p=createMrpPlan(s).purchases.find(x=>x.materialId==='rm2')
  assert.equal(p.supplierId,undefined)
  assert.equal(p.supplierCount,2)
})

test('3 · no supplier linked: nothing is invented and a PO cannot be raised',()=>{
  let s=createSeedState(new Date())
  const created=ok(A.createEntity(s,ctx(s),'rawMaterials',{name:'Rezina qistirma',sku:'RM-RZ-01',category:'Kimyo',unit:'dona',status:'Faol',standardCost:900,minStock:0,reorderPoint:0,supplierId:'',leadTime:3,lotTracking:false,expiryTracking:false}))
  s=created.state
  const mid=created.result.id
  assert.equal(supplierOptions(s,mid,50).length,0)
  assert.equal(preferredSupplierId(s,mid),undefined)
  assert.equal(createMrpPlan(s).purchases.find(p=>p.materialId===mid).supplierCount,0)
  const po=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:mid,qty:50})
  assert.equal(po.result.ok,false)
  assert.match(po.result.message,/biriktirilmagan/)
  assert.equal(po.state,s)
})

test('4 · inactive supplier or link: shown with the reason, not orderable, not preferred',()=>{
  let s=createSeedState(new Date())
  const archived=ok(A.updateEntity(s,ctx(s),'suppliers','su1',{status:'Arxiv'})).state
  const opt=supplierOptions(archived,'rm2',100)
  assert.equal(opt[0].blocked,'Supplier nofaol')
  assert.ok(!opt.some(o=>o.recommended))
  assert.equal(preferredSupplierId(archived,'rm2'),undefined)
  assert.equal(A.createPurchaseOrder(archived,ctx(archived),{supplierId:'su1',materialId:'rm2',qty:100}).result.ok,false)
  // A deactivated link also drops out and stops being the material's preferred supplier.
  const link=s.supplierMaterials.find(l=>l.supplierId==='su1'&&l.materialId==='rm2')
  s=ok(A.updateSupplierMaterial(s,ctx(s),link.id,{active:false})).state
  assert.equal(supplierOptions(s,'rm2',100)[0].blocked,'Aloqa nofaol')
  assert.equal(s.rawMaterials.find(m=>m.id==='rm2').supplierId,'')
  assert.equal(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:100}).result.ok,false)
  // A draft raised before the supplier was archived cannot be confirmed afterwards.
  let d=createSeedState(new Date())
  const draft=ok(A.createPurchaseOrder(d,ctx(d),{supplierId:'su1',materialId:'rm2',qty:100,status:'Qoralama'}))
  d=ok(A.updateEntity(draft.state,ctx(draft.state),'suppliers','su1',{status:'Arxiv'})).state
  assert.equal(A.confirmPurchase(d,ctx(d),draft.result.id).result.ok,false)
})

test('5 · MOQ above the need: the order is raised to MOQ, the excess stays visible, below-MOQ needs consent',()=>{
  let {s,id}=steelShortage()
  const link=s.supplierMaterials.find(l=>l.supplierId==='su1'&&l.materialId==='rm2')
  s=ok(A.updateSupplierMaterial(s,ctx(s),link.id,{moq:500})).state
  const need=line(s,id,'rm2').toBuy
  const option=supplierOptions(s,'rm2',need)[0]
  assert.equal(option.proposal.purchaseQty,500)
  assert.ok(option.proposal.moqRaised)
  near(option.proposal.excess,500-need)
  const below=A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:Math.ceil(need)})
  assert.equal(below.result.ok,false)
  assert.match(below.result.message,/MOQ/)
  assert.ok(ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:Math.ceil(need),allowBelowMoq:true})).result.ok)
  const atMoq=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:500,productionOrderIds:[id]}))
  const po=atMoq.state.purchaseOrders.find(p=>p.id===atMoq.result.id)
  assert.equal(po.items[0].qty,500,'the PO keeps the full MOQ quantity, not just the shortage')
  assert.deepEqual(po.productionOrderIds,[id])
  // Purchase-unit conversion: 25 kg sheets → whole sheets only.
  s=ok(A.updateSupplierMaterial(s,ctx(s),link.id,{moq:0,purchaseUnit:'list',unitFactor:25,price:350000})).state
  const sheet=orderProposal(s.supplierMaterials.find(l=>l.id===link.id),need)
  assert.equal(sheet.purchaseQty,Math.ceil(need/25))
  assert.equal(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:310}).result.ok,false,'310 kg is not a whole number of 25 kg sheets')
  const sheets=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:325}))
  const item=sheets.state.purchaseOrders.find(p=>p.id===sheets.result.id).items[0]
  assert.equal(item.purchaseUnit,'list')
  near(item.price,14000,'350 000 so‘m per 25 kg sheet = 14 000 so‘m per kg')
})

function orderSteel(s,id,qty){
  const out=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty,warehouseId:'w1',productionOrderIds:id?[id]:[]}))
  return {s:out.state,poId:out.result.id}
}

test('6 · partial receipt: received, remaining and status are tracked; incoming moves to stock only as received',()=>{
  let {s,id}=steelShortage()
  ;({s}=orderSteel(s,id,500))
  const poId=s.purchaseOrders[0].id
  const before=w1(s,'rm2')
  const r=ok(A.receivePurchase(s,ctx(s),poId,'rm2',200,'',undefined,{key:'rcv-1'}))
  s=r.state
  const po=s.purchaseOrders.find(p=>p.id===poId)
  assert.equal(po.status,'Qisman qabul')
  assert.equal(po.items[0].received,200)
  assert.equal(po.items[0].qty-po.items[0].received,300)
  assert.equal(po.receipts[0].warehouseId,'w1')
  const after=w1(s,'rm2')
  near(after.onHand-before.onHand,200)
  near(before.incoming-after.incoming,200)
  near(after.quarantine-(before.quarantine||0),200,'steel sheet has an incoming QC point: received stock waits in quarantine')
})

test('7 · stock grows only on receipt (and becomes usable after incoming QC), never on PO create/confirm',()=>{
  let {s,id}=steelShortage()
  const start=stockOf(s,'rm2')
  const draft=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:400,status:'Qoralama',productionOrderIds:[id]}))
  s=draft.state
  assert.equal(stockOf(s,'rm2').onHand,start.onHand)
  assert.equal(stockOf(s,'rm2').incoming,start.incoming,'a draft is not incoming')
  s=ok(A.confirmPurchase(s,ctx(s),draft.result.id)).state
  assert.equal(stockOf(s,'rm2').onHand,start.onHand)
  near(stockOf(s,'rm2').incoming-start.incoming,400)
  assert.ok(s.supplierMaterials.find(l=>l.supplierId==='su1'&&l.materialId==='rm2').lastPurchaseOrderId===draft.result.id,'confirmed PO becomes the last purchase')
  s=ok(A.receivePurchase(s,ctx(s),draft.result.id,'rm2',400)).state
  near(stockOf(s,'rm2').onHand-start.onHand,400)
  near(stockOf(s,'rm2').available,start.available,'still in incoming QC')
  const qc=s.qualityChecks.find(q=>q.sourceId===draft.result.id&&q.status==='Pending')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),qc.id,'Passed')).state
  near(stockOf(s,'rm2').available-start.available,400)
  const move=s.stockMovements.find(m=>m.type==='Purchase +'&&m.source===s.purchaseOrders.find(p=>p.id===draft.result.id).code)
  assert.equal(move.qty,400,'the receipt posted one linked stock movement')
})

test('8 · incoming and reservations are each counted once across orders',()=>{
  let {s,id}=steelShortage()
  const need=line(s,id,'rm2').toBuy
  ;({s}=orderSteel(s,id,Math.ceil(need)))
  let l=line(s,id,'rm2')
  near(l.incoming,l.required,'the PO covers this order')
  assert.equal(l.toBuy,0)
  near(l.shortage,l.required,'not in stock yet')
  // A second order for the same material cannot use the same incoming again.
  const second=ok(A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:100,due:'2099-12-31'}))
  s=second.state
  const a=line(s,id,'rm2'),b=line(s,second.result.id,'rm2')
  const pegged=[...materialPegging(s).values()].flat().filter(x=>x.materialId==='rm2').reduce((sum,x)=>sum+x.incoming,0)
  near(pegged,Math.ceil(need),'pegged incoming over all orders adds up to the PO quantity')
  near(a.incoming,a.required,'the PO raised for this order stays with it')
  near(b.toBuy,b.required-b.covered-b.incoming)
  assert.ok(b.toBuy>0,'the second order still has to be bought for')
  // MRP nets the same incoming once (balance incoming == open PO quantity).
  const mrp=createMrpPlan(s).purchases.find(p=>p.materialId==='rm2')
  near(mrp.incoming,stockOf(s,'rm2').incoming)
  // A reserved order holds its own reservation; others see on hand − reservations, subtracted once.
  const reservedOrder=s.productionOrders.find(o=>o.materialReserved&&o.bomSnapshot.components.some(c=>c.materialId==='rm4'))
  const rl=orderMaterialPlan(s,reservedOrder).find(x=>x.materialId==='rm4')
  assert.equal(rl.toBuy,0)
  near(rl.covered,rl.required)
})

test('8b · incoming that arrives after the order due date is flagged as a deadline risk',()=>{
  let {s,id}=steelShortage()
  const order=s.productionOrders.find(o=>o.id===id)
  const out=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:400,expectedDate:'2099-01-01',productionOrderIds:[id]}))
  const l=line(out.state,id,'rm2')
  assert.equal(l.toBuy,0)
  assert.ok(l.lateForDue,`arrives ${l.arrives} after due ${order.due}`)
})

test('9 · the same receipt twice never raises stock twice',()=>{
  let {s,id}=steelShortage()
  ;({s}=orderSteel(s,id,300))
  const poId=s.purchaseOrders[0].id
  const first=ok(A.receivePurchase(s,ctx(s),poId,'rm2',100,'',undefined,{key:'same-form'}))
  const again=A.receivePurchase(first.state,ctx(first.state),poId,'rm2',100,'',undefined,{key:'same-form'})
  assert.equal(again.result.ok,false)
  assert.equal(again.state,first.state)
  const full=ok(A.receivePurchase(first.state,ctx(first.state),poId,'rm2',200))
  assert.equal(full.state.purchaseOrders.find(p=>p.id===poId).status,'Qabul qilindi')
  const over=A.receivePurchase(full.state,ctx(full.state),poId,'rm2',1)
  assert.equal(over.result.ok,false,'a fully received PO cannot be received again')
  near(w1(full.state,'rm2').onHand-w1(s,'rm2').onHand,300)
})

test('10 · once the shortage is received the order is updated but never started or completed by itself',()=>{
  let {s,id}=steelShortage()
  // The order was confirmed while short → waits for material; a second draft order stays a draft.
  s=A.transitionProduction(s,ctx(s),id,'Tasdiqlangan').state
  assert.equal(s.productionOrders.find(o=>o.id===id).status,'Material kutilmoqda')
  const draft=ok(A.createProductionOrder(s,ctx(s),{productId:'p3',quantity:50,due:inDays(0)}))
  s=draft.state
  const need=line(s,id,'rm2').toBuy+line(s,draft.result.id,'rm2').toBuy
  const po=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:'su1',materialId:'rm2',qty:Math.ceil(need),productionOrderIds:[id,draft.result.id]}))
  s=ok(A.receivePurchase(po.state,ctx(po.state),po.result.id,'rm2',Math.ceil(need))).state
  assert.equal(s.productionOrders.find(o=>o.id===id).status,'Material kutilmoqda','quarantined stock is not reserved')
  const qc=s.qualityChecks.find(q=>q.sourceId===po.result.id&&q.status==='Pending')
  s=ok(A.resolveQuality(s,ctx(s,'em4'),qc.id,'Passed')).state
  const waiting=s.productionOrders.find(o=>o.id===id)
  assert.equal(waiting.status,'Tasdiqlangan','existing workflow: a waiting order is released (reserved), not started')
  assert.ok(waiting.materialReserved)
  assert.equal(line(s,id,'rm2').toBuy,0)
  const d=s.productionOrders.find(o=>o.id===draft.result.id)
  assert.equal(d.status,'Qoralama','a draft is not confirmed automatically')
  assert.equal(d.materialReserved,false)
  assert.ok(s.notifications.some(n=>n.title==='Rezerv qilish mumkin'&&n.text.includes(d.code)),'planner is prompted to reserve')
  assert.ok(!s.productionOrders.some(o=>[id,draft.result.id].includes(o.id)&&['Jarayonda','Yakunlangan'].includes(o.status)))
})

test('receipt into another raw store moves incoming off the PO store and stock into the chosen one',()=>{
  let {s,id}=steelShortage()
  ;({s}=orderSteel(s,id,100))
  const poId=s.purchaseOrders[0].id
  const w4Before=s.stockBalances.find(b=>b.warehouseId==='w4'&&b.itemId==='rm2').onHand
  const incomingBefore=w1(s,'rm2').incoming
  s=ok(A.receivePurchase(s,ctx(s),poId,'rm2',100,'',undefined,{warehouseId:'w4'})).state
  near(s.stockBalances.find(b=>b.warehouseId==='w4'&&b.itemId==='rm2').onHand-w4Before,100)
  near(incomingBefore-w1(s,'rm2').incoming,100)
  assert.equal(A.receivePurchase(s,ctx(s),poId,'rm2',1,'',undefined,{warehouseId:'w3'}).result.ok,false,'raw material never lands in the finished-goods store')
})

test('quarantined stock is not reservable by a production order',()=>{
  let {s,id}=steelShortage()
  ;({s}=orderSteel(s,id,400))
  s=ok(A.receivePurchase(s,ctx(s),s.purchaseOrders[0].id,'rm2',400)).state
  const r=A.transitionProduction(s,ctx(s),id,'Tasdiqlangan')
  assert.equal(r.state.productionOrders.find(o=>o.id===id).status,'Material kutilmoqda')
})

test('supplier and its material links are saved together; links with open POs are protected',()=>{
  let s=createSeedState(new Date())
  const created=ok(A.saveSupplier(s,ctx(s),{supplier:{name:'Steel Partner',phone:'+998 90 111 22 33',leadTime:6,rating:4,status:'Faol'},links:[{materialId:'rm2',supplierSku:'SP-15',price:55,currency:'USD',purchaseUnit:'list',unitFactor:25,moq:10,leadTime:6,active:true}]}))
  s=created.state
  const link=s.supplierMaterials.find(l=>l.supplierId===created.result.id)
  assert.equal(link.supplierSku,'SP-15')
  assert.equal(supplierOptions(s,'rm2',300).length,2)
  const bad=A.saveSupplier(s,ctx(s),{id:created.result.id,supplier:{name:'Steel Partner',phone:'+998 90 111 22 33',leadTime:6,rating:4,status:'Faol'},links:[{materialId:'rm2',supplierSku:'',price:1,currency:'UZS',purchaseUnit:'kg',unitFactor:2,moq:0,leadTime:1,active:true}]})
  assert.equal(bad.result.ok,false,'kg → kg conversion must be 1')
  const po=ok(A.createPurchaseOrder(s,ctx(s),{supplierId:created.result.id,materialId:'rm2',qty:250}))
  assert.equal(A.removeSupplierMaterial(po.state,ctx(po.state),link.id).result.ok,false)
  assert.equal(A.saveSupplier(po.state,ctx(po.state),{id:created.result.id,supplier:{name:'Steel Partner',phone:'+998 90 111 22 33',leadTime:6,rating:4,status:'Faol'},links:[]}).result.ok,false)
})

test('data saved before links existed is migrated only from relationships it already records',()=>{
  const s=createSeedState(new Date())
  const legacy={...s,supplierMaterials:undefined,suppliers:s.suppliers.map(x=>({...x,materials:x.id==='su1'?['rm1','rm2']:x.id==='su2'?['rm3']:['rm4']}))}
  const links=migrateSupplierLinks(legacy)
  assert.deepEqual(links.map(l=>`${l.supplierId}:${l.materialId}`).sort(),['su1:rm1','su1:rm2','su2:rm3','su3:rm4'])
  const steel=links.find(l=>l.materialId==='rm2')
  assert.equal(steel.price,14200,'price from the last PO of that pair')
  assert.equal(steel.moq,0)
  assert.equal(steel.supplierSku,'')
})
