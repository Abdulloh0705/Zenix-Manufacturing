// Data for ZENIX Manufacturing.
// Master data is declared statically. The app starts from createInitialState(): master data only, no
// transactions. createSeedState() is the demo-history generator used by the domain tests: it replays
// the real business actions over a timeline relative to "today", so stock, reservations, lots,
// movements, time logs, quality checks and costs are always mutually consistent.
import type {Bom,Employee,ManufacturingState} from '../types'
import * as A from '../domain/actions'
import {rollUpStandardCosts} from '../domain/manufacturingEngine'
import {clearTransactions} from '../domain/reset'
import {SYSTEM_ROLES} from '../domain/access'
import {SCHEMA_VERSION} from '../domain/migrations'

const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v))
import type {Ctx,Outcome} from '../domain/actions'
import {isoDate,stamp,weekStart,addDays} from '../utils/dates'


const boms:Bom[]=[
  {id:'bom1',code:'BOM-AL-4040',productId:'p1',version:'v3.2',revision:7,status:'Faol',effectiveDate:'2026-08-15',waste:3.2,
    components:[{id:'bc1',materialId:'rm1',qty:1.13,unit:'kg',waste:3.2},{id:'bc2',materialId:'rm3',qty:.08,unit:'kg',waste:2}],
    operations:[
      {id:'bo1',name:'Ekstruziya',workCenterId:'wc1',setupMin:25,runMin:.25,employeeCount:2,instructions:'Press parametrlarini profil kartasiga muvofiq sozlang. Billet harorati 480–500 °C.',qualityCheck:true,worksheet:'WI-EXT-4040-v3',barcodeStep:true},
      {id:'bo2',name:'Bo‘yash',workCenterId:'wc3',setupMin:18,runMin:.3,employeeCount:2,instructions:'RAL 9016 qoplama qalinligi 70–90 μm. Pech 200 °C · 12 min.',qualityCheck:true,dependsOn:['bo1'],worksheet:'WI-PAINT-9016',barcodeStep:true},
    ],byProducts:[{productId:'p4',qty:.035,unit:'kg'}],notes:'Profil kesim toleransi ±0.25 mm.'},
  {id:'bom2',code:'BOM-VK-210',productId:'p2',version:'v1.9',revision:3,status:'Faol',effectiveDate:'2026-05-02',waste:4.5,
    components:[{id:'bc3',materialId:'rm2',qty:2.4,unit:'kg',waste:4.5},{id:'bc4',materialId:'rm4',qty:8,unit:'dona',waste:0},{id:'bc6',materialId:'p3',qty:2,unit:'dona',waste:0,subBomId:'bom3'}],
    operations:[
      {id:'bo3',name:'Laser kesish',workCenterId:'wc2',setupMin:15,runMin:.8,employeeCount:1,instructions:'Nesting V210 faylini tanlang. Kesim sifati: burr yo‘q.',qualityCheck:true,worksheet:'DRW-V210-LASER',barcodeStep:true},
      {id:'bo4',name:'Yig‘ish',workCenterId:'wc4',setupMin:10,runMin:1.6,employeeCount:2,instructions:'Kronshteynlarni o‘rnating. Bolt momenti 7 Nm.',qualityCheck:false,dependsOn:['bo3'],worksheet:'WI-V210-ASSEMBLY'},
    ],notes:'Final nazorat majburiy.'},
  {id:'bom3',code:'BOM-PK-115',productId:'p3',version:'v1.7',revision:3,status:'Faol',effectiveDate:'2026-06-11',waste:3.8,
    components:[{id:'bc5',materialId:'rm2',qty:.72,unit:'kg',waste:3.8}],
    operations:[{id:'bo5',name:'Laser kesish',workCenterId:'wc2',setupMin:8,runMin:.3,employeeCount:1,instructions:'PK115 nesting. Teshik diametri 6.5 mm.',qualityCheck:false,worksheet:'DRW-PK115',barcodeStep:true}],notes:'Yarim tayyor mahsulot: VK-210 korpusi uchun sub-assembly.'},
]

const employees:Employee[]=[
  {id:'em1',name:'Abdulloh Karimov',roleId:'role1',department:'Management',workCenterId:'wc1',shift:'Kunduzgi',status:'Faol',attendance:98,efficiency:92,hourlyCost:65000},
  {id:'em2',name:'Aziz Karimov',roleId:'role2',department:'Production',workCenterId:'wc1',shift:'A',status:'Smenada',attendance:97,efficiency:91,hourlyCost:42000},
  {id:'em3',name:'Dilshod Ergashev',roleId:'role5',department:'Production',workCenterId:'wc2',shift:'A',status:'Smenada',attendance:95,efficiency:84,hourlyCost:41000},
  {id:'em4',name:'Nargiza Aliyeva',roleId:'role3',department:'Quality',workCenterId:'wc2',shift:'A',status:'Smenada',attendance:99,efficiency:94,hourlyCost:46000},
  {id:'em5',name:'Rustam Jo‘rayev',roleId:'role4',department:'Maintenance',workCenterId:'wc2',shift:'A',status:'Smenada',attendance:96,efficiency:88,hourlyCost:48000},
  {id:'em6',name:'Sherzod Tursunov',roleId:'role5',department:'Production',workCenterId:'wc3',shift:'A',status:'Smenada',attendance:93,efficiency:86,hourlyCost:39000},
  {id:'em7',name:'Malika Yusupova',roleId:'role5',department:'Production',workCenterId:'wc4',shift:'B',status:'Faol',attendance:97,efficiency:89,hourlyCost:38000},
]

function baseState():ManufacturingState{
  return {
    settings:{theme:'system',appearance:'blue',accent:'#3B78E7',currency:'UZS',fontSize:'standard',reducedMotion:false,uiDensity:'standard',tableDensity:'standard',defaultBranchId:'b1',defaultWarehouseId:'w1',defaultLineId:'l1',language:'uz',
      notifications:{lowStock:true,quality:true,maintenance:true,delay:true,ai:true},ai:{enabled:true,credits:20},
      company:{name:'ZENIX Industrial Demo',currency:'UZS',timezone:'Asia/Tashkent',taxId:'305 441 882'},
      policies:{requireFinalQc:true,autoQualityChecks:true,overheadRate:12,machineRatePerHour:90000,shiftMinutes:480,poDualApproval:false,poDualApprovalFrom:50000000}},
    branches:[{id:'b1',name:'Toshkent zavodi',code:'BR-TAS',status:'Faol'},{id:'b2',name:'Chirchiq sexi',code:'BR-CHI',status:'Faol'}],
    warehouses:[
      {id:'w1',name:'Xomashyo ombori',code:'WH-RAW',branchId:'b1',type:'Raw',status:'Faol',locations:['RECEIVING','RAW-A1','RAW-A2','QC-HOLD']},
      {id:'w2',name:'WIP ombori',code:'WH-WIP',branchId:'b1',type:'WIP',status:'Faol',locations:['WIP-LINE1','WIP-LINE2']},
      {id:'w3',name:'Tayyor mahsulot',code:'WH-FG',branchId:'b1',type:'Finished',status:'Faol',locations:['FG-A','FG-B','DISPATCH']},
      {id:'w4',name:'Chirchiq ombori',code:'WH-CHI',branchId:'b2',type:'Mixed',status:'Faol',locations:['MIX-01','MIX-02']},
    ],
    productionLines:[
      {id:'l1',name:'Ekstruziya liniyasi',code:'LINE-EXT',branchId:'b1',shift:'08:00–20:00',capacity:2400,utilization:82,status:'Ishlamoqda'},
      {id:'l2',name:'Metall liniyasi',code:'LINE-MET',branchId:'b1',shift:'08:00–20:00',capacity:900,utilization:74,status:'Ishlamoqda'},
      {id:'l3',name:'Yig‘ish liniyasi',code:'LINE-ASM',branchId:'b2',shift:'09:00–18:00',capacity:700,utilization:68,status:'Ishlamoqda'},
    ],
    workCenters:[
      {id:'wc1',name:'Extrusion Press',code:'PRESS-01',branchId:'b1',lineId:'l1',capacity:180,efficiency:88,status:'Ishlamoqda',machineIds:['eq1'],costPerHour:185000},
      {id:'wc2',name:'Laser Cutting',code:'LASER-01',branchId:'b1',lineId:'l2',capacity:140,efficiency:81,status:'Ishlamoqda',machineIds:['eq2'],costPerHour:240000},
      {id:'wc3',name:'Powder Paint',code:'PAINT-01',branchId:'b1',lineId:'l1',capacity:120,efficiency:84,status:'Ishlamoqda',machineIds:['eq3'],costPerHour:120000},
      {id:'wc4',name:'Assembly',code:'ASM-01',branchId:'b2',lineId:'l3',capacity:110,efficiency:76,status:'Ishlamoqda',machineIds:[],costPerHour:60000},
    ],
    products:[
      {id:'p1',name:'Alyuminiy profil 40×40',sku:'FG-AL-4040',category:'Metall profillar',unit:'dona',status:'Faol',type:'finished',salePrice:83000,standardCost:25800,leadTime:2,defaultBomId:'bom1',tracking:'lot',procurement:'make',
        variants:[{id:'v1',code:'FG-AL-4040-SLV',attributes:'Rang: kumush anod · 6 m',priceDelta:4500,status:'Faol'},{id:'v2',code:'FG-AL-4040-WHT',attributes:'Rang: RAL 9016 · 6 m',priceDelta:0,status:'Faol'}],createdAt:'2026-01-10'},
      {id:'p2',name:'Ventilyatsiya korpusi',sku:'FG-VK-210',category:'Korpus va panellar',unit:'dona',status:'Faol',type:'finished',salePrice:180000,standardCost:91200,leadTime:3,defaultBomId:'bom2',tracking:'serial',procurement:'make',
        variants:[{id:'v3',code:'FG-VK-210-L',attributes:'O‘lcham: 210×420',priceDelta:0,status:'Faol'},{id:'v4',code:'FG-VK-210-XL',attributes:'O‘lcham: 210×560',priceDelta:26000,status:'Faol'}],createdAt:'2026-02-02'},
      {id:'p3',name:'Panel kronshteyn',sku:'FG-PK-115',category:'Yarim tayyor',unit:'dona',status:'Faol',type:'semi',salePrice:47500,standardCost:18750,leadTime:2,defaultBomId:'bom3',tracking:'lot',procurement:'make',variants:[],createdAt:'2026-02-02'},
      {id:'p4',name:'Alyuminiy qayta ishlash briketi',sku:'BP-AL-REC',category:'By-product',unit:'kg',status:'Faol',type:'semi',salePrice:9500,standardCost:4200,leadTime:0,defaultBomId:'',tracking:'none',procurement:'buy',variants:[],createdAt:'2026-03-01'},
    ],
    rawMaterials:[
      {id:'rm1',name:'Alyuminiy billet 6063',sku:'RM-AL-6063',category:'Metall',unit:'kg',status:'Faol',standardCost:22500,minStock:900,reorderPoint:1300,supplierId:'su1',leadTime:4,lotTracking:true,expiryTracking:false},
      {id:'rm2',name:'Po‘lat list 1.5mm',sku:'RM-ST-15',category:'Metall',unit:'kg',status:'Faol',standardCost:14200,minStock:700,reorderPoint:900,supplierId:'su1',leadTime:4,lotTracking:true,expiryTracking:false},
      {id:'rm3',name:'Powder coat — oq',sku:'RM-PC-W',category:'Kimyo',unit:'kg',status:'Faol',standardCost:68000,minStock:80,reorderPoint:100,supplierId:'su2',leadTime:3,lotTracking:true,expiryTracking:true},
      {id:'rm4',name:'M6 bolt',sku:'RM-B-M6',category:'Fastener',unit:'dona',status:'Faol',standardCost:1420,minStock:900,reorderPoint:1200,supplierId:'su3',leadTime:2,lotTracking:true,expiryTracking:false},
    ],
    boms:JSON.parse(JSON.stringify(boms)),
    stockBalances:[],stockMovements:[],productionOrders:[],
    suppliers:[
      {id:'su1',name:'Metal Trade Central',phone:'+998 71 200 11 22',email:'sales@metaltrade.uz',leadTime:4,rating:4.8,status:'Faol',debt:12500000},
      {id:'su2',name:'CoatChem Asia',phone:'+998 71 215 50 50',email:'order@coatchem.asia',leadTime:3,rating:4.6,status:'Faol',debt:0},
      {id:'su3',name:'Fasteners UZ',phone:'+998 90 770 00 11',email:'info@fasteners.uz',leadTime:2,rating:4.9,status:'Faol',debt:3400000},
    ],
    // Only the pairs the demo already documents (supplier material lists, material default supplier and
    // the purchase history below). Price = the price those POs were placed at, per stock unit in UZS;
    // lead time = the supplier's. No supplier SKU or MOQ was ever given, so none is set.
    supplierMaterials:[
      {id:'sm1',supplierId:'su1',materialId:'rm1',supplierSku:'',price:22500,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:4,active:true,createdAt:'2026-01-10'},
      {id:'sm2',supplierId:'su1',materialId:'rm2',supplierSku:'',price:14200,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:4,active:true,createdAt:'2026-01-10'},
      {id:'sm3',supplierId:'su2',materialId:'rm3',supplierSku:'',price:68000,currency:'UZS',purchaseUnit:'kg',unitFactor:1,moq:0,leadTime:3,active:true,createdAt:'2026-01-10'},
      {id:'sm4',supplierId:'su3',materialId:'rm4',supplierSku:'',price:1420,currency:'UZS',purchaseUnit:'dona',unitFactor:1,moq:0,leadTime:2,active:true,createdAt:'2026-01-10'},
    ],
    purchaseOrders:[],
    customers:[
      {id:'cu1',name:'BuildTech Group',phone:'+998 90 555 11 22',email:'supply@buildtech.uz',type:'B2B',status:'Faol',debt:0},
      {id:'cu2',name:'Air Systems LLC',phone:'+998 93 700 40 50',email:'procurement@airsystems.uz',type:'B2B',status:'Faol',debt:8600000},
      {id:'cu3',name:'Qurilish Market',phone:'+998 97 310 22 44',type:'Diler',status:'Faol',debt:1200000},
    ],
    salesOrders:[],qualityChecks:[],qualityAlerts:[],
    equipment:[
      {id:'eq1',name:'Extrusion Press 1800T',model:'EP-1800',serial:'EP18-22041',workCenterId:'wc1',status:'Ishlamoqda',lastMaintenance:'',nextMaintenance:'',mtbf:412,mttr:1.7,downtime:2.4,maintenanceCost:4900000,maintenanceIntervalDays:30},
      {id:'eq2',name:'Fiber Laser 6kW',model:'FL-6000',serial:'FL6-19302',workCenterId:'wc2',status:'Servis yaqin',lastMaintenance:'',nextMaintenance:'',mtbf:286,mttr:2.3,downtime:5.1,maintenanceCost:6700000,maintenanceIntervalDays:21},
      {id:'eq3',name:'Powder Paint Line',model:'PCL-450',serial:'PCL-8820',workCenterId:'wc3',status:'Ishlamoqda',lastMaintenance:'',nextMaintenance:'',mtbf:518,mttr:1.2,downtime:1.8,maintenanceCost:3100000,maintenanceIntervalDays:30},
    ],
    maintenanceOrders:[],employees:JSON.parse(JSON.stringify(employees)),
    // The eight system roles (domain/access.ts); ids role1…role5 are the ones employees already use.
    roles:SYSTEM_ROLES.map(r=>({...clone(r),system:true})),
    expenses:[],engineeringChanges:[],
    qualityControlPoints:[
      {id:'qcp1',title:'Alyuminiy billet chemical cert',scope:'Incoming',productId:'rm1',frequency:'Every time',sampleRate:100,checkType:'Pass-Fail',instructions:'Supplier certificate va alloy grade 6063 ni tekshiring.',active:true},
      {id:'qcp2',title:'Profil kesim toleransi',scope:'In-process',productId:'p1',operationName:'Ekstruziya',frequency:'Random',sampleRate:20,checkType:'Measure',instructions:'±0.25 mm tolerans. Digital caliper bilan 5 nuqta.',active:true},
      {id:'qcp3',title:'Final surface inspection',scope:'Final',productId:'p2',frequency:'Every time',sampleRate:100,checkType:'Instructions',instructions:'Tirnalish, qoplama, yig‘ish momenti va labelni tekshiring.',active:true},
      {id:'qcp4',title:'Qoplama qalinligi',scope:'In-process',productId:'p1',operationName:'Bo‘yash',frequency:'Every time',sampleRate:10,checkType:'Measure',instructions:'70–90 μm. Har lotdan 3 namuna.',active:true},
      {id:'qcp5',title:'Po‘lat list qalinlik sertifikati',scope:'Incoming',productId:'rm2',frequency:'Every time',sampleRate:100,checkType:'Pass-Fail',instructions:'Mill certificate va 1.5 mm ±0.05 qalinlikni tekshiring.',active:true},
    ],
    maintenanceRequests:[],subcontractOrders:[],repairOrders:[],notifications:[],activity:[],currentEmployeeId:'em1',schemaVersion:SCHEMA_VERSION,
    timeLogs:[],downtimeEvents:[],lots:[],forecasts:[],returns:[],attachments:[],
  }
}

/** Clean start: master data, settings and roles; no orders, stock, purchases, QC, maintenance or history. */
export function createInitialState(now=new Date()):ManufacturingState{
  return clearTransactions(baseState(),now)
}

/** Demo history for tests — never used to initialise the app. */
export function createSeedState(now=new Date()):ManufacturingState{
  const counters=new Map<string,number>()
  // Generated ids contain a dash so they can never collide with the static master ids (bom1, p1, …).
  const id=(prefix:string)=>{const n=(counters.get(prefix)??0)+1;counters.set(prefix,n);return `${prefix}-${n}`}
  const day=(offset:number,h=8,m=0)=>{const d=new Date(now);d.setDate(d.getDate()+offset);d.setHours(h,m,0,0);return d}
  const ago=(minutes:number)=>new Date(now.getTime()-minutes*60000)
  const plus=(d:Date,minutes:number)=>new Date(d.getTime()+minutes*60000)
  let s=baseState()
  const user=(employeeId:string)=>s.employees.find(e=>e.id===employeeId)!
  const ctx=(at:Date,employeeId='em1'):Ctx=>({now:at,user:user(employeeId),id})
  const run=(out:Outcome)=>{if(!out.result.ok)throw new Error(`Seed step failed: ${out.result.message}`);s=out.state;return out.result.id||''}
  const tryRun=(out:Outcome)=>{s=out.state;return out.result}
  const orderById=(orderId:string)=>s.productionOrders.find(o=>o.id===orderId)!

  // Dates on masters relative to today
  s.equipment=s.equipment.map(e=>e.id==='eq1'?{...e,lastMaintenance:addDays(isoDate(now),-9),nextMaintenance:addDays(isoDate(now),21)}:e.id==='eq2'?{...e,lastMaintenance:addDays(isoDate(now),-19),nextMaintenance:addDays(isoDate(now),2)}:{...e,lastMaintenance:addDays(isoDate(now),-2),nextMaintenance:addDays(isoDate(now),28)})
  const thisWeek=weekStart(isoDate(now))
  const fc:[string,number[]][]=[['p1',[900,1050,1000,1150]],['p2',[160,170,170,180]],['p3',[180,200,200,220]]]
  s.forecasts=fc.flatMap(([productId,values])=>values.map((qty,i)=>({id:id('fc'),productId,period:addDays(thisWeek,i*7),qty})))

  s=rollUpStandardCosts(s)

  // Opening balances (untracked for FG serials, lots for raw)
  const opening=(itemId:string,itemType:'raw'|'finished',warehouseId:string,qty:number,unit:string,lot?:string)=>{
    s.stockBalances.push({id:id('st'),warehouseId,itemId,itemType,onHand:qty,reserved:0,incoming:0,unit,lot})
    if(lot)s.lots.push({id:id('lot'),code:lot,kind:'lot',itemId,itemType,qty,warehouseId,sourceType:'adjustment',sourceId:'opening',sourceCode:'OPENING',createdAt:stamp(day(-14,7)),consumedBy:[]})
    s.stockMovements.push({id:id('mv'),date:stamp(day(-14,7)),type:'Adjustment +',itemId,itemType,warehouseId,qty,source:'OPENING',note:'Boshlang‘ich qoldiq',user:'System',lot})
  }
  opening('rm1','raw','w1',2500,'kg','LOT-RM-AL-6063-OPEN')
  opening('rm2','raw','w1',1500,'kg','LOT-RM-ST-15-OPEN')
  opening('rm3','raw','w1',420,'kg','LOT-RM-PC-W-OPEN')
  opening('rm4','raw','w1',3500,'dona','LOT-RM-B-M6-OPEN')
  opening('rm2','raw','w4',260,'kg','LOT-RM-ST-15-CHI')
  opening('p1','finished','w3',900,'dona','LOT-FG-AL-4040-OPEN')
  opening('p2','finished','w3',90,'dona')
  opening('p3','finished','w3',700,'dona','LOT-FG-PK-115-OPEN')
  opening('p4','finished','w3',40,'kg')

  // Engineering history: V210 v1.9 → v2.0 (assembly torque 7 → 8 Nm)
  run(A.createEngineeringChange(s,ctx(day(-13,10),'em3'),{productId:'p2',title:'V210 yig‘ish momentini yangilash',reason:'Field feedback: korpus titrashi',changeSummary:'Moment 7→8 Nm; final QC majburiy.',effectiveDate:addDays(isoDate(now),-12)}))
  const eco2=s.engineeringChanges[0]
  const v20=s.boms.find(b=>b.id===eco2.newBomId)!
  run(A.saveBom(s,ctx(day(-13,11),'em3'),{...v20,operations:v20.operations.map(o=>o.id==='bo4'?{...o,instructions:'Kronshteynlarni o‘rnating. Bolt momenti 8 Nm (ECO).',qualityCheck:true}:o)}))
  run(A.setEcoStatus(s,ctx(day(-13,12),'em3'),eco2.id,'Review'))
  run(A.setEcoStatus(s,ctx(day(-13,15),'em1'),eco2.id,'Approved'))
  run(A.applyEngineeringChange(s,ctx(day(-12,8),'em1'),eco2.id))

  // Incoming inspection of a receipt, done on arrival (+45 min). Until it passes the stock stays in
  // quarantine and cannot be reserved, so history inspects before production draws on it.
  const inspect=(poId:string)=>{for(const q of s.qualityChecks.filter(q=>q.type==='Kirish'&&q.status==='Pending'&&q.sourceId===poId))run(A.resolveQuality(s,ctx(new Date(new Date(q.date.replace(' ','T')).getTime()+45*60000),'em4'),q.id,'Passed','','Sertifikat mos'))}

  // Purchasing history
  const poA=run(A.createPurchaseOrder(s,ctx(day(-13,9)),{supplierId:'su1',materialId:'rm1',qty:4000,price:22500}))
  const poB=run(A.createPurchaseOrder(s,ctx(day(-12,9)),{supplierId:'su2',materialId:'rm3',qty:200,price:68000}))
  run(A.markPurchaseInTransit(s,ctx(day(-11,9)),poA))
  run(A.receivePurchase(s,ctx(day(-10,10),'em2'),poA,'rm1',4000))
  inspect(poA)
  run(A.receivePurchase(s,ctx(day(-10,11),'em2'),poB,'rm3',200,undefined,isoDate(day(170,0))))

  // Maintenance history on the press
  const mr2=run(A.createEntity(s,ctx(day(-9,6,50),'em2'),'maintenanceRequests',{code:'MR-'+isoDate(day(-9)).slice(2).replace(/-/g,'')+'-01',equipmentId:'eq1',type:'Corrective',priority:'Normal',status:'Yangi',requestedBy:'em2',scheduled:stamp(day(-9,7,30)),reason:'Pressure sensor drift',downtimeHours:.9}))
  const ma2=run(A.approveMaintenanceRequest(s,ctx(day(-9,7,5),'em5'),mr2))
  run(A.startMaintenance(s,ctx(day(-9,7,30),'em5'),ma2))
  run(A.completeMaintenance(s,ctx(day(-9,8,25),'em5'),ma2,480000))

  type Run={productId:string;qty:number;offset:number;scrap?:number;line?:string;operator?:string;perf?:number;salesOrderId?:string;due?:number;priority?:'Past'|'Normal'|'Yuqori'|'Kritik'}
  const produce=(r:Run)=>{
    const t0=day(r.offset,7,0)
    const orderId=run(A.createProductionOrder(s,ctx(t0,'em1'),{productId:r.productId,quantity:r.qty,lineId:r.line,start:isoDate(t0),due:isoDate(day(r.offset+(r.due??1))),priority:r.priority||'Normal',salesOrderId:r.salesOrderId,responsibleId:r.operator||'em2'}))
    run(A.transitionProduction(s,ctx(plus(t0,10),'em1'),orderId,'Tasdiqlangan'))
    let t=day(r.offset,8,0)
    for(const wo of orderById(orderId).workOrders){
      const operator=wo.workCenterId==='wc3'?'em6':wo.workCenterId==='wc4'?'em7':wo.workCenterId==='wc2'?'em3':'em2'
      run(A.startWorkOrder(s,ctx(t,operator),orderId,wo.id,operator))
      const minutes=Math.round(wo.plannedMin/(r.perf??.9))
      t=plus(t,minutes)
      run(A.finishWorkOrder(s,ctx(t,operator),orderId,wo.id))
      t=plus(t,12)
    }
    const scrap=r.scrap??0
    run(A.reportOutput(s,ctx(t,'em2'),orderId,r.qty-scrap,scrap,'Ekstruziya chizig‘i · sirt nuqsoni'))
    run(A.transitionProduction(s,ctx(plus(t,5),'em2'),orderId,'Sifat nazoratida'))
    for(const q of s.qualityChecks.filter(q=>q.sourceId===orderId&&q.status==='Pending'))run(A.resolveQuality(s,ctx(plus(t,30),'em4'),q.id,'Passed','','OK'))
    run(A.transitionProduction(s,ctx(plus(t,45),'em2'),orderId,'Yakunlangan'))
    return orderId
  }
  const downtime=(equipmentId:string,reason:Parameters<typeof A.startDowntime>[3],at:Date,minutes:number,note:string)=>{
    run(A.startDowntime(s,ctx(at,'em5'),equipmentId,reason,note))
    const ev=s.downtimeEvents.find(d=>d.equipmentId===equipmentId&&!d.end)!
    run(A.endDowntime(s,ctx(plus(at,minutes),'em5'),ev.id))
  }

  produce({productId:'p1',qty:600,offset:-9,scrap:6,perf:.88})
  downtime('eq1','Setup / changeover',day(-9,17,0),35,'Matritsa almashtirish')
  produce({productId:'p3',qty:500,offset:-8,line:'l2',operator:'em3',perf:.92})
  const soH1=run(A.createSalesOrder(s,ctx(day(-8,11)),{customerId:'cu1',productId:'p1',qty:400,mode:'Make-to-stock',deliveryDate:isoDate(day(-7))}))
  run(A.deliverSalesOrder(s,ctx(day(-7,10),'em2'),soH1))
  produce({productId:'p2',qty:120,offset:-7,line:'l2',operator:'em3',perf:.86})
  downtime('eq2','Unplanned stop',day(-7,15,10),45,'Lazer bosh harorati oshdi')
  produce({productId:'p1',qty:800,offset:-6,scrap:9,perf:.9})
  const soH2=run(A.createSalesOrder(s,ctx(day(-6,9)),{customerId:'cu3',productId:'p3',qty:300,mode:'Make-to-stock',deliveryDate:isoDate(day(-4))}))
  produce({productId:'p3',qty:400,offset:-5,line:'l2',operator:'em3',perf:.9})
  downtime('eq3','Material wait',day(-5,13,0),30,'Powder coat yetkazilishi kutildi')
  run(A.deliverSalesOrder(s,ctx(day(-4,11),'em2'),soH2))
  produce({productId:'p1',qty:700,offset:-4,scrap:14,perf:.87})
  downtime('eq1','Quality hold',day(-4,16,30),20,'Sirt nuqsoni tekshiruvi')
  const soH3=run(A.createSalesOrder(s,ctx(day(-4,10)),{customerId:'cu2',productId:'p2',qty:60,mode:'Make-to-stock',deliveryDate:isoDate(day(-3))}))
  run(A.deliverSalesOrder(s,ctx(day(-3,10),'em2'),soH3))
  const poC=run(A.createPurchaseOrder(s,ctx(day(-6,9)),{supplierId:'su1',materialId:'rm2',qty:1200,price:14200}))
  run(A.receivePurchase(s,ctx(day(-3,10),'em2'),poC,'rm2',1200))
  inspect(poC)
  const soH4=run(A.createSalesOrder(s,ctx(day(-3,12)),{customerId:'cu2',productId:'p1',qty:500,mode:'Make-to-stock',deliveryDate:isoDate(day(-2))}))
  run(A.deliverSalesOrder(s,ctx(day(-2,9),'em2'),soH4))
  const poD=run(A.createPurchaseOrder(s,ctx(day(-5,9)),{supplierId:'su1',materialId:'rm1',qty:3000,price:22400}))
  run(A.markPurchaseInTransit(s,ctx(day(-4,9)),poD))
  run(A.receivePurchase(s,ctx(day(-2,10),'em2'),poD,'rm1',1500))
  produce({productId:'p3',qty:800,offset:-2,line:'l2',operator:'em3',perf:.91})
  downtime('eq2','Setup / changeover',day(-2,16,40),25,'Nesting dasturini almashtirish')

  // Current work in progress
  const mo2=run(A.createProductionOrder(s,ctx(day(-1,7),'em1'),{productId:'p2',quantity:250,lineId:'l2',start:isoDate(day(-1)),due:isoDate(day(1)),priority:'Kritik',responsibleId:'em3'}))
  run(A.transitionProduction(s,ctx(day(-1,7,10),'em1'),mo2,'Tasdiqlangan'))
  const [laser,assembly]=orderById(mo2).workOrders
  run(A.startWorkOrder(s,ctx(day(-1,8),'em3'),mo2,laser.id,'em3'))
  run(A.finishWorkOrder(s,ctx(day(-1,11,55),'em3'),mo2,laser.id))
  run(A.startWorkOrder(s,ctx(day(-1,12,30),'em7'),mo2,assembly.id,'em7'))
  run(A.reportOutput(s,ctx(day(-1,16,40),'em7'),mo2,70,0))
  const inProcess=s.qualityChecks.find(q=>q.sourceId===mo2&&q.status==='Pending')
  if(inProcess)run(A.resolveQuality(s,ctx(day(-1,16,55),'em4'),inProcess.id,'Failed','O‘lcham toleransidan chiqish: bukishdan keyin +1.8 mm'))
  run(A.transitionProduction(s,ctx(day(-1,17,5),'em7'),mo2,'Pauzada'))

  const so1=run(A.createSalesOrder(s,ctx(day(-2,15)),{customerId:'cu1',productId:'p1',qty:1800,mode:'Make-to-order',deliveryDate:isoDate(day(4))}))
  const mo4=s.salesOrders.find(o=>o.id===so1)!.productionOrderId!
  run(A.updateProductionOrder(s,ctx(day(-2,15,5)),mo4,{start:isoDate(day(1)),due:isoDate(day(3))}))
  run(A.transitionProduction(s,ctx(day(-2,15,10)),mo4,'Tasdiqlangan'))

  const mo1=run(A.createProductionOrder(s,ctx(day(-1,7)),{productId:'p1',quantity:1200,lineId:'l1',start:isoDate(day(-1)),due:isoDate(day(1)),priority:'Yuqori',responsibleId:'em2'}))
  run(A.transitionProduction(s,ctx(day(-1,7,15)),mo1,'Tasdiqlangan'))
  const [extr,paint]=orderById(mo1).workOrders
  run(A.startWorkOrder(s,ctx(day(-1,8),'em2'),mo1,extr.id,'em2'))
  run(A.finishWorkOrder(s,ctx(day(-1,13,50),'em2'),mo1,extr.id))
  for(const q of s.qualityChecks.filter(q=>q.sourceId===mo1&&q.status==='Pending'))run(A.resolveQuality(s,ctx(day(-1,14,10),'em4'),q.id,'Passed','','0.12 mm'))
  run(A.startWorkOrder(s,ctx(day(-1,14,20),'em6'),mo1,paint.id,'em6'))
  run(A.reportOutput(s,ctx(day(-1,19,40),'em6'),mo1,560,8,'Qoplamada pufakcha'))
  run(A.pauseWorkOrder(s,ctx(day(-1,19,50),'em6'),mo1,paint.id))
  run(A.startWorkOrder(s,ctx(ago(150),'em6'),mo1,paint.id,'em6'))
  run(A.reportOutput(s,ctx(ago(20),'em6'),mo1,220,4,'Qoplamada pufakcha'))

  const so2=run(A.createSalesOrder(s,ctx(day(-1,10)),{customerId:'cu2',productId:'p2',qty:120,mode:'Make-to-stock',deliveryDate:isoDate(day(1))}))
  void so2
  const so4=run(A.createSalesOrder(s,ctx(ago(300)),{customerId:'cu3',productId:'p3',qty:200,mode:'Make-to-stock',deliveryDate:isoDate(day(2))}))
  void so4
  const so3=run(A.createSalesOrder(s,ctx(ago(240)),{customerId:'cu2',productId:'p2',qty:150,mode:'Make-to-order',deliveryDate:isoDate(day(5))}))
  const mo6=s.salesOrders.find(o=>o.id===so3)!.productionOrderId!
  tryRun(A.transitionProduction(s,ctx(ago(235)),mo6,'Tasdiqlangan'))  // rm4 short → "Material kutilmoqda"
  run(A.createProductionOrder(s,ctx(ago(200)),{productId:'p3',quantity:300,lineId:'l2',start:isoDate(day(2)),due:isoDate(day(3)),responsibleId:'em3',source:'Rejali to‘ldirish'}))

  // Open purchasing
  const po1=run(A.createPurchaseOrder(s,ctx(day(-2,9)),{supplierId:'su1',materialId:'rm2',qty:2000,price:14200,expectedDate:isoDate(day(1))}))
  run(A.markPurchaseInTransit(s,ctx(day(-1,9)),po1))
  run(A.createPurchaseOrder(s,ctx(day(-1,11)),{supplierId:'su3',materialId:'rm4',qty:5000,price:1420,expectedDate:isoDate(day(2))}))

  // Subcontracting (outsourced bracket cutting at Chirchiq partner)
  const sc1=run(A.createEntity(s,ctx(day(-2,14)),'subcontractOrders',{code:'SUB-'+isoDate(day(-2)).slice(2).replace(/-/g,'')+'-01',supplierId:'su1',productId:'p3',qty:200,status:'Draft',materialIds:['rm2'],expectedDate:isoDate(day(3)),cost:4200000}))
  run(A.advanceSubcontract(s,ctx(day(-2,16)),sc1))

  // Quality & returns
  run(A.createReturn(s,ctx(ago(180),'em4'),{salesOrderId:soH1,productId:'p1',qty:20,reason:'Qoplamada chizilish (transport)'}))
  const historyAlerts=s.qualityAlerts.filter(a=>a.createdAt<stamp(day(-3)))
  for(const a of historyAlerts)run(A.updateEntity(s,ctx(day(-3,15),'em4'),'qualityAlerts',a.id,{status:'Yopilgan',rootCause:'Matritsa yuzasidagi tirnalish',correctiveAction:'Matritsa polirovka qilindi',preventiveAction:'Har 8 soatda matritsa vizual nazorati (QCP)',resolution:'Keyingi 2 lotda scrap < 1%'}))

  // Maintenance ahead
  const mr1=run(A.createEntity(s,ctx(day(-1,9),'em3'),'maintenanceRequests',{code:'MR-'+isoDate(day(-1)).slice(2).replace(/-/g,'')+'-02',equipmentId:'eq2',type:'Preventive',priority:'Yuqori',status:'Yangi',requestedBy:'em3',scheduled:stamp(day(2,9)),reason:'Lens contamination va beam quality drift',downtimeHours:2.5}))
  run(A.approveMaintenanceRequest(s,ctx(day(-1,10),'em5'),mr1))
  run(A.createEntity(s,ctx(ago(90),'em2'),'maintenanceRequests',{code:'MR-'+isoDate(now).slice(2).replace(/-/g,'')+'-03',equipmentId:'eq3',type:'Corrective',priority:'Normal',status:'Yangi',requestedBy:'em6',scheduled:stamp(day(1,14)),reason:'Pech haroratida ±6 °C tebranish',downtimeHours:1}))
  const ro1=run(A.createEntity(s,ctx(ago(260),'em5'),'repairOrders',{code:'REP-'+isoDate(now).slice(2).replace(/-/g,'')+'-01',equipmentId:'eq2',status:'Yangi',issue:'Laser head temperature intermittently high',technicianId:'em5',partsCost:0,laborHours:1.2,createdAt:stamp(ago(260))}))
  run(A.advanceRepair(s,ctx(ago(230),'em5'),ro1))

  // ECO in review: faster paint changeover on the profile line
  run(A.createEngineeringChange(s,ctx(day(-1,11),'em1'),{productId:'p1',title:'Profil qoplama jarayonini optimallashtirish',reason:'Waste va cycle time kamaytirish',changeSummary:'Bo‘yash setup 18→14 min; qoplama o‘lchovi har lotda (QCP-4).',effectiveDate:isoDate(day(6))}))
  const eco1=s.engineeringChanges[0]
  const v33=s.boms.find(b=>b.id===eco1.newBomId)!
  run(A.saveBom(s,ctx(day(-1,11,20),'em1'),{...v33,operations:v33.operations.map(o=>o.id==='bo2'?{...o,setupMin:14}:o)}))
  run(A.setEcoStatus(s,ctx(day(-1,12),'em1'),eco1.id,'Review'))

  // Documents (metadata only — file contents are not stored in the demo)
  const doc=(entityType:string,entityId:string,name:string,size:number,at:Date)=>run(A.addAttachment(s,ctx(at),{entityType,entityId,name,size,mime:'application/pdf'}))
  doc('bom','bom1','WI-EXT-4040-v3.pdf',284000,day(-20,10))
  doc('eco',eco1.id,'QCP-COAT-04.pdf',96000,day(-1,11,30))
  doc('eco',eco2.id,'WI-V210-ASSEMBLY.pdf',188000,day(-13,11))
  doc('equipment','eq1','EP-1800 service manual.pdf',2400000,day(-40,9))
  doc('production',mo2,'V210 tolerance report.pdf',74000,day(-1,17))

  // Expenses (utilities, overhead, logistics)
  for(let d=-7;d<=-1;d++){
    s.expenses.push({id:id('ex'),date:isoDate(day(d)),type:'Electricity',sourceId:'l1',amount:3900000+((d*7919)%5+5)*110000,note:'Ekstruziya liniyasi elektr energiya'})
    s.expenses.push({id:id('ex'),date:isoDate(day(d)),type:'Electricity',sourceId:'l2',amount:1700000+((d*104729)%4+4)*90000,note:'Metall liniyasi elektr energiya'})
  }
  s.expenses.push({id:id('ex'),date:isoDate(day(-10)),type:'Overhead',sourceId:'b1',amount:12000000,note:'Sex ijarasi — oylik'})
  s.expenses.push({id:id('ex'),date:isoDate(day(-4)),type:'Transport',sourceId:'cu3',amount:1800000,note:'Chirchiq yetkazib berish'})
  s.expenses.push({id:id('ex'),date:isoDate(day(-3)),type:'Labor',sourceId:'b1',amount:6400000,note:'Qo‘shimcha smena (overtime)'})
  s.expenses.sort((a,b)=>b.date.localeCompare(a.date))

  // Incoming inspections for receipts older than the latest one were completed on arrival.
  const latestIncoming=s.qualityChecks.filter(q=>q.type==='Kirish').sort((a,b)=>b.date.localeCompare(a.date))[0]
  for(const q of s.qualityChecks.filter(q=>q.type==='Kirish'&&q.status==='Pending'&&q.id!==latestIncoming?.id))run(A.resolveQuality(s,ctx(new Date(new Date(q.date.replace(' ','T')).getTime()+45*60000),'em4'),q.id,'Passed','','Sertifikat mos'))
  // Equipment close to its service date is flagged for planners.
  s.equipment=s.equipment.map(e=>e.status==='Ishlamoqda'&&e.nextMaintenance<=addDays(isoDate(now),3)?{...e,status:'Servis yaqin'}:e)

  // Older notifications are already read
  const cutoff=stamp(ago(24*60))
  s.notifications=s.notifications.map(n=>n.date<cutoff?{...n,read:true}:n)
  s.currentEmployeeId='em1'
  return s
}
