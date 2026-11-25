import {actionRules,entityRules,hasPermission,PERMISSION_MODULES} from '../../domain/access'
import {moduleNav} from '../../routes/navigation'
export {moduleNav} from '../../routes/navigation'
import type {EntityKeyName,Rule,Rules} from '../../domain/access'
import type {PermissionAction,Role} from '../../types'

type Copy={summary:string;detail:string}
const copy=(summary:string,detail=summary):Copy=>({summary,detail})

/** One explanation for every navigable view. The route table remains the source of paths and labels. */
export const HELP_COPY:Record<string,Copy>={
  '/':copy('Bugungi buyurtmalar, zaxira, sifat va uskunalar holatini bir joyda ko‘ring.','KPI kartalari davr bo‘yicha hisoblangan ko‘rsatkichlarni beradi. Kartani yoki “Barchasi” havolasini bosib tegishli yozuvlarga o‘ting; ko‘rsatkichning o‘zi biznes amalini bajarmaydi.'),
  '/production:overview':copy('Ishlab chiqarish holati, reja va ochiq ishlarni ko‘ring.'),
  '/production:orders':copy('MO — ishlab chiqarish buyurtmalarini yarating, tasdiqlang va kuzating.','Buyurtma mahsulot, miqdor, BOM, muddat va mas’ulga bog‘lanadi. Ishga tushishdan oldin material mavjudligini va ish markazi rejasini tekshiring.'),
  '/production:planning':copy('Ish markazlari quvvati va buyurtma jadvalini solishtiring.'),
  '/production:mps':copy('MPS — tayyor mahsulot bo‘yicha asosiy ishlab chiqarish rejasini ko‘ring.'),
  '/production:mrp':copy('MRP — BOM va qoldiq asosida material ehtiyoji hamda tavsiyalarni ko‘ring.','Tavsiya avtomatik xarid yoki MO emas; tasdiqlash tegishli yaratish huquqini talab qiladi.'),
  '/production:operations':copy('Ish markazlaridagi operatsiyalar navbati va reja/amaldagi vaqtni ko‘ring.'),
  '/production:advanced':copy('MOni bo‘lish, birlashtirish, backorder yoki unbuild amallarini kuzating.','Bu amallar rezerv, stock va tarixga ta’sir qiladi; avval buyurtma holatini tekshiring.'),
  '/production:shop-floor':copy('Sexdagi ishni boshlang, natija, scrap va to‘xtashni qayd eting.','Operatorga biriktirilgan ish markazi va tasdiqlangan MO kerak. “START”, “NATIJA”, “SCRAP” va “YAKUNLASH” amallari haqiqiy yozuvlarni o‘zgartiradi.'),
  '/products:all':copy('Tayyor mahsulot kartalari, birlik va tannarx ma’lumotlarini ko‘ring.'),
  '/products:categories':copy('Mahsulot guruhlarini tartibga soling.'),
  '/products:bom':copy('BOM — bir mahsulot uchun kerakli komponentlar va miqdorlar ro‘yxati.','Qoralamani tekshirib tasdiqlang; faol BOM ishlab chiqarish material talabiga asos bo‘ladi.'),
  '/products:routing':copy('Mahsulot operatsiyalari ketma-ketligi va ish markazlarini belgilang.'),
  '/products:variants':copy('Mahsulot variantlari va ularga tegishli stockni ko‘ring.'),
  '/products:versions':copy('BOM versiyalarini va qaysi biri faol ekanini kuzating.'),
  '/products:plm':copy('ECO — mahsulot tuzilmasidagi o‘zgarishni qoralama, ko‘rib chiqish va tasdiqlash orqali boshqaring.'),
  '/materials:all':copy('Xomashyo kartasi, birlik, minimal qoldiq va yetkazib beruvchini ko‘ring.'),
  '/materials:requirements':copy('Ishlab chiqarish buyurtmalari bo‘yicha material talabini ko‘ring.'),
  '/materials:stock':copy('Materialning omborlar bo‘yicha qoldig‘i, rezervi va foydalanish mumkin bo‘lgan qismini solishtiring.'),
  '/materials:shortages':copy('Yetishmayotgan materiallarni va ularni to‘ldirish zaruratini ko‘ring.'),
  '/warehouse:stock':copy('Har bir ombordagi on hand, rezerv, karantin va available qoldiqni ko‘ring.','Available = qoldiq − rezerv − karantin. LOT bilan yuritiladigan materialda foydalanish mumkin bo‘lgan LOT miqdori ham mos bo‘lishi kerak.'),
  '/warehouse:warehouses':copy('Filialga biriktirilgan omborlarni ko‘ring va vakolatingiz bo‘lsa boshqaring.'),
  '/warehouse:locations':copy('Ombor ichidagi joylarni va shu joylardagi qoldiqni kuzating.'),
  '/warehouse:movements':copy('Qabul, chiqim, transfer va tuzatishlarning stock harakatlarini tekshiring.'),
  '/warehouse:transfers':copy('Omborlararo jo‘natish, qabul qilish va transfer tarixini boshqaring.','Manba va qabul ombori farq qilishi kerak. Sabab majburiy; ikki bosqichli transfer qabul qilinmaguncha yo‘lda turadi.'),
  '/warehouse:inventory':copy('Inventarizatsiyada sanalgan va tizimdagi qoldiq farqini qayd eting.'),
  '/warehouse:lots':copy('LOT kelib chiqishi, muddati, holati va omborini kuzating.','Muddati o‘tgan, karantindagi yoki boshqa itemga tegishli LOTni chiqimga ishlatmang.'),
  '/warehouse:serials':copy('Yakka seriya raqamlarining kelib chiqishi va harakatini ko‘ring.'),
  '/warehouse:maintenance':copy('Maintenance order uchun ehtiyot qism chiqimi yoki qaytishini qayd eting.','Muhandis faqat o‘ziga biriktirilgan ishga qism chiqaradi. Ombor roli o‘z ombori va filial doirasida ishlaydi.'),
  '/warehouse:barcode':copy('SKU, LOT va serial kodlarini qidirish hamda tekshirish uchun foydalaning.'),
  '/purchases:overview':copy('Xarid talabi, buyurtma, qabul va yetkazib beruvchi holatini bir joyda ko‘ring.'),
  '/purchases:requests':copy('Ichki xarid talabini yuboring va qaror holatini kuzating.'),
  '/purchases:orders':copy('PO — yetkazib beruvchiga yuboriladigan xarid buyurtmasini kuzating.','Qoralama, tasdiq va qabul bosqichlarini ajrating. Qabul va invoice alohida yozuvlar.'),
  '/purchases:suppliers':copy('Yetkazib beruvchilar va ularning material bog‘lanishlarini ko‘ring.'),
  '/purchases:receiving':copy('Kelgan tovar miqdori va LOTini xarid buyurtmasiga bog‘lab qabul qiling.'),
  '/purchases:replacements':copy('Rad etilgan qabul uchun yetkazib beruvchi almashtirish talabini kuzating.'),
  '/purchases:subcontracting':copy('Tashqi bajaruvchiga berilgan ish va uning qaytishini kuzating.'),
  '/sales:overview':copy('Sotuv buyurtmalari, jo‘natma va debitorlik holatini ko‘ring.'),
  '/sales:orders':copy('SO — mijoz buyurtmasi, mahsulot, miqdor va statusni boshqaring.'),
  '/sales:customers':copy('Mijoz kartalari va aloqa ma’lumotlarini ko‘ring.'),
  '/sales:receivables':copy('Mijoz qarzi, invoice, to‘lov va tuzatish tarixini solishtiring.'),
  '/sales:delivery':copy('Rezervlangan buyurtma uchun ombordan yetkazib berishni qayd eting.','Jo‘natish stockni kamaytiradi; LOT va mavjud qoldiq tekshiriladi.'),
  '/sales:returns':copy('Mijoz qaytargan mahsulotni tekshiruv va yakuniy qaror orqali kuzating.'),
  '/quality:overview':copy('Kirish, jarayon va final sifat nazorati holatini ko‘ring.'),
  '/quality:checks':copy('Tekshiruvni natija va sabab bilan yakunlang.','Rad etilgan qabul karantinda qoladi; qaror stock va keyingi jarayonga ta’sir qilishi mumkin.'),
  '/quality:defects':copy('Aniqlangan nuqsonlar va ularning manbasini kuzating.'),
  '/quality:rework':copy('Qayta ishlashga yuborilgan miqdor va MOni kuzating.'),
  '/quality:scrap':copy('Yaroqsiz deb hisobdan chiqarilgan miqdor va sababni ko‘ring.'),
  '/quality:alerts':copy('NCR — nomuvofiqlik xabarlari va javobgarni kuzating.'),
  '/quality:control-points':copy('Operatsiyaga bog‘langan nazorat nuqtalarini boshqaring.'),
  '/quality:capa':copy('CAPA — tuzatish va oldini olish choralarini bajarib, alohida tekshiring.'),
  '/equipment:equipment':copy('Uskuna holati, servis, ish soati va OEE ma’lumotlarini ko‘ring.'),
  '/equipment:work-centers':copy('Ish markazining liniyasi, quvvati, yuklamasi va uskunalarini ko‘ring.'),
  '/equipment:maintenance':copy('Maintenance ishini rejalang, boshlang, qism sarflang va yakunlang.'),
  '/equipment:preventive':copy('Kun, hafta, oy yoki ish soatiga bog‘langan profilaktik xizmatni rejalang.'),
  '/equipment:downtime':copy('Uskuna to‘xtashining boshlanishi, sababi va davomiyligini kuzating.'),
  '/equipment:requests':copy('Maintenance so‘rovini yuboring va tasdiq yoki rad javobini kuzating.'),
  '/equipment:repair':copy('Ta’mir bosqichlari va xarajatini kuzating.'),
  '/employees:all':copy('Xodim, bo‘lim, filial, rol va ish markazi ma’lumotlarini boshqaring.'),
  '/employees:roles':copy('Rolga berilgan modul va amal ruxsatlarini ko‘ring.'),
  '/employees:time':copy('Xodimlarning ish vaqti yozuvlarini ko‘ring.'),
  '/employees:performance':copy('Xodim samaradorligi ko‘rsatkichlarini ko‘ring.'),
  '/employees:activity':copy('Biznes amallari kim tomonidan qachon bajarilganini kuzating.'),
  '/costs:overview':copy('Standart va amaldagi xarajatlarni umumiy ko‘rinishda solishtiring.'),
  '/costs:expenses':copy('Xarajat yozuvlari va ularning manbasini ko‘ring.'),
  '/costs:costing':copy('Mahsulot va MO tannarxini komponentlar bo‘yicha tahlil qiling.','Standart narx reja uchun, LOT narxi qabul qilingan partiyaning amaldagi qiymati uchun ishlatiladi.'),
  '/costs:labor':copy('Mehnat soati va stavkasi asosidagi xarajatni ko‘ring.'),
  '/costs:machine':copy('Uskuna va ish markazi vaqti bo‘yicha xarajatni ko‘ring.'),
  '/costs:overhead':copy('Umumishlab chiqarish xarajatlari taqsimotini ko‘ring.'),
  '/reports:overview':copy('Hisobotlarga o‘ting va davr hamda filtrlarni tanlang.'),
  '/reports:production':copy('MO natijasi va reja-fakt ko‘rsatkichlarini tahlil qiling.'),
  '/reports:costs':copy('Ishlab chiqarish va boshqa xarajatlar bo‘yicha hisoblangan ko‘rsatkichlarni ko‘ring.'),
  '/reports:quality':copy('Sifat natijasi, brak va pass rate ni ko‘ring.'),
  '/reports:inventory':copy('Ombor qiymati, standart va LOT qiymati farqini ko‘ring.'),
  '/reports:efficiency':copy('Operatsiya va xodim samaradorligi ko‘rsatkichlarini ko‘ring.'),
  '/reports:oee':copy('OEE — uskuna mavjudligi, ishlash tezligi va sifat ulushi natijasini ko‘ring.'),
  '/reports:profitability':copy('Sotuv daromadi va tannarx asosidagi foydalilikni ko‘ring.'),
  '/reports:traceability':copy('LOT va mahsulotning kirishdan chiqishgacha bog‘lanishini qidiring.'),
  '/admin:dashboard':copy('Foydalanuvchi, xavfsizlik va tizim holatini vakolatingiz doirasida ko‘ring.'),
  '/admin:users':copy('Xodimga akkaunt oching, rolni biriktiring yoki kirishni boshqaring.'),
  '/admin:roles':copy('Rol matritsasida modul va amal huquqlarini boshqaring.'),
  '/admin:organization':copy('Kompaniya rekvizitlari va tuzilmasini ko‘ring.'),
  '/admin:activity':copy('Kirish, admin va biznes amallarining jurnalini ko‘ring.'),
  '/admin:security':copy('Parol va sessiya siyosatini boshqaring.'),
  '/admin:system':copy('Saqlash, autentifikatsiya va backend holati haqida ma’lumotni ko‘ring.'),
  '/subscription':copy('Joriy tarif, limit va obuna muddatini ko‘ring.'),
  '/ai':copy('ZENIX AI yordamchisida ochiq biznes ma’lumotlari haqida savol bering.','AI javobi tavsiya va tahlil uchun; u biznes amalini o‘zi tasdiqlamaydi. Natijani manba yozuv bilan tekshiring.'),
  '/settings:business':copy('Kompaniya nomi va asosiy biznes parametrlarini ko‘ring.'),
  '/settings:locations':copy('Filial, liniya va ish konteksti bog‘lanishlarini boshqaring.'),
  '/settings:manufacturing':copy('Ishlab chiqarish rejalash parametrlarini ko‘ring.'),
  '/settings:inventory':copy('Ombor va stock bo‘yicha sozlamalarni ko‘ring.'),
  '/settings:quality':copy('Sifat nazorati sozlamalarini ko‘ring.'),
  '/settings:employees':copy('Rol va xodimga oid sozlamalarni ko‘ring.'),
  '/settings:notifications':copy('Qaysi turdagi bildirishnomalar ko‘rinishini belgilang.'),
  '/settings:ai':copy('ZENIX AI funksiyasi yoqilganini va uning sozlamalarini ko‘ring.'),
  '/settings:appearance':copy('Rang, shrift va zichlikni shaxsiy ko‘rinish uchun moslang.'),
  '/settings:system':copy('Brauzer ma’lumotlari va backup eksport/import holatini ko‘ring.'),
}

export type HelpTopic={id:string;title:string;module:string;path:string;summary:string;detail:string;category:string}
export const HELP_TOPICS:HelpTopic[]=[...moduleNav.flatMap(n=>{
  const views=n.items?.length?n.items.map(i=>({key:i.key,label:i.label,anyOf:i.anyOf})):[{key:'',label:n.label,anyOf:undefined}]
  return views.map(v=>{
    const id=v.key?`${n.path}:${v.key}`:n.path
    const content=HELP_COPY[id]
    return {id,title:v.key?`${n.label} · ${v.label}`:n.label,module:n.module,path:v.key?`${n.path}?view=${v.key}`:n.path,
      summary:content?.summary||'Bu bo‘lim uchun qo‘llanma hozircha mavjud emas.',detail:content?.detail||'Yordam markazidan boshqa bo‘limni tanlang.',category:n.label}
  })
}),{id:'/ai',title:'ZENIX AI',module:'ai',path:'/ai',summary:HELP_COPY['/ai'].summary,detail:HELP_COPY['/ai'].detail,category:'ZENIX AI'}]

export type Can=(module:string,action?:PermissionAction)=>boolean
const navFor=(path:string)=>moduleNav.find(n=>n.path===path)
export function canOpenTopic(topic:HelpTopic,can:Can){
  const path=topic.path.split('?')[0],nav=navFor(path)
  if(path==='/ai')return can('ai')
  if(!nav)return false
  if(!(nav.anyOf||[nav.module]).some(m=>can(m)))return false
  const key=new URLSearchParams(topic.path.split('?')[1]||'').get('view')
  const item=nav.items?.find(i=>i.key===key)
  return !item?.anyOf||item.anyOf.some(m=>can(m))
}
export const visibleTopics=(can:Can)=>HELP_TOPICS.filter(t=>canOpenTopic(t,can))
export function topicAt(pathname:string,search:string,can:Can):HelpTopic|undefined{
  if(pathname==='/ai')return visibleTopics(can).find(t=>t.id==='/ai')
  const nav=navFor(pathname)
  if(!nav)return undefined
  const view=new URLSearchParams(search).get('view')||nav.defaultView||''
  return visibleTopics(can).find(t=>t.id===(view?`${pathname}:${view}`:pathname))
}

/** What the guided action needs: a domain command, an entity CRUD rule, one rule, or any of several rules (the visible button's own gate). */
type Requirement={command?:string;args?:unknown[];entity?:EntityKeyName;action?:PermissionAction;rule?:Rule;anyOf?:Rules}
const command=(name:string,args:unknown[]=[]):Requirement=>({command:name,args})
const entity=(key:EntityKeyName,action:PermissionAction):Requirement=>({entity:key,action})
const rule=(module:string,action:PermissionAction):Requirement=>({rule:[module,action]})
const anyOf=(...rules:Rule[]):Requirement=>({anyOf:rules})
export type HelpGuide={id:string;title:string;topic:string;purpose:string;requirements:Requirement[];prerequisites:string[];steps:string[];fields:string[];result:string;next:string;errors:string[];terms?:string[]}
export const HELP_GUIDES:HelpGuide[]=[
  {id:'material',title:'Xomashyo kartasini qo‘shish',topic:'/materials:all',purpose:'Yangi materialni xarid va ishlab chiqarishda tanlashga tayyorlash.',requirements:[entity('rawMaterials','create')],prerequisites:['Material kodi va o‘lchov birligini aniqlang.'],steps:['Xomashyo → Xomashyo bo‘limini oching.','“Xomashyo qo‘shish” ni bosing.','Majburiy maydonlarni to‘ldirib “Saqlash” ni bosing.'],fields:['Nomi va SKU: materialni tanish uchun.','Birlik: qoldiq va BOM miqdori uchun.','Min stock (safety), Reorder point va Standart narx: reja hamda ogohlantirish uchun.','Lot kuzatuvi: partiya bo‘yicha qabul va chiqim kerak bo‘lsa yoqing.'],result:'Material kartasi ro‘yxatda paydo bo‘ladi; qoldiq faqat haqiqiy qabul bilan oshadi.',next:'Xaridlar → Yetkazib beruvchilar yoki Buyurtmalar bo‘limiga o‘ting.',errors:['SKU takrorlansa boshqa kod tanlang.','Majburiy birlik yoki nom yo‘q bo‘lsa shakldagi xabarni tuzating.']},
  {id:'purchase-request',title:'Xarid talabini yuborish',topic:'/purchases:requests',purpose:'Yetishmayotgan material uchun ichki talab yaratish.',requirements:[command('createPurchaseRequest'),command('submitPurchaseRequest')],prerequisites:['Material va kerakli miqdor ma’lum bo‘lsin.'],steps:['Xaridlar → Talablar bo‘limiga o‘ting.','“Yangi so‘rov” ni bosing, material va miqdorni kiriting, qoralamani saqlang.','Talabni ochib “Tasdiqlashga yuborish” ni bosing; qaror holatini shu ro‘yxatda kuzating.'],fields:['Material: xarid qilinadigan item.','Miqdor va kerak sana: ta’minot rejasi uchun.'],result:'Talab ko‘rib chiqish bosqichiga o‘tadi; stock o‘zgarmaydi.',next:'Tasdiqlash huquqiga ega xodim talab bo‘yicha qaror qabul qiladi.',errors:['Material tanlanmagan yoki miqdor noto‘g‘ri bo‘lsa shakl xabarini tuzating.']},
  {id:'purchase-decision',title:'Xarid talabini ko‘rib chiqish',topic:'/purchases:requests',purpose:'Yuborilgan talabga tasdiq yoki rad qarorini berish.',requirements:[command('decidePurchaseRequest')],prerequisites:['Yuborilgan talab mavjud bo‘lsin.'],steps:['Xaridlar → Talablar bo‘limida talabni oching.','Material, miqdor va sababni tekshiring.','“Tasdiqlash” yoki “Rad etish” ni bosing; rad etishda sababni yozing.'],fields:['Rad sababi: rad qarori nima uchun berilganini tushuntiradi.'],result:'Talab holati va tarixi yangilanadi; qabul qilinmaguncha stock o‘zgarmaydi.',next:'Tasdiqlangan talabda “PO yaratish” tugmasi chiqadi.',errors:['Talab hali yuborilmagan bo‘lsa yuboruvchi bilan bog‘laning.']},
  {id:'purchase-order',title:'Xarid buyurtmasini tayyorlash',topic:'/purchases:orders',purpose:'Yetkazib beruvchiga material buyurtmasini rasmiylashtirish.',requirements:[command('createPurchaseOrder',[{status:'Qoralama'}])],prerequisites:['Yetkazib beruvchi va material kartasi mavjud bo‘lsin.'],steps:['Xaridlar → Buyurtmalar bo‘limini oching va “Yangi PO” ni bosing.','Supplier, Qabul ombori va Expected date ni tanlang; “Qator” bilan material, Miqdor va Narxni kiriting.','“Qoralama saqlash” ni bosing (tasdiqlash huquqi bo‘lsa tugma “Yaratish va tasdiqlash” deb ko‘rinadi).'],fields:['Supplier: faqat unga biriktirilgan materiallar tanlanadi.','Miqdor va Narx: PO summasi uchun.','Qabul ombori: keyingi qabul manzili.'],result:'PO qoralamasi yaratiladi; stock hali o‘zgarmaydi.',next:'Qoralamada “Tasdiqlashga yuborish” ni bosing; ruxsatli xodim “Tasdiqlash” dan so‘ng tovar qabul qilinadi.',errors:['Supplier yoki item yo‘q bo‘lsa avval kartasini yarating.','“Bu supplierga faol material biriktirilmagan” chiqsa Xaridlar → Yetkazib beruvchilar bo‘limida materialni biriktiring.']},
  {id:'goods-receipt',title:'Xaridni qabul qilish',topic:'/purchases:receiving',purpose:'Haqiqatan kelgan tovarni stockga kiritish.',requirements:[command('receivePurchase')],prerequisites:['Qabulga tayyor PO va faol ombor bo‘lsin.'],steps:['Xaridlar → Qabul qilish bo‘limini yoki tasdiqlangan POni oching.','“Qabul qilish” ni bosing; kelgan miqdor va kerak bo‘lsa LOT ma’lumotini kiriting.','Qabulni tasdiqlang va Ombor → Qoldiqlar bo‘limida natijani tekshiring.'],fields:['Qabul miqdori: yetib kelgan haqiqiy miqdor.','LOT kodi va muddati: partiya kuzatuvi uchun.','Ombor: qabul qilinadigan joy.'],result:'Qabul yozuvi va ombor qoldig‘i yangilanadi; invoice alohida qayd etiladi.',next:'Sifat tekshiruvi kerak bo‘lsa Sifat → Tekshiruvlar bo‘limiga o‘ting.',errors:['PO miqdoridan ortiq qabulni tuzating.','LOT talab qilinsa haqiqiy partiya kodini kiriting.']},
  {id:'bom',title:'BOMni faollashtirish',topic:'/products:bom',purpose:'MO uchun tekshirilgan komponent tarkibini qo‘llash.',requirements:[command('activateBom')],prerequisites:['Mahsulot va BOM qoralamasi mavjud bo‘lsin.'],steps:['Mahsulotlar → BOM bo‘limida qoralamani oching.','Komponentlar, birliklar va miqdorlarni tekshiring.','“Faollashtirish” ni bosing va tasdiqlash oynasida yana tasdiqlang; joriy faol versiya arxivga o‘tadi.'],fields:['Komponent va miqdor: bir tayyor mahsulot uchun sarf.'],result:'Faol BOM MRP va MO material ehtiyojiga asos bo‘ladi.',next:'Ishlab chiqarish → Buyurtmalar bo‘limida MOni tayyorlang.',errors:['Komponent yoki miqdor yetishmasa qoralamani tuzating.']},
  {id:'production-order',title:'MO yaratish',topic:'/production:orders',purpose:'Tasdiqlangan mahsulotni ishlab chiqarish rejasiga kiritish.',requirements:[command('createProductionOrder')],prerequisites:['Mahsulot, faol BOM va tegishli ish markazi tayyor bo‘lsin.'],steps:['Ishlab chiqarish → Buyurtmalar bo‘limiga o‘ting.','“Yangi buyurtma” ni bosing.','Mahsulot, miqdor va muddatni kiriting; saqlang.'],fields:['Mahsulot va miqdor: ishlab chiqariladigan natija.','Muddat va ish markazi: rejalash uchun.'],result:'MO yaratiladi; ish boshlanishi va material sarfi keyingi amallarda qayd etiladi.',next:'Material mavjudligi va rejalashni tekshiring.',errors:['Faol BOM yoki material yo‘q bo‘lsa Mahsulotlar va MRPni tekshiring.']},
  {id:'shop-floor',title:'Sex ishini bajarish',topic:'/production:shop-floor',purpose:'Biriktirilgan operatsiyaning haqiqiy boshlanishi va natijasini qayd etish.',requirements:[command('startWorkOrder'),command('reportOutput')],prerequisites:['Tasdiqlangan MO va sizga ruxsatli ish markazi bo‘lsin.'],steps:['Ishlab chiqarish → Sex ishlari bo‘limini oching.','Joriy operatsiyada “START” ni bosing; kerak bo‘lsa “SETUP TUGADI” ni belgilang.','“NATIJA” da tayyor miqdorni, “SCRAP” da yaroqsiz miqdorni kiriting.','Operatsiya tugaganda “YAKUNLASH” ni bosing.'],fields:['Tayyor miqdor: real ishlab chiqarilgan mahsulot.','Scrap miqdori va sabab: yaroqsiz chiqim.','SKU / LOT: materialni tekshirish uchun.'],result:'MO, operatsiya va material tarixi haqiqiy amallarga ko‘ra yangilanadi.',next:'Kerak bo‘lsa “SIFAT NAZORATI” orqali tekshiruvga yuboring.',errors:['“START” o‘chirilgan bo‘lsa MO holati yoki ish markazi birikmasini tekshiring.','LOT mos kelmasa qoldiq va BOMni tekshiring.']},
  {id:'quality-check',title:'Sifat tekshiruvini hal qilish',topic:'/quality:checks',purpose:'Kirish, jarayon yoki final tekshiruv natijasini qayd etish.',requirements:[command('resolveQuality')],prerequisites:['Ochiq tekshiruv yozuvi bo‘lsin.'],steps:['Sifat → Tekshiruvlar bo‘limida qatorni bosing; “Tekshiruv natijasini kiritish” oynasi ochiladi.','Natijani tanlang, “O‘lchov / kuzatuv” va “Sabab / izoh” ni to‘ldiring.','“Natijani saqlash” ni bosing.'],fields:['Natija: qabul, ushlab turish, rad, rework yoki scrap.','O‘lchov / kuzatuv va Sabab / izoh: qaror dalili.','Scrap miqdori: MO tekshiruvida scrap tanlanganda.'],result:'Tekshiruv holati yangilanadi; qabul, karantin yoki rework jarayoni qarorga bog‘liq.',next:'Muammo tizimli bo‘lsa NCR va CAPAni kuzating.',errors:['Ochiq tekshiruv topilmasa manba PO yoki MOni tekshiring.','Oyna faqat ko‘rish rejimida ochilsa sizda quality.edit ruxsati yo‘q.']},
  {id:'capa',title:'CAPA choralarini yuritish',topic:'/quality:capa',purpose:'Nuqson sababini tuzatish va qayta takrorlanishini kamaytirish.',requirements:[command('addCapaAction')],prerequisites:['NCR yozuvi mavjud bo‘lsin.'],steps:['Sifat → CAPA bo‘limida NCR kartasini bosing (NCR oynasi ochiladi).','“Amal qo‘shish” ni bosing: tur, tavsif, mas’ul va muddatni kiriting, “Qo‘shish” ni bosing.','Ish tugaganda “Bajarildi” ni belgilang; boshqa vakolatli xodim “Tekshirish” orqali natijani tasdiqlaydi.'],fields:['Chora va muddat: bajarilishi kerak bo‘lgan ish.','Dalil: natijani tekshirish uchun.'],result:'CAPA tarixi yangilanadi; yakuniy verifikatsiya alohida amal.',next:'Tasdiqlash huquqiga ega sifat xodimi chorani tekshiradi.',errors:['O‘zingizning chorani verifikatsiya qila olmasangiz boshqa vakolatli tekshiruvchi kerak.']},
  {id:'maintenance',title:'Biriktirilgan maintenance ishida qism chiqarish',topic:'/equipment:maintenance',purpose:'Ta’mir uchun sarflangan ehtiyot qismni hisobga olish.',requirements:[command('issueMaintenancePart')],prerequisites:['Ochiq maintenance order, omborda available qoldiq va tegishli birikma bo‘lsin.'],steps:['Uskunalar → Maintenance bo‘limida sizga biriktirilgan ishni oching.','“Ehtiyot qismlar” kartasida “Qism berish” ni bosing.','“Qism va ombor” ni tanlang, “Miqdor” ni kiriting va “Berish” ni bosing; ishlatilmagan qismni “Qaytarish” bilan qaytaring.'],fields:['Qism va ombor: faqat bo‘sh, yaroqli qoldiq ko‘rsatiladi (rezerv va karantin emas).','Miqdor: haqiqiy sarf; bo‘sh qoldiqdan oshmaydi.','LOT: LOTli qism FEFO tartibida avtomatik tanlanadi.'],result:'Stock kamayadi, ish xarajati va tarixi yangilanadi.',next:'Qolgan qismni qaytaring yoki ishni yakunlang.',errors:['Muhandis faqat o‘ziga biriktirilgan ishga qism chiqaradi.','Boshqa filial/ombor yoki available qoldiq yetishmasa amal rad etiladi.']},
  {id:'warehouse-maintenance',title:'Ombordan maintenance uchun qism chiqarish',topic:'/warehouse:maintenance',purpose:'Ruxsatli ombordan ta’mir ishiga ehtiyot qism berish.',requirements:[command('issueMaintenancePart')],prerequisites:['Ochiq maintenance order va o‘z omboringizda available qoldiq bo‘lsin.'],steps:['Ombor → Ehtiyot qism chiqimi bo‘limini oching.','Jadvaldan maintenance ishini bosing; ochilgan oynada “Qism berish” ni bosing.','“Qism va ombor” hamda “Miqdor” ni kiriting va “Berish” ni bosing; rol va ombor doirasi yana tekshiriladi.'],fields:['Maintenance ishi: rejadagi yoki jarayondagi order.','Qism va ombor, Miqdor: haqiqiy chiqim; LOT avtomatik tanlanadi.'],result:'Qoldiq kamayadi, maintenance xarajati va tarixiga yoziladi.',next:'Ish egasi bilan qism qabul qilinganini muvofiqlashtiring.',errors:['Boshqa ombor yoki filialdagi qismni chiqara olmaysiz.','LOT yoki available qoldiq yetishmasa chiqim rad etiladi.']},
  {id:'transfer',title:'Omborlararo transfer',topic:'/warehouse:transfers',purpose:'Materialni bir ombordan boshqasiga kuzatiladigan tarzda ko‘chirish.',requirements:[command('dispatchTransfer')],prerequisites:['Ikkala omborga ruxsat va manbada available qoldiq bo‘lsin.'],steps:['Ombor → Transferlar bo‘limida “Yangi transfer” ni bosing.','Item va manba ombor, qabul ombori, miqdor va “Transfer sababi” ni kiriting.','“Yo‘lga chiqarish” ni bosing; qabul omborida “Qabul qilish” bilan kelgan miqdorni qayd eting.'],fields:['Manba va qabul ombori: har xil bo‘lishi shart.','Miqdor: available stockdan oshmasin.','Transfer sababi: kamida 5 belgi; tarixda saqlanadi.'],result:'Manbadan chiqim yoziladi; qabul qilinganda manzil stocki oshadi. Actor, vaqt, LOT va sabab tarixda ko‘rinadi.',next:'Transferlar ro‘yxatida qabul yoki sababli qaytarishni kuzating.',errors:['LOT muddati o‘tgan, karantinda yoki qoldiq bilan mos emas bo‘lsa transfer rad etiladi.','Filial yoki ombor doirasi ruxsat bermasa vakolatli xodimga murojaat qiling.']},
  {id:'sales-order',title:'Sotuv buyurtmasini yaratish',topic:'/sales:orders',purpose:'Mijozga mahsulot yetkazish talabini rasmiylashtirish.',requirements:[command('createSalesOrder')],prerequisites:['Mijoz va mahsulot kartasi mavjud bo‘lsin.'],steps:['Sotuv → Buyurtmalar bo‘limida “Yangi buyurtma” ni bosing.','Mijoz, Yetkazish sanasi, Mahsulot, Miqdor va Narxni kiriting.','Buyurtmani saqlang va holatini kuzating.'],fields:['Mijoz: xaridor kartasi.','Mahsulot, miqdor, narx: buyurtma summasi.'],result:'SO yaratiladi; stock yetkazib berilganda kamayadi.',next:'Zaxirani rezervlash va yetkazib berishni kuzating.',errors:['Mahsulot yoki mijoz yo‘q bo‘lsa avval kartasini yarating.']},
  {id:'delivery',title:'Sotuvni yetkazib berish',topic:'/sales:delivery',purpose:'Mijozga jo‘natilgan haqiqiy miqdorni qayd etish.',requirements:[command('deliverSalesOrder')],prerequisites:['Ochiq SO va yetarli available stock bo‘lsin.'],steps:['Sotuv → Yetkazib berish bo‘limida buyurtmani oching.','“Yetkazib berish” ni bosing; jo‘natiladigan miqdorni (qisman yoki to‘liq) kiriting.','“Yetkazishni tasdiqlash” ni bosing.'],fields:['Miqdor: real jo‘natma.','LOT / serial: kuzatuv uchun.'],result:'Ombor stocki kamayadi, buyurtma va debitorlik tarixi yangilanadi.',next:'Sotuv → Debitorlik bo‘limida to‘lovni kuzating.',errors:['Qoldiq yoki LOT yetishmasa avval ombor holatini tekshiring.']},
  {id:'reports',title:'Hisobotni filtrlash va eksport qilish',topic:'/reports:overview',purpose:'Kerakli davr va ko‘rsatkichni ajratib ko‘rish.',requirements:[rule('reports','export')],prerequisites:['Hisobotlar moduliga kirish va eksport huquqi bo‘lsin.'],steps:['Hisobotlar bo‘limida kerakli ichki sahifani tanlang.','Davrni tanlang (Bugun, 7 kun, 30 kun yoki 90 kun); KPI va jadvalni solishtiring.','“Excel (.xlsx)”, “CSV” yoki “Print / PDF saqlash” bilan natijani oling.'],fields:['Davr: hisoblanadigan kunlar.'],result:'Fayl joriy ko‘rinishdagi hisoblangan ma’lumotni beradi; stock yoki buyurtma o‘zgarmaydi.',next:'Manba yozuv kerak bo‘lsa jadvaldagi havola orqali vakolatingizdagi sahifaga o‘ting.',errors:['Natija bo‘sh bo‘lsa davr va filtrni kengaytiring.']},
  {id:'admin-user',title:'Foydalanuvchi yaratish',topic:'/admin:users',purpose:'Xodimga o‘z roli va ish joyi bilan kirish berish.',requirements:[rule('users','create')],prerequisites:['Rol, filial va zarur bo‘lsa ish markazi tayyor bo‘lsin.'],steps:['Admin Panel → Foydalanuvchilar bo‘limida “Foydalanuvchi qo‘shish” ni bosing.','Xodim, rol, filial, operator uchun ish markazi va vaqtinchalik parolni kiriting.','“Yaratish” ni bosing; login ma’lumotini xavfsiz yo‘l bilan xodimga yetkazing.'],fields:['Rol va filial: qaysi amallar va joylar ochilishini belgilaydi.','Ish markazi: Operator uchun majburiy.','Vaqtinchalik parol: birinchi kirishda almashtiriladi.'],result:'Xodim akkaunti ochiladi; faoliyat ruxsatlari tanlangan rolga bog‘liq.',next:'Xodimga birinchi kirish va o‘z yo‘riqnomasini ko‘rsatishni tavsiya qiling.',errors:['Ish markazi yo‘q bo‘lsa avval Uskunalar → Work Centers bo‘limida yarating.','O‘zingizdan yuqori rolni tayinlay olmaysiz.']},
  {id:'stock-count',title:'Inventarizatsiya o‘tkazish',topic:'/warehouse:inventory',purpose:'Ombordagi fizik sanoqni tizim qoldig‘i bilan solishtirib, farqni sababi bilan hisobga olish.',requirements:[command('createStockCount'),command('approveStockCount')],prerequisites:['Ombor tahrirlash huquqi va sanaladigan ombor tanlangan bo‘lsin.'],steps:['Ombor → Inventarizatsiya bo‘limida “Yangi inventarizatsiya” ni bosing, omborni tanlab sessiyani oching.','Har bir qatorning “Sanalgan” ustuniga fizik miqdorni kiriting va “Sanoqni saqlash” ni bosing.','Farqlarni tekshirib “Tasdiqlash” ni bosing va kamida 5 belgili sabab yozing.'],fields:['Sanalgan: fizik sanalgan miqdor, 0 yoki musbat son.','Sabab: tasdiqlash yoki bekor qilish izohi; tarixda saqlanadi.'],result:'Tasdiqlashda farq bo‘yicha adjustment harakati yoziladi; bekor qilinsa qoldiq o‘zgarmaydi.',next:'Ombor → Harakatlar bo‘limida adjustment yozuvlarini tekshiring.',errors:['Sanoqdan keyin qoldiq o‘zgargan qator sariq belgilanadi — uni qayta sanang.','Manfiy yoki son bo‘lmagan qiymat saqlanmaydi.']},
  {id:'maintenance-request',title:'Maintenance so‘rovini yuborish',topic:'/equipment:equipment',purpose:'Uskunadagi nosozlik yoki xizmat zaruratini mas’ullarga yetkazish.',requirements:[anyOf(['equipment','create'],['production','edit'])],prerequisites:['Uskuna kartasi mavjud bo‘lsin.'],steps:['Uskunalar → Uskunalar bo‘limida uskunani bosib oching.','“Maintenance so‘rovi” ni bosing.','Tur, Priority, Rejalashtirilgan sana va “Muammo / sabab” ni kiriting, “Yuborish” ni bosing.'],fields:['Tur va Priority: ishning shoshilinchligi; Emergency avtomatik Kritik bo‘ladi.','Muammo / sabab: nosozlik tavsifi.'],result:'So‘rov Uskunalar → So‘rovlar ro‘yxatiga tushadi; tasdiqlanganda maintenance ishi rejalashtiriladi.',next:'Tasdiqlash huquqiga ega xodim So‘rovlar bo‘limida “Tasdiqlash” yoki “Rad etish” ni tanlaydi.',errors:['Majburiy maydon bo‘sh bo‘lsa shakldagi xabarni tuzating.']},
  {id:'maintenance-run',title:'Maintenance ishini boshlash va yakunlash',topic:'/equipment:maintenance',purpose:'Rejalashtirilgan xizmatning haqiqiy boshlanishi va natijasini qayd etish.',requirements:[command('startMaintenance'),command('completeMaintenance')],prerequisites:['“Rejada” holatidagi maintenance ishi bo‘lsin.'],steps:['Uskunalar → Maintenance bo‘limida ishni oching.','“Boshlash” ni bosing va tasdiqlang: uskuna to‘xtaydi, shu work centerdagi operatsiyalar pauzaga o‘tadi.','Ish tugagach “Ish / xizmat xarajati” va “Bajarilgan ish” ni kiriting, “Yakunlash” ni bosing.'],fields:['Ish / xizmat xarajati: ehtiyot qismlarsiz; berilgan qismlar avtomatik qo‘shiladi.','Bajarilgan ish: masalan, almashtirilgan detal.'],result:'Ish yakunlanadi; xarajatga ish summasi va berilgan qismlar qiymati bir marta qo‘shiladi.',next:'Uskuna holati va keyingi servis sanasini Uskunalar bo‘limida tekshiring.',errors:['Tugma ko‘rinmasa ish holati yoki equipment.edit ruxsatini tekshiring.','Xarajat bo‘sh yoki manfiy bo‘lsa “Yakunlash” faol bo‘lmaydi.']},
  {id:'supplier-invoice',title:'Supplier invoice kiritish',topic:'/purchases:orders',purpose:'Yetkazib beruvchi hisob-fakturasini PO va qabul bilan solishtirib qayd etish.',requirements:[command('registerSupplierInvoice')],prerequisites:['Qabul qilingan PO bo‘lsin.'],steps:['Xaridlar → Buyurtmalar bo‘limida POni oching.','“Supplier invoice’lari” kartasida “Invoice kiritish” ni bosing.','Invoice raqami, Invoice sanasi, To‘lov muddati va qatorlarni kiritib “Kiritish” ni bosing.'],fields:['Invoice raqami va sanasi: hujjat rekvizitlari.','To‘lov muddati: supplier qarzi muddati.'],result:'Invoice PO ↔ qabul (GRN) bilan solishtiriladi; zaxira o‘zgarmaydi.',next:'Xarid tasdiqlash huquqiga ega xodim invoice’ni tasdiqlaydi yoki rad etadi.',errors:['Qabul qilinmagan miqdor uchun invoice qatori farq sifatida ko‘rsatiladi.']},
  {id:'customer-payment',title:'Mijoz to‘lovini qabul qilish',topic:'/sales:customers',purpose:'Mijozdan kelgan pulni debitorlik qarziga yozish.',requirements:[command('recordCustomerPayment')],prerequisites:['Mijozda hisob-faktura qilingan ochiq qarz bo‘lsin.'],steps:['Sotuv → Mijozlar bo‘limida mijozni oching (yoki buyurtma oynasidan).','“To‘lov qabul qilish” ni bosing.','Summa, Usul va Izohni kiritib “To‘lovni qayd etish” ni bosing.'],fields:['Summa: ochiq qarzdan oshmasin; eng eski hisob-fakturalarga taqsimlanadi.','Usul va Izoh: to‘lov hujjati ma’lumoti.'],result:'Mijoz qarzi kamayadi va to‘lov tarixda ko‘rinadi.',next:'Sotuv → Debitorlik bo‘limida qoldiq qarzni tekshiring.',errors:['Ochiq qarz yo‘q bo‘lsa tugma faol bo‘lmaydi.']},
]

export function requirementRules(r:Requirement):Rules{
  if(r.command)return actionRules(r.command,r.args||[])||[]
  if(r.entity&&r.action)return entityRules(r.entity,r.action)
  if(r.anyOf)return r.anyOf
  return r.rule?[r.rule]:[]
}
export function canUseGuide(guide:HelpGuide,can:Can){
  const topic=HELP_TOPICS.find(t=>t.id===guide.topic)
  return Boolean(topic&&canOpenTopic(topic,can))&&guide.requirements.every(r=>requirementRules(r).some(([m,a])=>can(m,a)))
}
export const visibleGuides=(can:Can)=>HELP_GUIDES.filter(g=>canUseGuide(g,can))

export type HelpFaq={id:string;question:string;answer:string;module?:string}
export const HELP_FAQ:HelpFaq[]=[
  {id:'button',question:'Nega amal tugmasi ko‘rinmayapti?',answer:'Rolingizda shu amal uchun huquq bo‘lmasligi, ish joyi doirasidan tashqarida bo‘lishi yoki yozuvning holati amalni ruxsat etmasligi mumkin. O‘z rolingiz bo‘limini tekshiring.'},
  {id:'stock',question:'Nega qoldiq bor, lekin chiqim rad etildi?',answer:'Available qoldiq rezerv va karantinni ayirgandan keyin hisoblanadi. LOTli itemda partiya kodi, muddati va joyi ham mos bo‘lishi kerak.',module:'warehouse'},
  {id:'transfer',question:'Nega transfer qabul qilinmadi?',answer:'Manba va qabul ombori har xil bo‘lsin, ikkala omborga ruxsat, yetarli available qoldiq va kamida 5 belgili sabab bo‘lsin.',module:'warehouse'},
  {id:'purchase',question:'PO qabul qilindi, nega invoice avtomatik yo‘q?',answer:'Tovar qabul qilish va supplier invoice alohida amallar. Invoice PO va qabul yozuviga solishtirib kiritiladi.',module:'purchases'},
  {id:'production',question:'MO ishga tushmayapti. Nimani tekshiraman?',answer:'MO holati, faol BOM, material mavjudligi va ish markazi birikmasini tekshiring.',module:'production'},
  {id:'quality',question:'Karantindagi mahsulotdan foydalansam bo‘ladimi?',answer:'Yo‘q. Tekshiruv qarori chiqarilmaguncha karantin qoldig‘i available stockga kirmaydi.',module:'quality'},
  {id:'maintenance',question:'Muhandis nega ehtiyot qism chiqara olmayapti?',answer:'Maintenance ishi aynan shu muhandisga biriktirilgan, ombor esa ruxsatli va qoldiq yetarli bo‘lishi kerak.',module:'equipment'},
  {id:'storage',question:'Ma’lumotlar qayerda saqlanadi?',answer:'Hozirgi demo ma’lumotlari shu brauzer xotirasida saqlanadi. Boshqa qurilma bilan sinxronlash va server xavfsizligi mavjud emas.'},
]
export const visibleFaq=(can:Can)=>HELP_FAQ.filter(f=>!f.module||can(f.module))
export type HelpHit={id:string;kind:'topic'|'guide'|'faq';title:string;summary:string;path?:string;searchText?:string}
const normalize=(s:string)=>s.toLocaleLowerCase('uz-UZ').normalize('NFKC').trim()
export function searchHelp(query:string,can:Can):HelpHit[]{
  const words=normalize(query).split(/\s+/).filter(Boolean)
  if(!words.length)return []
  const hits:HelpHit[]=[
    ...visibleTopics(can).map(t=>({id:t.id,kind:'topic' as const,title:t.title,summary:t.summary,path:t.path,searchText:t.detail})),
    ...visibleGuides(can).map(g=>({id:g.id,kind:'guide' as const,title:g.title,summary:g.purpose,searchText:[...g.steps,...g.fields,...g.errors,...g.prerequisites,g.result,g.next,...(g.terms||[])].join(' ')})),
    ...visibleFaq(can).map(f=>({id:f.id,kind:'faq' as const,title:f.question,summary:f.answer})),
  ]
  return hits.filter(h=>words.every(w=>normalize(`${h.title} ${h.summary} ${h.searchText||''}`).includes(w)))
    .sort((a,b)=>Number(normalize(b.title).includes(words[0]))-Number(normalize(a.title).includes(words[0])))
}

const daily:Record<string,string[]>={
  business_owner:['admin-user','reports','production-order','transfer'],
  admin:['admin-user','reports','production-order','purchase-order'],
  production_manager:['production-order','bom','shop-floor','transfer'],
  operator:['shop-floor'],
  quality:['quality-check','capa'],
  maintenance:['maintenance-run','maintenance','maintenance-request'],
  warehouse:['goods-receipt','transfer','stock-count','warehouse-maintenance'],
  supply_sales:['purchase-request','purchase-order','sales-order','customer-payment'],
}
export function dailyGuides(role:Role,can:Can){
  const available=visibleGuides(can)
  const preferred=daily[role.key||'']||[]
  return [...preferred.map(id=>available.find(g=>g.id===id)).filter((g):g is HelpGuide=>Boolean(g)),...available.filter(g=>!preferred.includes(g.id))].slice(0,4)
}
export const roleActions=(role:Role,can:Can,action:PermissionAction)=>PERMISSION_MODULES.filter(m=>can(m.key,action)&&hasPermission(role,m.key,action)).map(m=>m.label)
export const unavailableModules=(can:Can)=>moduleNav.filter(n=>!(n.anyOf||[n.module]).some(m=>can(m))).map(n=>n.label)

/** Next-step partners are taken from current tenant roles' actual permission matrices. */
export function workflowPartners(role:Role,roles:Role[],can:Can):string[]{
  const handoffs:Rule[]=[]
  if(can('production'))handoffs.push(['quality','edit'],['warehouse','edit'])
  if(can('purchases'))handoffs.push(['warehouse','edit'],['quality','edit'])
  if(can('sales'))handoffs.push(['warehouse','edit'])
  if(can('quality'))handoffs.push(['production','edit'],['purchases','edit'])
  if(can('equipment'))handoffs.push(['warehouse','edit'])
  if(can('warehouse'))handoffs.push(['purchases','edit'],['production','edit'])
  return roles.filter(r=>r.id!==role.id&&r.key!=='super_admin'&&handoffs.some(([m,a])=>hasPermission(r,m,a))).map(r=>r.name).slice(0,5)
}

export const onboardingKey=(tenantId:string,accountId:string,employeeId:string)=>`zenix-help-onboarding-v1:${tenantId}:${accountId}:${employeeId}`
