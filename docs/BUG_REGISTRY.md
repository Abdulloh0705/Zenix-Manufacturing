# ZENIX — yagona BUG reyestri

## Phase 3.4 holati (2026-11-07) — PARTIAL

Ikkala ochiq Phase 3.3 masalasi tuzatildi. Frontend demo Phase 4 ishlari uchun tayyor; ishlab chiqarish SaaS chiqarilishi uchun tayyor deb baholanmaydi. Batafsil dalil va qamrov: [`audits/PHASE34_FINAL_READINESS.md`](audits/PHASE34_FINAL_READINESS.md).

| ID | Holat | Sabab, yechim va dalil |
|---|---|---|
| P32-010 | FIXED | Boshqa tab sessiyasi almashganda root provider tenantni darhol remount qilgan va dirty forma yo‘qolgan. Umumiy `useForm` va mustaqil BOM, PO, receiving, sourcing, sales delivery, material safety, forecast va maintenance editorlari dirty signal beradi. O‘zgargan sessiyada eski forma inert holda saqlanadi, ogohlantirish va aniq discard/reload ko‘rsatiladi; domain, sozlama, auth va SaaS yozuvlari saqlangan sessiya va tenant a’zoligini qayta tekshiradi. `tests/ui/tenant.test.tsx`, `e2e/smoke.spec.ts` (desktop va mobile, 820 px tablet tekshiruvi). |
| P32-011 | FIXED | Final QC LOTni chiqarar, ammo COGS faqat MO close `costSnapshot`idan olinardi. Endi Final QC release paytida fizik LOTning qayd etilgan material, mehnat, uskuna, energiya va overhead tannarxi muzlatiladi; MO hali ochiq bo‘lsa `provisional`, tarixiy input yetishmasa `estimated` deb belgilanadi. Yetkazish harakatiga aynan shu qiymat yoziladi; MO close uni qayta post/revalue qilmaydi, qaytarish asl jo‘natish qiymatini qaytaradi. Eski provenance noma’lum bo‘lsa COGS mavjud emas. `tests/phase34.test.mjs`, `tests/phase31.test.mjs`. |

**Phase 3.2/3.3 kuzatilgan P32 qoldig‘i:** P0 0, P1 0, P2 0, P3 0. **Phase 3.4 umumiy statusi PARTIAL:** avvalgi N-07 subcontract xizmat xarajati mahsulot tannarxiga kiritilmaydi va bu moliyaviy oqim ishlab chiqarish da’vosi uchun muhim. Bu Phase 3.4 doirasidan tashqarida, alohida cost-design qarori talab qiladi. AI javoblarining mazmuni va barcha UI yo‘llari ham to‘liq qo‘lda tasdiqlanmagan. Browser/localStorage RBAC va tenant ajratish server xavfsizlik chegarasi emas.

**Yakuniy tekshiruv:** domain 417/417, UI 77/77, o‘rnatilgan Chrome Playwright 27/27 (setup 1, desktop 13, mobile 13), maintenance/KPI/export maqsadli 14/14; TypeScript, ESLint, production build va `git diff --check` o‘tdi. E2E alohida test brauzer xotirasida bajarildi; mavjud ERP/localStorage tozalanmadi. Commit/push/deploy qilinmadi.

## Phase 3.3 holati (2026-11-07) — PARTIAL

Quyidagi jadval Phase 3.3 **tarixiy snapshoti**: undagi P32-010/011 `OPEN` yozuvlari yuqoridagi Phase 3.4 `FIXED` holati bilan almashtirilgan. Manba shu lokal ishchi daraxti va undagi avvalgi saqlanmagan ishlar. Faqat frontend demo nazorati; server tomonidagi xavfsizlik deb talqin qilinmaydi. `tests/phase33.test.mjs` va `tests/ui/phase33.test.tsx` yangi regression dalillaridir.

| ID | Holat | Tekshirilgan yechim / chegara |
|---|---|---|
| P32-001 | FIXED | Oddiy backup import rollar, ruxsatlar, xodim roli/holati/joyini o‘zgartirsa **oldindan** rad etiladi; rad etilgan import hatto oldingi nusxa kalitini ham yozmaydi. Egasi uchun alohida to‘liq tiklash yo‘li maxsus rollar va xodim tayinlovlarini tiklaydi, tizim rollari, joriy egasi va akkaunt havolalarini tekshiradi. Akkaunt parollari va tenant a’zoligi backupga kirmaydi. Legacy `role0` faqat ko‘rish huquqiga ega. |
| P32-002 | FIXED | Xodim yaratish, ko‘chirish, arxivlash, nusxalash, o‘chirish hamda akkaunt bloklash/parol tiklash manba va manzil scope’i bo‘yicha domain qatlamida tekshiriladi. |
| P32-003 | FIXED | Yangi rol aktor scope’ini oladi; kengroq scope/rank rad etiladi. Cheklangan menejer tizim yoki ishlatilayotgan umumiy rolni tahrirlay olmaydi. Rol berishda rank, scope va aktorning ruxsatlari tekshiriladi. |
| P32-004 | FIXED | Muddati tugagan/to‘xtatilgan obuna o‘zini qayta faollashtirmaydi; trial muddati saqlanadi va muddat bo‘lmasa faol emas. Pulli faol rejadan yuqoriga o‘tish platforma to‘lov tasdig‘isiz rad etiladi; pastga tushirish mumkin. |
| Business Owner xodim oqimi | DEMO VERIFIED | Public Register faqat yangi kompaniya egasini yaratadi. Kompaniya ichida egasi xodim, rol, ish markazi/ombor va vaqtinchalik credential yaratadi; birinchi kirishda parol almashtirish majburiy. Vakolatli menejer o‘z filialida faqat quyi rol bilan akkaunt ochadi. E-pochta/SMS jo‘natilmaydi. UI va domain regression testlari bor. |
| P32-005 | FIXED | Login urinishida akkaunt tenantlari siyosatining qat’iy chegarasi qo‘llanadi, muvaffaqiyatsiz kirish/lockout hodisasi tenantga bog‘lanadi. |
| P32-006 | FIXED | Noma’lum, bo‘sh va orqaga qaytuvchi ishlab chiqarish statuslari domain’da rad etiladi; rezerv saqlangan holda noto‘g‘ri status yozilmaydi. |
| P32-007 | FIXED | Qisman yetkazilgan SO bekor qilinmaydi; mijoz savdo hajmi buyurtma umumiy summasidan emas, yetkazilgan qiymatdan olinadi. Eski bekor qilingan buyurtmaning yetkazilgan qismi ham hisobda qoladi. |
| P32-008 | FIXED | QC, time log, MO, work order va maintenance tarixida xodim havolasi bo‘lsa hard-delete rad; akkauntga bog‘langan xodim ham o‘chirilmaydi. Arxivlash mavjud. |
| P32-009 | FIXED | Maxsus rolning aniq rank’i saqlanadi, yaratgan aktor rank’idan past bo‘lishi shart; HR delegatsiyasi shu daraja bilan ishlaydi. |
| P32-010 | OPEN (P3) | Boshqa tab tenantni almashtirganda ayrim saqlanmagan formalar ogohlantirishsiz yopilishi mumkin. Tablararo form dirty signali kerak. |
| P32-011 | OPEN (P3) | Final QC chiqargan, ammo MO yopilmagan birlik tannarxi hali “mavjud emas” bo‘lishi mumkin; ishonchli vaqtinchalik snapshot kerak. |
| P32-012 | FIXED (P3) | Xarid/sotuv/sex sarlavhalari o‘zbekcha. |
| P32-013 | FIXED (P3) | Domain actions alohida chunk; production build’da 500 kB ogohlantirishi yo‘q. |

**Qolganlar:** P0 0, P1 0, P2 0, P3 2 (P32-010/011). Phase 3.3 barcha P3 masalalari yopilmagani uchun PARTIAL. Brauzer xotirasi, haqiqiy taklifnoma yetkazish, to‘lov va server tranzaksiyasi keyingi backend bosqichiga tegishli. Mavjud biznes yozuvlari yoki localStorage tozalanmadi; commit/push/deploy qilinmadi.

**Tekshiruv:** domain 415/415, UI 76/76, Chrome Playwright 21/21; TypeScript, ESLint, production build va `git diff --check` o‘tdi. E2E alohida test browser xotirasida bajarildi.

## Phase 3.1 yakuniy tuzatishlar (2026-11-07)

Ishchi manba: `C:\Users\user\Documents\ChatGPT\zenix` (`main`, `dbbe317` ustidagi saqlangan Phase 1 SaaS ishchi o‘zgarishlari). Eski ZIP yoki branch bilan almashtirilmadi.

| ID | Daraja | Holat | Dalil / qolgan cheklov |
|---|---|---|---|
| P3-P0-01/02/04/05/06 | P0 | FIXED (yangi oqimlar) | Rework good/scrap, Final Scrap, qaytgan mahsulot, serial, band qilingan LOT va izchillik: `tests/workflows.test.mjs`. Rework LOT qismiga yangi kod va manba LOT havolasi beriladi. |
| P3-P0-03 | P0 | FIXED | Barcha birliklari scrap bo‘lgan MO imkonsiz Final QC kutmasdan yopiladi. |
| P3-P0-07 | P0 | FIXED | Eski rework egaligi faqat bitta isbotlangan LOTda avtomatik tiklanadi. Bir nechta mos LOT bo‘lsa vakolatli operator manba MO, ombor, variant, miqdor va QC tarixini ko‘rib tanlaydi; noto‘g‘ri/aniqlanmagan egalik Final QC chiqarishini bloklaydi. LOT ajratilishi va audit metama’lumoti saqlanadi, stock avtomatik bo‘shatilmaydi: `tests/phase31.test.mjs`. |
| P3-P1-01/02 | P1 | FIXED | Muddati o‘tgan LOT available emas; variant BOM subassembly talabi mahsulot tartibidan qat’i nazar hisoblanadi: `tests/phase2.test.mjs`. |
| P3-P1-03 | P1 | FIXED | Profitability qisman jo‘natish va qaytarishni net hisoblaydi; ishonchli LOT provenance bo‘lsa uning tannarxini oladi: `tests/profitability.test.mjs`, `tests/phase31.test.mjs`. |
| P3-P1-04 | P1 | FIXED | Incoming QC Hold to‘liq partiyasi qayta tekshiriladi; qisman supplierga qaytarilgan partiyani butunlay Passed qilish rad etiladi. |
| P3-P1-05 | P1 | FIXED | Qo‘lda berilgan materialning isbotlangan ishlatilmagan qismi asl LOT/ombor/joyiga qaytadi; harakat, sabab, actor va tannarx yoziladi. Backflush, keyingi ish/natija va noaniq eski issue qaytarilmaydi: `tests/phase31.test.mjs`. |
| P3-P1-06 | P1 | FIXED | Receipt, supplier return, replacement, qisman to‘lov va tuzatishlar payable ledgerga yoziladi; PO/supplier qoldiq va status ledgerdan hisoblanadi. Eski qarz faqat boshlang‘ich qoldiq, avvalgi to‘lov tafsiloti noma’lum: `tests/phase31.test.mjs`. |
| P3-MRP | P1 | FIXED | Amaliy xarid/shortage/ogohlantirishlar `runMrp`ning filial bo‘yicha net talabidan olinadi. Eski global jadval faqat ma’lumot sifatida belgilangan, undan xarid ochilmaydi: `tests/phase31.test.mjs`. |
| P3-COGS | P1 | FIXED | Jo‘natilgan LOTning muzlatilgan MO tannarxi, rework qo‘shimchasi va qaytarishning asl qiymati ishlatiladi. Eski provenance yetarli bo‘lmasa natija taxminiy yoki mavjud emas deb ko‘rsatiladi; marja u holda da’vo qilinmaydi: `tests/phase31.test.mjs`. |

Auth, tenant membership, role va obuna browser/localStorage demo nazorati bo‘lib qoladi; haqiqiy xavfsizlik, to‘lov va tranzaksion yaxlitlik uchun `docs/BACKEND_CONTRACT.md`dagi server cheklovlari talab etiladi. Phase 3.1 **COMPLETE**: besh qolgan muammo tuzatildi; Phase 3.2 to‘liq frontend/RBAC audit keyingi bosqich.

Tekshiruv (2026-11-07): domain **406/406**, UI **75/75**, Chrome Playwright **21/21**; TypeScript, ESLint, production build va `git diff --check` o‘tdi. Playwright o‘rnatilgan Chrome bilan ishga tushirildi; paketdagi Chromium executable mavjud emas edi.

Manbalar: 1-audit (BUG-01…18), mahsulot auditi (N-01…26), 3-audit (B3-01…15), Login/RBAC auditi (A-C1…A-L4).
Takrorlar bitta qatorga birlashtirilgan, har bir ID saqlangan. Oxirgi yangilanish: 2026-10-28 (Audit Phase 1/5).

**Holatlar:**
- **FIXED** — kod o‘zgardi va dalil bor: regression test (eski kodda yiqilishi tekshirilgan) yoki brauzerda tekshiruv. Ma’lum chegara bo‘lsa “Cheklov” ustunida.
- **PARTIAL** — asosiy xavf yopildi; qolgan qismi “Cheklov” ustunida.
- **OPEN** — tuzatilmagan; sababi yozilgan.

**Dalil manbalari:**
- [tests/bugRegistry.test.mjs](../tests/bugRegistry.test.mjs) — test nomi ID bilan boshlanadi (BUG-04…, N-…, B3-…).
- [tests/workflows.test.mjs](../tests/workflows.test.mjs) — BUG-01…05 va asosiy oqimlar.
- [tests/release.test.mjs](../tests/release.test.mjs) — release bosqichi: BUG-07, BUG-14, BUG-16, BUG-17, N-07, N-14, N-19, N-20, A-H6, A-M6, auth.
- [tests/access.test.mjs](../tests/access.test.mjs), [tests/auth.test.mjs](../tests/auth.test.mjs) — RBAC va login.
- “Eski kodda yiqiladi” — testlar o‘zgarishdan oldingi manba nusxasiga qarshi ishga tushirilgan (scratchpad, loyiha fayllariga tegilmagan). release.test.mjs: o‘sha nusxada 15 testdan 13 tasi yiqildi; qolgan 2 tasi (BUG-14 yordamchisi) eski xatti-harakatni test ichida modellashtiradi.

## Critical / High

| ID | Muammo | Holat | Yechim | Dalil | Cheklov |
|---|---|---|---|---|---|
| BUG-01 | Scan boshqa MO rezervini yeydi | FIXED | Rezerv har bir MO bo‘yicha (`reservations`), `issueToOrder` | workflows | — |
| BUG-02 | Bekor qilish ortiqcha rezervni bo‘shatadi | FIXED | `releaseFor` faqat MO’ning o‘z rezervini bo‘shatadi | workflows | Berilgan material bekor qilinganda omborga avtomatik qaytmaydi (alohida qaytarish oqimi) |
| BUG-03 | Manfiy qoldiq jim nolga tushiriladi | FIXED | `StockError`, amal bajarilmaydi | workflows | — |
| BUG-04 | Yangi Raw ombor sarfni boshqa omborga yo‘naltiradi | FIXED | `rawWarehouseFor` barqaror: filial standarti, aks holda eng eski Raw | bugRegistry BUG-04 | — |
| BUG-05 | Final QC boshqa MO karantinini bo‘shatadi | FIXED | `qcHeld` har bir MO bo‘yicha | workflows | — |
| BUG-05b | Tekshiruvni qayta hal qilish mumkin | FIXED | `resolveQuality` faqat `Pending`ni qabul qiladi | bugRegistry BUG-05b | — |
| BUG-06 | QC’dan keyin berk ko‘cha, 0 miqdor bilan yopilish | FIXED | QC → Jarayonda qaytish; natijasiz QC/short close rad etiladi | bugRegistry BUG-06 | — |
| BUG-07 | Ledger/faoliyat kesiladi, ADJ/TR raqamlari takrorlanadi | FIXED | Ombor harakatlari va time log kesilmaydi; raqamlar noyob (`nextRef`); faoliyat domain’da kesilmaydi — eng yangi 3000 tasi ish ma’lumotida, eskilari `zenix-activity-archive-v1` arxiviga ko‘chiriladi (yozib bo‘lmasa ma’lumotda qoladi, ogohlantiriladi); audit jurnali ikkalasini ko‘rsatadi | bugRegistry BUG-07, release BUG-07/A-M2 | Hammasi brauzer xotirasi (~5 MB) bilan chegaralangan; bildirishnomalar oxirgi 150 ta (vaqtinchalik xabar, tarix emas). O‘zgarmas audit uchun backend kerak |
| BUG-08 | Tarixiy tannarx o‘zgaradi | FIXED | Yakunlanganda `costSnapshot` muzlatiladi; v4 migratsiyasi eski yakunlangan MO’larni bir marta muzlatadi; hisobotlar snapshot’ni o‘qiydi | bugRegistry BUG-08, access “v4 migration … freezes completed order costs” | Migratsiya paytidagi narx bilan muzlaydi (undan oldingi tarixiy narx saqlanmagan) |
| BUG-14 | Tablar, debounce, buzilgan JSON, import | FIXED | Har bir domain amali saqlangan oxirgi nusxani o‘qib, boshqa tab yozganini davom ettiradi va darhol saqlaydi (`syncedState.ts`); `storage` event sinxronlash; tab yopilganda flush; o‘qilmagan JSON alohida kalitga; import/restore ruxsat, shakl, owner invariant va Phase 3.3 xavfsizlik holati tekshiruvidan keyingina oldingi nusxani yozadi | release BUG-14 (2 test), phase33 P32-001 | localStorage’da qulf yo‘q: ikki tab bir necha millisekund ichida yozsa poyga mumkin. Bu tranzaksiya emas — server kerak |
| B3-01 | Split bola MO Passed QC holatini meros oladi | FIXED | Bola MO `Pending` bilan boshlanadi | bugRegistry B3-01 | — |
| B3-02 = A-H1 | Demo foydalanuvchi almashtirgichdan qaytib bo‘lmaydi | FIXED | `switchUser` olib tashlandi; identifikatsiya faqat login sessiyasidan | access A-61 (`switchUser:allowed→refused`), auth | — |
| B3-03 | Qo‘lda kirish QC’si birinchi receipt’ni hal qiladi | FIXED | Aniq receipt majburiy; eski yozuvlar faqat bitta mos receipt bo‘lsa | bugRegistry B3-03 | — |
| N-01 | Final QC natijadan oldin Passed bo‘ladi | FIXED | Natijasiz Final yaratilmaydi/hal qilinmaydi | bugRegistry N-01 | — |
| N-02 | Final Scrap omborga ta’sir qilmaydi | FIXED | Ushlab turilgan birliklar scrap sifatida chiqadi | bugRegistry N-02 | — |
| N-03 | Supplier return takrorlanadi | FIXED | `returnedQty`; ikkinchi qaytarish rad etiladi, yangi receiptning payable krediti bir marta yoziladi | bugRegistry N-03, phase31 P3-P1-06 | Eski receiptlar uchun ledgerdan oldingi qarz/tarix boshlang‘ich qoldiq sifatida saqlanadi |
| N-04 | Merge ikkinchi SO bog‘lanishini yo‘qotadi | FIXED | Turli SO’li MO’lar birlashtirilmaydi | bugRegistry N-04 | — |
| N-07 | Subcontract karantindagi materialni jo‘natadi, QC’siz qabul | PARTIAL | Jo‘natishda karantin hisobga olinadi; Final QC majburiy bo‘lsa qabul karantinga tushadi va kirish tekshiruvi ochiladi (Passed → bo‘shaydi, Scrap → hisobdan chiqadi) | release N-07 (2 test: jo‘natish va qabul) | Xizmat narxi hali `Overhead` xarajati sifatida yoziladi, mahsulot tannarxiga qo‘shilmaydi; partiya qisman qabul qilinmaydi (butunlay Passed yoki Scrap) |

## Medium

| ID | Muammo | Holat | Yechim | Dalil | Cheklov |
|---|---|---|---|---|---|
| BUG-09 | Qisman qabul qilingan PO yopilmaydi | FIXED | `closePurchaseShort` + “Qoldiqni yopish” | bugRegistry BUG-09 | — |
| BUG-10 | Adjust karantinni hisobga olmaydi | FIXED | Qoldiq `rezerv + karantin`dan kamaymaydi | bugRegistry BUG-10 | — |
| BUG-11 | Uskuna to‘xtaganda maintenance boshlanmaydi | FIXED | Ochiq to‘xtash maintenance/repair’ga biriktiriladi | bugRegistry BUG-11 | — |
| BUG-12 | Birliklar konversiyasi yo‘q | PARTIAL | Ishlatilgan item birligi o‘zgarmaydi; BOM qatori ombor birligida; supplier xarid birligi `unitFactor` bilan | bugRegistry BUG-12 | Umumiy UoM konversiya jadvali (kg↔g va h.k.) yo‘q — alohida feature |
| BUG-13 | Natija idempotent emas | FIXED | `reportOutput(..., key)` | bugRegistry BUG-13 | — |
| BUG-15 | RBAC qo‘pol; generic CRUD validatsiyasiz | FIXED | `ENTITY_RULES` (noyob SKU, birlik/tracking qulfi, ombor kodi, NCR root cause) + `access.ts` | bugRegistry BUG-15, access | — |
| N-05 | Qaytarish QC’si Sifat sahifasidan hal qilinadi | FIXED | Faqat disposition orqali | bugRegistry N-05 | — |
| N-06 | Rework miqdori cheklanmagan | FIXED | ≤ tayyor − rework’dagi | bugRegistry N-06 | — |
| N-08 | `requireFinalQc` o‘chirilsa karantin qotadi | FIXED | Yakunlashda ushlab turilganlar bo‘shatiladi | bugRegistry N-08 | — |
| N-09 | Bekor qilingan MO operatsiyasi yakunlanadi | FIXED | Faqat Jarayonda/Pauzada | bugRegistry N-09 | — |
| N-10 / B3-09 | Ishlatilayotgan WC/ombor/liniya/filial o‘chiriladi | FIXED | `REFERENCE_CHECKS` | bugRegistry N-10 | — |
| N-12 / B3-06 | ECO sanasi e’tiborsiz, o‘zi tasdiqlaydi; draft BOM chetlab faollashadi | FIXED | Muallif tasdiqlay olmaydi; sana kelmaguncha qo‘llanmaydi; ECO’li draft faqat ECO orqali | bugRegistry N-12, B3-06 | — |
| N-13 | Pending in-process QC yakunlashni to‘xtatmaydi | FIXED | Yakunlashdan oldin barcha tekshiruvlar hal qilinadi | bugRegistry N-13 | — |
| N-15 | Mehnat narxi barcha xodimlar o‘rtachasi | FIXED | WC xodimlari → ishlab chiqarish → hammasi | bugRegistry N-15 | — |
| N-16 | SKU dublikati | FIXED | Domain darajasida noyoblik | bugRegistry N-16 | — |
| N-18 | `export` faqat Hisobotlarda; tannarx hammaga | FIXED | A-H4 va A-M1 qatorlariga qarang | access; brauzer (Operator) | — |
| N-21 / B3-11 | Arxiv yoki noto‘g‘ri turdagi omborga transfer | FIXED | Faol va mos turdagi omborga | bugRegistry N-21 | — |
| N-22 | Musbat adjust lot yaratmaydi | FIXED | ADJ lot; tracking/unit qulfi | bugRegistry N-22 | — |
| N-24 | Split bola MO SO ro‘yxatiga qo‘shilmaydi | FIXED | `productionOrderIds`ga qo‘shiladi | bugRegistry N-24 | — |
| N-26 | Repair xarajati yozilmaydi; downtime → “Ishlamoqda” | FIXED | Qism + mehnat xarajati; “Servis yaqin” | bugRegistry N-26 | — |
| B3-04 | SO’da bir mahsulot ikki qatorda | FIXED | Domain rad etadi | bugRegistry B3-04 | — |
| B3-05 | Muddati o‘tgan lot qabul qilinadi va sarflanadi | FIXED | Qabul rad etiladi; issue/backflush olmaydi | bugRegistry B3-05 | — |
| B3-07 | QC’dagi MO bekor qilinsa karantin qoladi | FIXED | Ushlab turilgan natijali MO bekor qilinmaydi | bugRegistry B3-07 | — |
| B3-08 | Bo‘shatilgan lot yangi natija bilan yana karantinga tushadi | FIXED | Yangi natija yangi lot oladi | bugRegistry B3-08 | — |

## Low

| ID | Muammo | Holat | Yechim | Dalil | Cheklov |
|---|---|---|---|---|---|
| BUG-16 | OEE taxminiy (bo‘sh turish, ochiq downtime) | FIXED | Rejadagi vaqt = ish bo‘lgan har kun uchun bitta smena (`shiftMinutes`); qayd etilmagan bo‘sh turish availability’ni pasaytiradi; ochiq to‘xtash hozirgacha hisoblanadi; performance birliklar bo‘yicha tortiladi | release BUG-16 | Smena kalendari yo‘q (bayram, ko‘p smena) — bitta smena uzunligi |
| BUG-17 | UI matni ↔ mantiq | PARTIAL | MPS/MRP yaxlitlash, Available, BOM waste matnlari; QCP `frequency`/`sampleRate` endi avtomatik tekshiruvni boshqaradi (Every time / On demand / Random % / Periodic har N-chi) | release BUG-17 | `timezone` sozlamasi qo‘llanmaydi — sanalar brauzerning lokal vaqtida |
| BUG-18 | CSV injection, operator ID, qaytgan lot, `createdAt` UTC | FIXED | `neutralize()`; vaqt ishni boshlagan kishiga; `stamp()` | bugRegistry BUG-18 | — |
| N-11 | Serial genealogy (qaysi serial ketdi) | OPEN | — | — | Har bir serial alohida yozuv bo‘lishi kerak: ma’lumot modeli o‘zgarishi (lot → serial qatorlari, sotuv/qaytarishda serial tanlash). Hozir serial diapazon lot darajasida |
| N-14 | MRP needBy = bugun + lead time; vaqt bo‘yicha taqsimlanmagan | FIXED | Phase 2: `runMrp` (src/domain/planning.ts) — kunlik/haftalik bucket, projected available, net = max(0, safety − proyeksiya), lead time bo‘yicha release, talabga pegging | release N-14, phase2 P2-08/09 | “Xomashyo balansi (jami)” jadvali (createMrpPlan) jami ko‘rinish sifatida qoldi |
| N-17 | Natija oynasi butun qoldiqni to‘ldiradi; STOP sababi yo‘q | FIXED | Bo‘sh standart qiymat + kalit; STOP sababi | kod: OutputModal `good:''`, Shop Floor `STOP_REASONS` (UI testi yo‘q) | — |
| N-19 / B3-15 | Unbuild joriy BOM va 97% ishlatadi | FIXED | Olinadigan lot uni yaratgan MO’ga bog‘lanadi: MO BOM snapshot’i, haqiqiy sarf bilan cheklangan; lot MO’siz bo‘lsa faol BOM; qayta tiklash % foydalanuvchi kiritadi (0–100) | release N-19/B3-15 | — |
| N-20 | Brak o‘rniga qo‘shimcha issue yo‘q | FIXED | `issueExtraMaterial`: sabab majburiy, faqat bo‘sh qoldiqdan, BOM rejasi bilan cheklangan, MO’da `extraIssues`, ledger va jurnalda; faqat `production.edit` | release N-20 | — |
| N-23 / B3-14 | `due < start` jimgina almashtiriladi | FIXED | Rad etiladi | bugRegistry N-23 | — |
| N-25 | Low-stock takrori SKU matni bo‘yicha; AI 0 ga bo‘lish | FIXED | Material havolasi; `salePrice>0` | bugRegistry N-25 | — |
| B3-10 | CSV’da UTF-8 BOM yo‘q | FIXED | UTF-8 BOM + Excel uchun `<meta charset>` | release B3-10 | — |
| B3-12 | Noma’lum `?view=` jim ochiladi | FIXED | Noma’lum yoki ruxsatsiz bo‘lim → modulning birinchi ruxsat etilgan bo‘limi + xabar (`useViewGuard`) | brauzer: `/production?view=nonsense` | — |
| B3-13 | Return-rework manbasi taxmin bilan | FIXED | Faqat lot mos kelsa | bugRegistry B3-13 | — |

## Login / RBAC auditi (A-xx)

| ID | Muammo | Holat | Yechim | Dalil | Cheklov |
|---|---|---|---|---|---|
| A-C1 | Ruxsatlar matritsasi orqali huquq oshirish | FIXED | O‘z rolini tahrirlab bo‘lmaydi; o‘zida yo‘q huquqni bera olmaydi; yuqori darajadagi rolga tegilmaydi (`rolePermissionBlocker`) | access A-C1 | — |
| A-C2 | O‘z rolini o‘zgartirish, parolsiz boshqa foydalanuvchiga o‘tish | FIXED | `assignRoleBlocker`; `switchUser` yo‘q | access A-C2 | — |
| A-C3 | Autentifikatsiya yo‘q | FIXED | Login/logout, birinchi sozlash, PBKDF2-SHA-256 (210 000, tuz), sessiya, bloklash; identifikatsiya faqat sessiyadan | auth (10 test), release auth; brauzer | Brauzer ichidagi himoya — [AUTH.md](AUTH.md) |
| A-H2 | Oxirgi adminni himoya qilish yo‘q | FIXED | Oxirgi faol Super Admin bloklanmaydi, o‘chirilmaydi, rolidan tushirilmaydi; har bir amaldan keyin invariant | access A-H2, auth | — |
| A-H3 | Backup import/eksport himoyasiz | FIXED | Import/restore `settings.edit`, eksport `settings.export`; importdan oldin zaxira; backup’da Super Admin bo‘lmasa rad | AppContext `replaceAll`; brauzer | Akkauntlar backup’ga kirmaydi (ataylab) |
| A-H4 | `export` deyarli qo‘llanmaydi | FIXED | Har bir jadval CSV’si joriy modulning `export` huquqiga bog‘langan; audit CSV `audit.export` | brauzer (Operator: CSV tugmasi yo‘q) | — |
| A-H5 | Operator huquqlari juda keng | FIXED | `execute` ajratildi: operator ishni bajaradi, rejalashtirmaydi/bekor qilmaydi | access “execute: operators…” | — |
| A-H6 | `scope` qo‘llanmaydi | FIXED | Domain darajasida (`scopeBlocker`): `workcenter` — sex ishi faqat o‘z ish markazida; `branch` — o‘z filiali; `warehouse` — xodimga `warehouseId` biriktirilsa faqat shu ombor (aks holda filial). Qamrov MO split/merge/backorder, QC, qaytarish, xarid, sotuv bekor qilish va joyga bog‘liq master-data CRUD’ga kengaytirildi. O‘qish: `scopedView` ro‘yxat, dashboard va eksportlarni shu doiraga qisqartiradi | release A-H6 (2 test), phase1 P1-2 (3 test) | Frontend himoyasi — backend xavfsizligi emas |
| A-M1 | Pul ma’lumotlari hammaga ko‘rinadi | FIXED | `costs.view`siz: tannarx/marja ustunlari, BOM tannarxi, MO “Tannarx” tabi, WC stavkasi, scrap yo‘qotishi, Hisobotlar → Xarajatlar/Profitability, dashboard tannarx KPI, AI marja javoblari, xodim stavkasi yashiriladi | brauzer (Operator) | Material xarid narxi va ombor qiymati ta’minot/ombor ishi uchun ko‘rinadi |
| A-M2 | Audit jurnali zaif | FIXED | Har yozuvda `userId`; kirish hodisalari alohida jurnal; faoliyat kesilmaydi (arxiv) | release BUG-07/A-M2, auth | Brauzer xotirasini o‘zgartira oladigan odam jurnalni ham o‘zgartiradi |
| A-M3 | Migratsiya xavfi | FIXED | `schemaVersion` v4; qo‘shuvchi, idempotent, oldin zaxira | access v4 testlari | — |
| A-M4 | Bir nechta tab | FIXED | = BUG-14; sessiya va akkauntlar tablar orasida sinxron, logout hamma tabda | release BUG-14, auth | BUG-14 cheklovi |
| A-M5 | Shaxsiy holat umumiy | PARTIAL | Bildirishnoma o‘qilgani foydalanuvchi bo‘yicha | AppContext `markRead` | Theme/valyuta/kontekst brauzer bo‘yicha umumiy (bir qurilma — bir sozlama) |
| A-M6 | Vazifalar ajratilmagan (ECO, PO) | FIXED | ECO muallifi tasdiqlay olmaydi; PO qoralamani chetlab yaratish `purchases.approve` talab qiladi; ixtiyoriy “ikki kishilik tasdiq” siyosati (chegara summasi) — muallif o‘z PO’sini tasdiqlay olmaydi | release A-M6 (2 test), bugRegistry N-12 | Ikki kishilik tasdiq standart o‘chiq (bitta egasi bor korxona uchun); Sozlamalar → Sifat va tasdiq siyosati |
| A-M7 | Matritsa cheklangan, rol CRUD yo‘q | FIXED | `dashboard`, `ai`, `execute`, `users/roles/audit` modullari; rol yaratish/nusxalash/o‘chirish (tizim rollari himoyalangan) | access “roles: …” | — |
| A-L1 | Bildirishnomalar ruxsat bo‘yicha filtrlanmaydi | FIXED | Faqat ochiladigan modullar | Topbar | — |
| A-L2 | HR holati va akkaunt holati aralash | FIXED | Akkaunt holati (`active/blocked`) alohida | auth | — |
| A-L3 | Rol tanlovida Super Admin chiqadi | FIXED | Faqat berish mumkin bo‘lgan rollar | access A-C2 | — |
| A-L4 | Yangi rol id’lari demo naqshiga mos | FIXED | `role-<vaqt>-<tasodif>` | reset.ts `isGeneratedDemoId` | — |

## Phase 1 (2026-10-21) — ma’lumotlar yaxlitligi

Testlar: `tests/phase1.test.mjs` (24 test; 12 tasi eski kodda yiqiladi).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| P1-10 | Ombor fallback’i arxivlangan/noto‘g‘ri turdagi omborga tushardi | FIXED | `finishedWarehouseFor`/`rawWarehouseFor` faqat faol, mos turdagi ombor; MO yaratishda ombor/liniya tekshiriladi |
| P1-11 | BOM’da o‘chirilgan/arxivlangan komponent bilan MO ochilardi | FIXED | `bomBlocker` — yaratish, tasdiqlash va boshlashda |
| P1-26/27 | Qaytarish karantinsiz, qarorgacha omborda ko‘rinmas; Scrap harakat yozmasdi; standart omborga tushardi | FIXED | Ro‘yxatga olishda jo‘natgan omborga karantin bilan qabul; Good/Rework/Scrap aynan shu birliklarni siljitadi, Scrap `QC Scrap -` yozadi |
| P1-29 | Qaytarish/trace birinchi mos lotni olardi; transfer nusxasi lot manbasini yo‘qotardi | FIXED | `returnSources` (haqiqiy Sale − harakatlari bo‘yicha lotlarga bo‘lish), `lotOrigin`, transfer nusxasi manbani saqlaydi |
| P1-30 | Transfer qilingan lot unbuild’da joriy BOM’ga tushardi | FIXED | `lotOrigin` orqali MO snapshot |
| P1-31 | Faol BOM’i/ochiq MO snapshot’i/subcontract/qaytarishi bor yozuvni o‘chirish mumkin edi | FIXED | `REFERENCE_CHECKS` kengaytirildi |
| P1-33/34 | Split/backorder bolasi ota-ning extraIssues/outputKeys’ini meros olardi; turli snapshot’li MO’lar birlashardi; MTO backorder SO’dan uzilardi | FIXED | Toza bola buyurtma, snapshot tengligi, SO’ga bog‘lash, rezervni tiklab bo‘lmasa split bekor |

## Phase 2 (2026-10-21) — MRP, MES, sig‘im, sifat va tannarx

Testlar: `tests/phase2.test.mjs` (23 test, sobit soat 2026-10-21 08:00). Jami suite: 233.

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| P2-01 | Work order’da operator, operatsiya miqdori, setup/run, tarix yo‘q; MO bekor qilinganda job card ochiq qolardi | FIXED | `WorkOrder`: operatorIds, goodQty/scrapQty, setupActualMin, muzlatilgan stavkalar, history; `jobCard`, `WORK_ORDER_PHASE` (BLOCKED→READY→IN_PROGRESS⇄PAUSED→COMPLETED/CANCELLED); bekor/merge’da “Bekor qilingan”, tarix saqlanadi |
| P2-02 | Operatsiya miqdori nazorat qilinmasdi | FIXED | `reportOperationOutput`: kirgan − qayd etilgan dan ortig‘i faqat yozma sabab bilan, MO miqdoridan hech qachon oshmaydi; oraliq scrap MO’ga (material, NCR), oxirgi operatsiya = MO natijasi (backflush, QC karantin); takroriy kalit — no-op |
| P2-03 | Setup va run vaqti ajratilmasdi | FIXED | `markSetupDone`: setup alohida time log, run bo‘shliqsiz davom etadi; pauza vaqti time log oraliqlaridan |
| P2-04 | Operator ish markazi doirasi tekshirilmasdi | FIXED | `operatorScopeBlocker` (access.ts): `assignWorkOrder` va `startWorkOrder(employeeId)` |
| P2-05 | Aylanma BOM sub-BOM orqali o‘tardi; portlatish jim o‘tkazib yuborardi | FIXED | `findBomCycle`/`explodeBom` (planning.ts); saveBom va faollashtirishda rad, MRP issue sifatida ko‘rsatadi |
| P2-06 | MRP vaqt bo‘yicha emas, MTS/MTO farqi yo‘q, tavsiya talab manbasini bilmasdi | FIXED | `runMrp`: MTS forecast’ni iste’mol qiladi, MTO ustiga qo‘shiladi; FIFO pegging (safety stock talabga berilmaydi); `confirmMrpSuggestion` → qoralama MO/PO (“MRP <key>” bilan), qoralama PO bor tavsiya qayta yaratilmaydi |
| P2-07 | Xomashyo faqat bitta ombordan rezerv/chiqim qilinardi | FIXED | `componentSourceWarehouses`: filialning boshqa Raw/Mixed omborlari ham; rezerv hammasi-yoki-hech narsa, chiqim ombor bo‘yicha, boshqa filial ishlatilmaydi; “warehouse” roli faqat o‘z omborida |
| P2-08 | Sig‘im kalendar, smena, texnik xizmat va to‘xtashni bilmasdi; Gantt tekshiruvsiz sana o‘zgartirardi | FIXED | `workCenterDay` (ish kunlari, smenalar, maintenance, downtime), `scheduleOperations` (finite, bog‘liqlik, ustma-ust yo‘q), `rescheduleProductionOrder` (o‘tgan/noto‘g‘ri sana rad, band resurs uchun override sabab bilan) |
| P2-09 | In-process tekshiruv work order’ga bog‘lanmagan, majburiy QC keyingi operatsiyani to‘smasdi, in-process scrap stock/costga ta’sir qilmasdi | FIXED | QualityCheck.workOrderId/operatorId; QCP `blocking`; eng so‘nggi tekshiruv qaror qiladi; `resolveQuality(...,qty)` scrap’ni MO’ga yozadi (bitta NCR) |
| P2-10 | Haqiqiy tannarx chiqimni bugungi narxda baholardi; energiya va WIP yo‘q | FIXED | Chiqim paytidagi narx (`issueUnitCost`), time log va work order’da muzlatilgan stavkalar, energiya (WC tarifi), WIP/relieved, rework alohida ko‘rsatiladi, `costInputGaps` — taxminiy qism belgilanadi |
| P2-11 | OEE operatsiya miqdorini bilmasdi | FIXED | Job card miqdori bo‘lsa shu, bo‘lmasa MO natijasi; formula o‘zgarmadi |
| P2-12 | MPS jadval izohi “50 lik lot” deb yozardi, kod 1 birlik edi | FIXED | Izoh tuzatildi; MPS ufqi 4/8/12 hafta |

**Cheklovlar:** sig‘im kun ichida bo‘shliqlarni to‘ldirmaydi (har work center uchun kunlik ko‘rsatkich); texnik xizmat/to‘xtash kun sig‘imini kamaytiradi, smena ichidagi aniq vaqt oralig‘ini emas; umumiy UoM konversiya jadvali hali yo‘q (BUG-12); karantindagi stock MRP’da kirim sifatida hisoblanmaydi (konservativ).

## Phase 4 (2026-10-26) — UI/UX, dizayn tizimi, responsive, overlay va accessibility

Audit: umumiy komponentlar (Overlays, Forms, ResourceTable, Layout), shell (Sidebar, Topbar, AI dock) va 93 ta ko‘rinish (har bir modul sub-view) haqiqiy brauzerda 1920 / 1440 / 1280 / 1024 / 768 / 480 / 375 px’da: gorizontal overflow, <11px matn, nomsiz boshqaruv, h1, kichik bosish nishoni, konsol xatolari. Yangi UI testlar: `tests/ui/*.test.tsx` (jsdom, `npm run test:ui`, 39 test). Jami: 253 domain + 39 UI.

| ID | Daraja | Muammo | Holat | Tuzatish |
|---|---|---|---|---|
| P4-01 | High | Jadvalda formatlangan pul/miqdor ustuni matn sifatida saralanardi (“1 200 000” < “300”), dd.mm.yyyy sanalar ham | FIXED | `tableSort.ts`: xom raqam / ISO sana, guruhlangan raqam va dd.mm.yyyy ma’nosi bo‘yicha; bo‘sh qiymat doim oxirida; `paginate` |
| P4-02 | High | Interfeys / jadval zichligi sozlamasi yo‘q edi (talab qilingan) | FIXED | `uiDensity`, `tableDensity` (compact/standard/comfortable) → `<html data-density / data-table-density>` tokenlari; Sozlamalar va mobil “Ko‘rinish” menyusida |
| P4-03 | Medium | Fon oilasi faqat sahifa fonini o‘zgartirardi, sirtlar bir xil — oilalar deyarli farqlanmasdi | FIXED | Accent asosidagi sirt ierarxiyasi (`tokens.css`), dark — navy/charcoal asos; “Graphite” → “Neutral”, tartib talab bo‘yicha |
| P4-04 | Medium | Eski / noto‘g‘ri saqlangan ko‘rinish qiymatlari (oila nomi, item id) qo‘llab-quvvatlanmaydigan holatda qolardi | FIXED | `normalizePrefs` / `normalizeFamily` yuklashda va legacy migratsiyada |
| P4-05 | Medium | Telefon’da baland menyu (Ko‘rinish) trigger va topbar ustiga surilardi | FIXED | `Popover`: pastga ochilgan panel joyida qoladi va scroll qiladi; `top-*` joy bo‘lmasa pastga aylanadi |
| P4-06 | Medium | Bildirishnoma sozlamasi faqat yangi xabarni to‘xtatardi; o‘chirilgan turdagi eski xabarlar qo‘ng‘iroqchada qolardi | FIXED | `visibleNotifications` (modul ruxsati + tur sozlamasi) |
| P4-07 | Medium | “Muddat kechikishi” va “AI tavsiyalari” bildirishnoma kalitlari ishlaydigandek ko‘rinardi, lekin bunday xabar manbai yo‘q | FIXED (rost holat) | Kalitlar o‘chirilgan, sababi va signallar qayerda ko‘rinishi yozilgan |
| P4-08 | Medium | Global qidiruvda ombor va sifat tekshiruvi yo‘q edi; QC tekshiruvini havola bilan ochib bo‘lmasdi | FIXED | `searchIndex.ts` (ombor `?q=`, QC `?id=`), Quality → Tekshiruvlar `useRecordParam` |
| P4-09 | Medium | Forma: yozuv almashganda eski qiymat/xato qolishi mumkin edi (umumiy himoya yo‘q); xatoli submitdan keyin fokus joyida qolardi; ikki marta bosish ikki marta saqlashi mumkin edi | FIXED | `useForm(…, resetKey)`, `focusFirstInvalid`, 600ms takroriy submit himoyasi; `ResolveForm` key bilan |
| P4-10 | Medium | Kichik bosish nishonlari: switch 36×21, lokatsiya chipidagi o‘chirish 20×20, sarlavha saralash 23px | FIXED | Switch 40×24, chip tugmasi 24×24, `th-sort` ≥24px, `pointer:coarse` da ≥36px |
| P4-11 | Low | AI tugmasi mobil brauzer paneli / safe-area’ni hisobga olmasdi | FIXED | `aiDock.ts`: `visualViewport` balandligi, safe-area inset, nisbat bo‘yicha qayta joylash; noto‘g‘ri saqlangan qiymat → default |
| P4-12 | Low | `theme-color` meta yangi sahifa fonlariga mos emasdi (eski ko‘k-kulrang ranglar) | FIXED | Light `#f3f4f4`, dark `#111315` |

**Tekshirildi, muammo yo‘q:** overlay stack (Escape faqat yuqori qatlam, focus trap va qaytishi, ichma-ich scroll lock, portal, z-index shkalasi), Ctrl+K, KPI → filtrlangan modul (8/8), bildirishnoma → yozuv, mobil drawer, toast `aria-live`, Tabs/Select klaviatura, ruxsat yo‘q / topilmadi / sahifa xatosi holatlari.

**Cheklovlar:** iOS safe-area faqat `viewport-fit=cover` yoqilganda nolga teng bo‘lmaydi (hozir yoqilmagan — brauzer o‘zi chegaralaydi). “Muddat kechikishi” / “AI” bildirishnomalari uchun manba yaratish domen o‘zgarishi — Phase 5 doirasi. Brauzer QA pane yashirin holatda o‘tdi (rAF/animatsiyalar kechikadi), shu sababli vizual tekshiruv skrinshot + DOM o‘lchovlari bilan qilindi.

## Phase 3 (2026-10-26) — xarid/qabul, supplier, BOM/routing/variant, PLM/ECO, texnik xizmat

Testlar: `tests/phase3.test.mjs` (20 test, 22 ssenariy, sobit soat 2026-10-21 08:00). Jami suite: 253. Faol revisiya endi o‘zgarmas bo‘lgani uchun 2 ta eski test (BUG-12, P1-19/P1-30) yangi revisiya orqali o‘zgartirishga moslandi — tekshiruv mazmuni saqlangan.

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| P3-01 | Qoralama PO qatorlarini tahrirlab bo‘lmasdi | FIXED | `updatePurchaseDraft` (faqat Qoralama, supplier aloqasi/MOQ/birlik tekshiruvi) + UI tahrirlash |
| P3-02 | Qabulda supplier loti, joy, qabul qiluvchi, qabul/rad taqsimoti yo‘q edi; ichki lot kodi qayta ishlatilishi mumkin edi | FIXED | `PurchaseReceipt`: supplierLot, location, receivedBy, inspection, accepted/rejected/returned/scrapped; ichki lot bitta qabulga tegishli |
| P3-03 | Majburiy kirish QC `autoQualityChecks` o‘chirilganda o‘tkazib yuborilardi; umumiy QCP materialnikidan ustun bo‘lardi | FIXED | `blocking` Incoming QCP har doim karantinga oladi; materialning o‘z QCP’si birinchi |
| P3-04 | Kirish tekshiruvi faqat “hammasi yoki hech narsa” edi | FIXED | `inspectReceipt`: qisman qabul, lot bo‘linadi (available + hold), NCR ochiladi |
| P3-05 | Rad etilgan qismni scrap qilish yo‘q; supplier return lotning qabul qilingan qismini ham kamaytirardi | FIXED | `scrapRejectedReceipt`, `returnPurchaseToSupplier(qty)` faqat qaror kutayotgan rad etilgan qoldiq va hold lotdan |
| P3-06 | Supplier KPI faqat qabul sanasi va QC soniga tayanardi | FIXED | `supplierPerformance`: qator bo‘yicha vaqtida yetkazish, amaldagi lead time, rad ulushi (miqdor), narx farqi, bajarilish; ma’lumot yo‘q bo‘lsa `missing`; `supplierPurchaseHistory` |
| P3-07 | Bir nechta supplier bo‘lsa MRP tavsiyani bloklardi; narxi kiritilmagan link “eng arzon” bo‘lib qolardi | FIXED | `chooseSupplier`: asosiy supplier, aks holda muddat → MOQ bilan jami narx; narxsiz link faqat boshqasi bo‘lmasa, sabab bilan |
| P3-08 | Faol/arxiv BOM `saveBom` orqali joyida o‘zgarardi (tarix buzilardi) | FIXED | Faqat Draft saqlanadi; ECO review/approved draftni qulflaydi; `bomFingerprint` |
| P3-09 | Routing bog‘liqligi, work center va vaqtlar tekshirilmasdi | FIXED | `routingBlocker` (nom, arxiv WC, manfiy/0 vaqt, operator, yo‘q/o‘ziga/aylanma bog‘liqlik); `saveRouting`, `copyRouting`, `archiveBom` |
| P3-10 | Variantlar matn edi; SKU/shtrix-kod yagonaligi va variant BOM yo‘q | FIXED | `saveVariant` (values, barcode, kombinatsiya yagonaligi), `Bom.variantId`, `activeBomFor(product, variant)`, MO/SO’da variant; zaxira mahsulot darajasida |
| P3-11 | ECO o‘zgarishlarni muzlatmasdi, tasdiqdan keyin draft o‘zgarishi mumkin edi, bekor qilish/tarix yo‘q | FIXED | Review’da `changes` + fingerprint; tasdiq/qo‘llash fingerprint va faol bazani tekshiradi; `cancelEngineeringChange`; history, approvedAt/appliedAt; review = products.edit, tasdiq = products.approve |
| P3-12 | PM har doim +30 kun; reja yo‘q uskunaga '' sana bilan PM yaratilardi | FIXED | `MaintenancePlan` (kun/hafta/oy/ish soati), `maintenanceDue`, `recordEquipmentRuntime`, `saveMaintenancePlan`; corrective ish PM rejasini surmaydi |
| P3-13 | Maintenance buyurtmasini to‘g‘ridan-to‘g‘ri rejalash, ko‘chirish, davomiylik, tarix yo‘q; bir uskunaga ustma-ust servis | FIXED | `createMaintenanceOrder`/`updateMaintenanceOrder` (`needs-override` + sabab), plannedHours, downtimeMinutes, history; kalendar ko‘rinishi |
| P3-14 | Jarayondagi servis sig‘imda ikki marta hisoblanardi; davomiylik faqat so‘rovdan olinardi | FIXED | `workCenterDay`: to‘xtash bir marta, rejaning qolgan oynasi alohida; `maintenanceWindow` |
| P3-15 | MTBF/MTTR saqlangan (to‘qilgan) raqamlardan ko‘rsatilardi | FIXED | `reliabilityOf`: faqat qayd etilgan nosozliklardan; yetarli ma’lumot bo‘lmasa izoh bilan “—” |
| P3-16 | Maintenance amallari joy doirasi (scope) bilan tekshirilmasdi | FIXED | `scopeTargets`: maintenance buyurtma/so‘rov/reja/runtime → uskunaning work centeri |

**Cheklovlar:** PO’da QQS/chegirma maydonlari yo‘q (ma’lumot modeli qo‘llamaydi); supplier return PO qatorini qayta ochmaydi (almashtirish yetkazmasi yangi PO bilan); variantlar alohida zaxira saqlamaydi; routing BOM revisiyasi bilan birga versiyalanadi (alohida Routing obyekti yo‘q); runtime rejada keyingi sana prognoz qilinmaydi.

## Phase 5 (2026-10-26) — arxitektura, ishonchlilik, saqlash, testlar va CI

Audit: AppContext (holat, commit/persist yo‘llari, tablar), saqlash va migratsiya, xato chegaralari, marshrutlar, unumdorlik, lint/CI/E2E. Dalil: `tests/phase5.test.mjs` (10), `tests/ui/reliability.test.tsx` (7), `e2e/` (Playwright, 17). Jami: 263 domain + 46 UI + 17 E2E.

| ID | Daraja | Muammo | Holat | Tuzatish |
|---|---|---|---|---|
| P5-01 | High | O‘qilmagan saqlangan ma’lumot 250 ms’dan keyin avtomatik toza seed bilan almashtirilardi; nusxa UI’siz kalitda qolardi | FIXED | Tiklash rejimi: saqlash to‘xtaydi, `RecoveryScreen` (nusxani yuklab olish → tasdiq bilan toza holat); nusxa Tizim → Tiklash nusxalarida |
| P5-02 | High | Ro‘yxat ichidagi buzilgan yozuv (null, `workOrders`/`items`/`receipts` yo‘q, `onHand: null`, snapshot yo‘q) yuklashni yoki sahifani yiqitardi; yuklash xatosi oq ekran berardi | FIXED | `domain/persistence.ts`: tuzatish + hisobot + asl nusxa (`…-before-repair`); yuklash `try` ichida → tiklash rejimi; `RootBoundary` |
| P5-03 | High | Sozlama, bildirishnoma o‘qildi belgisi va tozalash tabning eski nusxasidan commit qilinardi; debounce yozuvi boshqa tabning yangi saqlovini o‘chirardi | FIXED | `commitLatest` (oxirgi nusxadan, darhol yozish); `syncedState.write` o‘qilmagan yangi ma’lumot ustidan yozmaydi (`conflict`) |
| P5-04 | Medium | Saqlash xatosi sessiyada bir marta aytilardi; keyingi amallar “bajarildi” deb ko‘rinardi | FIXED | Amal xabari “brauzerda saqlanmadi”, doimiy banner; muvaffaqiyatli saqlovda yo‘qoladi |
| P5-05 | Medium | Amaldan keyin arxivga ko‘chirilmagan holat yozilardi (commit qilinganidan farqli) | FIXED | `persist(stateRef.current)` |
| P5-06 | Medium | Muddatlari yo‘q/buzilgan sessiya hech qachon tugamasdi; buzilgan akkaunt yozuvi qidiruvni yiqitardi; `storage` hodisasidagi JSON xato berardi | FIXED | `normalizeSession`, `normalizeAuthStore` filtri, `sessionProblem` noto‘g‘ri vaqt → expired, xavfsiz `parseJson` |
| P5-07 | Medium | Toza holatdan keyin hech kim Super Admin emas (rol biznes ma’lumotida) → har amal bloklanardi | FIXED | `restoreSuperAdmin`: eng eski faol akkaunt xodimi |
| P5-08 | Medium | Toast faqat shell ichida: login oldidan chiqqan migratsiya/tuzatish xabarlari ko‘rinmasdi | FIXED | `Toasts` App ildizida |
| P5-09 | Low | Xotira o‘lchagichi faqat ish ma’lumotini sanardi (zaxiralar ham kvotani egallaydi) | FIXED | `storageUsage`: ish ma’lumoti + jami |
| P5-10 | Low | Favicon yo‘q → har yuklashda konsolda 404 | FIXED | Inline SVG icon |
| P5-11 | Low | Select tugmasida `aria-activedescendant` combobox rolisiz (noto‘g‘ri ARIA) | FIXED | `role="combobox"`, nom label’dan |
| P5-12 | Low | iOS safe-area: `viewport-fit=cover` yoqilmagan | FIXED | `viewport-fit=cover` + `--safe-*` tokenlari (inset 0 bo‘lgan qurilmalarda o‘zgarish yo‘q) |
| P5-13 | Tooling | Lint, CI va brauzer E2E yo‘q edi | FIXED | ESLint (26 topilma tuzatildi; a11y/hook istisnolari qatorida sababi bilan), `npm run check`, GitHub Actions, Playwright smoke |

**Tekshirildi, muammo yo‘q:** Sales → MRP → PO → qisman qabul → majburiy QC → MO rezerv → Shop Floor (+scrap) → Final QC → tayyor mahsulot → tannarx/OEE → yetkazish → qaytarish → qaror → lot trace → BOM revisiyasi (eski MO snapshot va tannarxi o‘zgarmaydi) zanjiri har qadamda va rad etilgan/takroriy amallardan keyin invariantlar bilan (qoldiq = harakatlar, manfiy/NaN yo‘q, rezerv egasi bor, havolalar butun); demo tarix ham shu invariantlarda. Unumdorlik (seed ma’lumoti): seed 0.7 ms, MRP 0.3 ms, nazorat markazi 0.9 ms — optimallashtirish talab qilinmadi; sahifalar allaqachon lazy.

**Kechiktirildi (sababi bilan):** umumiy UoM konversiyasi (BUG-12) va serial genealogy (N-11) — ma’lumot modeli o‘zgarishi; “Muddat kechikishi”/“AI” bildirishnomalari — haqiqiy hodisa manbai yo‘q, o‘chiq qoladi; runtime reja bo‘yicha keyingi sana prognozi — foydalanish tezligi ma’lumoti yo‘q, raqam to‘qilmaydi; supplier return PO qatorini qayta ochmaydi; sig‘im kun ichida emas, kunlik. localStorage tranzaksion emas: ikki tab bir millisekundda yozsa poyga mumkin (oyna toraygan, yo‘qolmagan). Brauzerdagi auth/RBAC xavfsizlik chegarasi emas.

## Audit Phase 1/5 (2026-10-28) — domen validatsiyasi va saqlash yaxlitligi

Testlar: `tests/integrity.test.mjs` (12 test) + `tests/ui/reliability.test.tsx` (+3). Hammasi o‘zgarishdan oldingi manba nusxasida yiqilishi tekshirilgan (scratchpad). Jami: 275 domain + 49 UI. Eski kutilishi “jim floor/clamp” bo‘lgan 4 ta assertion yangi qoidaga moslandi (phase1 P1-6/7, P1-9/23; release N-20 — miqdor 3 xonaga; phase5 P5-05 — takroriy ID endi karantinga).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| AUD-01 | Ombor adjust / MO / PO `Infinity`, `NaN`, matnni qabul qilardi | FIXED | `domain/validation.ts`: `checkQuantity` / `checkMoney` (chekli son, chegara `MAX_QUANTITY` 1e9, `MAX_MONEY` 1e12); adjust, transfer, count, receipt, MO, output, scrap, split, rework, unbuild, extra issue, PO, SO, delivery, return, forecast |
| AUD-02 | SO manfiy narxni qabul qilardi; PO manfiy narxni jim 0 ga tushirardi | FIXED | Narx ≥ 0, ko‘pi bilan 2 kasr; manfiy/cheksiz rad etiladi; berilgan 0 narx saqlanadi |
| AUD-03 | Adjust yo‘q item / ombor / arxiv yoki noto‘g‘ri turdagi omborga yetim qoldiq va harakat yaratardi | FIXED | Item va ombor mavjud, faol, mos tur; arxiv item faqat kamaytiriladi; joy bilan cheklangan rol noma’lum ombor/WC bilan ishlay olmaydi (`scopeBlocker`) |
| AUD-08 | Yangiroq `schemaVersion` eski ilovada ochilib, saqlashda pastga tushirilardi | FIXED | Yuklashda, boshqa tab saqlovida va importda aniqlanadi → faqat o‘qish tiklash ekrani (nusxani yuklab olish, sahifani yangilash; “toza holat” yo‘q); `syncedState` bunday matn ustiga yozmaydi (`locked`) |
| AUD-09 | Saqlash muvaffaqiyatsiz bo‘lsa ham amal `ok` qaytarardi, forma yopilardi | FIXED | `ok` = brauzerda saqlandi. Aks holda amal xotirada ham bekor qilinadi, `code:'not-saved'`, forma ochiq qoladi, sababi va keyingi qadam aytiladi; qayta bosish bir marta qo‘llaydi. Ko‘p tab himoyasi saqlangan |
| AUD-13 | Yangi tranzaksiya / master yozuv arxiv yoki yo‘q yozuvga bog‘lanardi | FIXED | Arxiv mahsulot/mijoz/supplier/material yangi MO/SO/PO’ga kirmaydi (eski hujjatlarda ko‘rinadi; rework istisno); MO’da WC/mas’ul/SO/liniya; `createEntity`/`updateEntity`da havolalar, filial↔liniya mosligi, raqamlar va sanalar (`ENTITY_REFS`, `ENTITY_NUMBERS`) |
| AUD-14 | Takroriy ID’lar faqat xabar qilinardi, ikkala nusxa ishlatilardi | FIXED | Birinchi nusxa (har bir `find` shuni olardi) qoladi, keyingilari o‘zgarmagan holda `quarantinedRecords`ga; o‘chirilmaydi, yangi ID berilmaydi; idempotent; asl matn “Tiklashdan oldingi ma’lumot”da |
| AUD-18 | Kasr miqdorlar jim kesilardi (`Math.floor`) | FIXED | Birlik bo‘yicha: kg/m/l — 3 kasrgacha aniq saqlanadi, ko‘prog‘i rad; dona/komplekt/list… va serial mahsulot — butun son, kasr rad. Ishlab chiqarish va sotuv tayyor mahsulotni dona bo‘yicha sanaydi |
| AUD-22 | Sana faqat regex bilan tekshirilardi (`2026-99-99` o‘tardi) | FIXED | `isIsoDate` / `isIsoStamp` — haqiqiy kalendar (kabisa yili), vaqt zonasiz; MO, PO, SO, meta, BOM/ECO, maintenance, expiry, xarajat |

**Saqlash:** `strictStringify` NaN/±Infinity’ni `null`ga aylantirmaydi — saqlashni to‘xtatadi (`invalid`).
**Cheklovlar:** kg birlikdagi mahsulotni kasr miqdorda ishlab chiqarish/sotish hali yo‘q (dvigatel donada sanaydi); karantindagi yozuvlarni ko‘rish uchun alohida UI yo‘q — backup eksportida va tiklash nusxasida; global vaqt zonasi Phase 4 doirasi.

## Audit Phase 2/5 (2026-10-28) — filial/ombor doirasi, rezerv, LOT va liniya yaxlitligi

Testlar: `tests/scopeStock.test.mjs` (20 test) + `tests/ui/scopeStock.test.tsx` (2). Phase 1 manba nusxasida 19/20 yiqiladi (qolgan bittasi — “to‘g‘ri filialda ishlaydi” nazorat testi); #6/#7 uchun eski `scopeBlocker` reserve/updateSalesMeta’da `null`, eski `scopedView` barcha SO’larni ko‘rsatardi. Jami: 295 domain + 51 UI + 17 E2E. Eski kutilishi xatoni kodlagan 2 assertion moslandi: B3-05 (muddati o‘tgan LOT rezerv qilinardi — endi “Material kutilmoqda”), P1-29 (fixture LOT muddati `2026-02-01` o‘tib ketgan — `2099-02-01`).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| AUD-04 | MO tayyor mahsuloti boshqa filial omboriga tushishi mumkin edi (fallback) | FIXED | `finishedWarehouseFor` faqat liniya filialidan; `outputWarehouseProblem`: mavjud, faol, Finished/Mixed, shu filial — berilgan `warehouseId` ham tekshiriladi; yaratish, tasdiqlash, boshlash va natijadan oldin (material sarflanmasdan) rad; yakunlangan MO’lar o‘zgarmaydi |
| AUD-05 | Sotuv Raw/WIP/arxiv/boshqa filial omboridan va muddati o‘tgan zaxiradan rezerv qilardi | FIXED | `salesSources`: faol Finished/Mixed + xodim doirasi; `freeIn` muddati o‘tganni chiqaradi; bir necha omborga bo‘linadi, ortiqcha rezerv yo‘q; yetkazish o‘z LOT’larini oladi, bekor qilish aniq qaytaradi; UI “yetarli emas” ham shu qoida bilan |
| AUD-06 | Ba’zi Sales amallarida scope nishoni yo‘q edi; view ruxsati bilan o‘zgartirish mumkin edi | FIXED | `commandBlocker` — bitta domen darvozasi (rol qoidasi + scope, amal ishlaydigan ma’lumotda); `salesOrderSites` (rezerv, yetkazilgan ombor, MO) → reserve/updateSalesMeta/cancel/deliver; QC check/alert nishonlari; `stockScope` MO manbalari, sotuv va transfer UI’da; MTO sotuvchi filiali liniyasida |
| AUD-07 | Filtrlangan ko‘rinish boshqa filial yozuvlarini ko‘rsatardi (SO, qaytarish, QC, alert, xabar, log) | FIXED | `scopedView`: SO joyi bo‘yicha (joysiz SO — umumiy navbat), qaytarish/QC/alert/xarajat/fayl/xabar/faoliyat yashirin hujjat bilan birga ketadi; qidiruv, deep link, dashboard shu ko‘rinishni o‘qiydi; ruxsatsiz deep link — `RecordUnavailable` (MO/SO/PO) |
| AUD-10 | MO tasdiqlashda muddati o‘tgan LOT rezerv qilinardi, chiqimda esa rad etilardi | FIXED | Rezerv qatori FEFO LOT’larni “pin” qiladi (`lots`), boshqa buyurtma ularni olmaydi; chiqim/yetkazish aynan shu LOT’larni oladi; pin yaroqsiz bo‘lsa (muddat, hold) rad + `refreshMaterialReservation` (hammasi yoki hech narsa) va drawer’da “Rezervni yangilash”; muddat kuni o‘zi yaroqli (`yyyy-mm-dd` taqqoslash) |
| AUD-11 | LOT bilan kuzatiladigan item LOT yozuvisiz (faqat ombor qoldig‘i bilan) ko‘chirilardi | FIXED | Transfer faqat yaroqli, rezervsiz LOT’lar bilan (berilgan `lots` yoki FEFO); qoldiq va LOT mos kelmasa rad + farq ko‘rsatiladi (tarix tuzatilmaydi); nusxa kelib chiqishi, muddati saqlanadi, bir xil kelib chiqish birlashadi |
| AUD-12 | MO tahririda noto‘g‘ri / boshqa filial liniyasi qabul qilinardi | FIXED | `productionLineProblem`: mavjud, faol, routing ish markazlari filialida; WC tekshiruvi; liniya faqat Qoralama/Material kutilmoqda va ish boshlanmagan (job card, material, vaqt yozuvi yo‘q) MO’da; yangi chiqish ombori ham tekshiriladi; formada xato va chiqish ombori ko‘rsatiladi |

**Siyosat:** master ma’lumotlar (item, mijoz, supplier, ombor nomlari, xodimlar) hamma uchun ko‘rinadi; tranzaksiyalar joyi bo‘yicha. Ko‘rish doirasi o‘zgartirishdan kengroq bo‘lishi mumkin (omborchi filial MO’larini ko‘radi, faqat o‘z omborida ishlaydi). Bu brauzerdagi demo avtorizatsiya — haqiqiy himoya server tomonida takrorlanishi kerak.
**Cheklovlar:** LOT pin’lari faqat yangi rezervlarda; eski (pin’siz) rezervlar ombor darajasida qoladi. Adjust (−) LOT yozuvlari yetishmasa “untracked” ajratadi — transfer qoidasi unga qo‘llanmagan. Qayta rezerv qilish uchun yetarli yaroqli zaxira bo‘lmasa buyurtma bloklanganicha qoladi (xabar bilan).

## Audit Phase 3/5 (2026-10-28) — variant qoldig‘i, joy (bin) qoldig‘i, o‘lchov birliklari, filial MRP

Testlar: `tests/inventoryPhase3.test.mjs` (23 test). Phase 2 manbasida (faqat o‘qish uchun bundle) to‘rt asosiy holat qabul qilinardi: LOT’siz (−) adjustment, eski rezervning ixtiyoriy LOT’dan chiqimi, boshqa filial zaxirasini “mavjud” deb hisoblash (`ALL available 300`), v2 mahsulotining v1 sotuviga rezervi. Moslangan 4 eski assertion: BUG-12 / P3-09 (“konversiya yo‘q” → endi mos birlik koeffitsiyent bilan saqlanadi, boshqa o‘lchov rad), BUG-01 / BUG-02 (pin’siz eski rezerv endi avval `allocateLegacyLots` bilan LOT’ga bog‘lanadi); UI testida transfer formasidagi select pozitsiya o‘rniga label bilan topiladi. Jami: 318 domain + 51 UI.

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| AUD-15 | Variantlarning SKU/BOM’i alohida, zaxirasi esa mahsulotda yig‘ilardi | FIXED | `Product.variantStock`: variant = alohida fizik item. Stock key `productId~variantId` (`inventory.ts`); balans, LOT, harakat, rezerv, MO chiqishi, SO rezerv/yetkazish, qaytarish variant bilan. v2 zaxirasi v1 talabiga berilmaydi; mahsulot jami (`productStockOf`) faqat ko‘rsatish uchun. Yangi MO/SO/(+)adjustment variantni talab qiladi. Rejim faqat `setVariantStock` bilan (pin’li ochiq SO bo‘lsa yoqilmaydi; variantda qoldiq bo‘lsa o‘chmaydi) |
| AUD-16 | MRP filiallar zaxirasi va talabini qo‘shib hisoblardi | FIXED | `runMrp` har filialni alohida nettinglaydi: filial omborlari, PO (ombori bo‘yicha), MO (chiqish ombori), SO (`branchId` → rezerv ombori → MO → standart filial), forecast (`branchId`/variant). Kalit `type:item:date@branch`; PO tavsiya filial xomashyo omboriga, MO tavsiya filial liniyasiga. Filiallararo transfer — faqat tavsiya (`transfers`), zaxira o‘zgarmaydi. Material safety stock bitta (standart filialda) |
| AUD-17 | Joylar bor, lekin zaxira faqat ombor darajasida edi | FIXED | `StockBalance.bins` — on-hand’ning joy bo‘yicha bo‘linishi (ikkinchi ledger emas): joysiz = onHand − Σbins. `LotRecord.location`, `StockMovement.location`. Qabul, MO chiqishi, transfer (manba/qabul joyi), `moveStockBin`, joy bo‘yicha sanoq/adjustment. LOT faqat turgan joyidan sarflanadi (`lotBinDraw`), joy manfiy bo‘lmaydi, Σbins ≤ onHand (`StockError`), qoldig‘i bor joy o‘chirilmaydi, scope tekshiruvi |
| AUD-24 | Universal o‘lchov birligi yo‘q edi | FIXED | `uom.ts`: kg↔g↔t, l↔ml, m↔cm↔mm, dona↔pcs; qadoq faqat item koeffitsiyenti bilan (`packs`), taxmin yo‘q; boshqa o‘lchov / koeffitsiyentsiz rad; butun son matematikasi, qat’iy aniqlik (kasr yo‘qolsa rad). BOM qatori `factor` bilan saqlanadi (`perUnit`), portlatish, MRP, PO qabul (`entered` saqlanadi), transfer, adjustment, qo‘shimcha chiqim shu servis orqali |
| LEG-A | Pin’siz eski rezerv ixtiyoriy LOT’dan sarflanardi | FIXED | `legacyGap` (qty − pin − aniq `untracked`); MO chiqimi / SO yetkazish rad + “LOT bilan bog‘lash” (`allocateLegacyLots`): FEFO, muddat, filial, xodim doirasi, boshqa pin’lar hisobga olinadi; yetmasa hech narsa o‘zgarmaydi. Yangi rezervlar LOT’siz qismini `untracked` deb yozadi |
| LEG-B | LOT bilan kuzatiladigan item (−) adjustment’i LOT’siz qoldiqdan ayirardi | FIXED | (−) farq faqat LOT yozuvlaridan (nomli yoki FEFO, muddati o‘tgan ham, rezervdagisi emas); yetmasa sonlar bilan rad, holat o‘zgarmaydi; har LOT uchun alohida harakat; `key` bilan takror yozuv rad |

**Migratsiya (sxema o‘zgarmadi, v4):** barcha yangi maydonlar ixtiyoriy va qo‘shimcha. Eski balanslar — joysiz; eski variantsiz mahsulot qoldig‘i variant yoqilganda “variant aniqlanmagan” bo‘lib qoladi (hech bir variantga berilmaydi, `assignVariantStock` bilan sanab biriktiriladi); eski BOM snapshot’lari (factor’siz) o‘zgarmaydi — birligi farq qilsa MRP’da “konversiya yo‘q” deb ko‘rsatiladi; eski SO/forecast filiali hosila qilinadi. Hech qanday tarixiy miqdor taqsimlanmaydi yoki o‘chirilmaydi; nomuvofiqliklar Ombor → Inventarizatsiya → Muvofiqlashtirish’da (`inventoryIssues`).
**Cheklovlar:** variant zaxirasi standart bo‘yicha o‘chiq (seed p1/p2 variantlari — rang/o‘lcham, fizik jihatdan farqli; yoqish foydalanuvchi qarori, chunki mavjud qoldiqni avtomatik bo‘lib bo‘lmaydi). Bir SO’da bitta mahsulotning faqat bitta qatori (variant A va B — alohida SO). LOT’siz eski qoldiqni LOT’ga aylantirish amali yo‘q (sanoq + adjustment). Joy faqat on-hand’ni bo‘ladi; rezerv ombor darajasida. Material safety stock filial bo‘yicha emas.

## Audit Phase 4/5 (2026-10-29) — debitorlik, vaqt zonasi, eksport, sub-day sig‘im, runtime prognoz

Testlar: `tests/phase4.test.mjs` (19 test, 24 talab), `tests/ui/receivables.test.tsx` (2 test).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| AUD-19 | Mijoz qarzi formada to‘g‘ridan-to‘g‘ri tahrirlanardi | FIXED | `receivables` ledger (`domain/receivables.ts`): boshlang‘ich qoldiq, yetkazishda hisob-faktura (kalit = yetkazilgan oraliq), to‘lov (`recordCustomerPayment`, submit kaliti, eng eski hisob-fakturaga taqsimlanadi, qarzdan oshmaydi), qaytarishda kredit-nota (bir marta, hisob-fakturadan oshmaydi), `adjustCustomerBalance` (`sales.approve`, sabab, kim). `Customer.debt` = ledger qoldig‘i (kesh); tahrirda rad. Eski `debt` yuklashda boshlang‘ich yozuvga o‘tadi. SO to‘lov holati ledgerdan. Sotuv → Debitorlik, mijoz kartasi, Xarajatlar KPI bir xil qoldiq. |
| AUD-20 | Kompaniya vaqt zonasi sanalarga qo‘llanmasdi | FIXED | `utils/dates.ts` — bitta qatlam: sana (`YYYY-MM-DD`) sof kalendar arifmetikasi; vaqt (`YYYY-MM-DD HH:mm`) kompaniya IANA zonasida, `parseDate` orqali instantga (DST: o‘tkazib yuborilgan vaqt oldinga, takrorlangan — birinchisi). “Bugun” kompaniya zonasidan; AppContext `setTimeZone`. Sozlamalarda zona tanlovi ishlaydi. |
| AUD-21 | Excel = HTML `.xls`, PDF = brauzer print | FIXED | `exportData.ts`: haqiqiy `.xlsx` (OOXML, stored ZIP + CRC, son/sana hujayralari, quotePrefix), UTF-8 BOM CSV, formula neytrallash, bo‘sh natija — fayl yo‘q. ResourceTable va Hisobotlar filtrlangan qatorlarni eksport qiladi. PDF tugmasi “Print / PDF saqlash” deb nomlandi. |
| AUD-23 | Sig‘im kun/smena darajasida edi | FIXED | `workCenterWindows`: smena boshlanishi, tanaffuslar, parallel birliklar, texnik xizmat/to‘xtash intervallari (DST to‘g‘ri). `scheduleOperations` intervallarga taqsimlaydi: oldingi operatsiyadan keyin, parallel sig‘imdan oshmaydi, yakunlangan ish ko‘chmaydi. Gantt’da sig‘im bo‘yicha reja chizig‘i (Calendar bilan bir xil manba). WC kalendari validatsiya qilinadi. |
| AUD-26 | Runtime bo‘yicha keyingi servis sanasi yo‘q edi | FIXED | `runtimeLog` (har o‘lchov), `runtimeForecast`: oxirgi 90 kundagi haqiqiy soat ÷ WC ish kunlari; <2 o‘lchov, <7 kun, 0 soat, eski o‘lchov → “Ma’lumot yetarli emas”; to‘xtagan uskuna — prognoz yo‘q. Taxmin jadvalni yozmaydi, tasdiqlangan PM alohida ko‘rsatiladi; `planPreventiveMaintenance` taxminiy sanadan bitta PM; ikkinchi ochiq preventive rad. Rejalashtirishda sig‘im ogohlantirishi. |
| P3-C1 | Safety stock faqat asosiy filialda hisoblanardi | FIXED | `RawMaterial.siteSafety` + `siteSafetyStock`: har filial o‘z safety stock’i bilan, o‘z zaxirasi/rezervi/kirimi bo‘yicha; boshqa filialnikini olmaydi; transfer faqat ortiqchadan. Material kartasida “Filiallar” tahriri. Bin ko‘chirishlar ombor rezervini buzmasligi testlandi (o‘zgartirish kerak bo‘lmadi). |

**Migratsiya (sxema v4, o‘zgarmadi):** `receivables` yo‘q bo‘lsa yuklashda `Customer.debt`’dan boshlang‘ich yozuvlar; boshqa yangi maydonlar ixtiyoriy.
**Cheklovlar:** saqlangan vaqt yozuvlari kompaniya zonasidagi devor-soat ko‘rinishida (UTC instant emas); zona o‘zgarsa eski yozuvlar qayta yozilmaydi va yangi zona bo‘yicha o‘qiladi. Ledgerdan oldingi buyurtmaga qaytarish avtomatik kredit-nota bermaydi (tuzatish orqali). Ish bilan band uskuna ulushi (parallel=1, bir nechta mashina) — ulush tezligi modeli. Playwright brauzeri o‘rnatilmagan: E2E `PW_CHANNEL=chrome` bilan ishga tushirildi.

## Audit Phase 5/5 (2026-10-29) — serial kuzatuv, supplier almashtirishi, haqiqiy bildirishnomalar, Phase 4 bo‘shliqlari, yakuniy QA

Testlar: `tests/phase5final.test.mjs` (22 test), `tests/ui/phase5.test.tsx` (4 test). Eski (Phase 4) kodda 6 asosiy ssenariy FAIL, yangi kodda PASS (scratchpad `oldbehavior.mjs`).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| AUD-25 | Serial faqat diapazon edi: qaysi birlik qayerda / kimga sotilgani noma’lum | FIXED | Har bir birlik — `kind:'serial'`, miqdori 1 bo‘lgan LOT yozuvi (`serialFrom=serialTo=code`, `batch` = qabul loti / MO diapazoni). Mavjud lot mexanizmi (FEFO, pin, QC holati, bin, transfer, qaytarish) birliklarni ko‘chiradi — alohida ombor dvigateli yo‘q. `domain/serials.ts`: `serialStatus` (holat, joy, manba, tarix — o‘zgarmas ledger qatorlaridan), `serialConflict` (faol / sotilgan / sarflangan raqamni qayta ro‘yxatga olmaydi; faqat supplierga qaytgan birlik qayta kiradi), `serialIssues`, `serialRegister`. Ishlab chiqarish va xarid qabuli har birlikka alohida harakat qatori yozadi; `RawMaterial.serialTracking` (faqat dona, ishlatilgandan keyin o‘zgarmaydi), qabulda raqamlar majburiy, qisman kirish QC’da rad etilgan raqamlar nomlanadi, mijoz qaytarishida yetkazilgan raqamlar tanlanadi (ikki marta qaytarib bo‘lmaydi). UI: Ombor → Seriallar (birlik reyestri + eski diapazonlar), Traceability serial kartasi, qabul/QC/qaytarish formalari |
| AUD-27a | Supplierga qaytarishdan keyin almashtirish jarayoni yo‘q edi | FIXED | `SupplierReplacement` + `requestSupplierReplacement` / `receiveSupplierReplacement` / `closeSupplierReplacement`: asl PO, qabul, QC, supplier, qaytgan lot/serial’ga bog‘langan; qisman/to‘liq; so‘rov va qabul kalit bilan idempotent; almashtirish qabuli doim kirish QC karantiniga, PO qatori va statusi o‘zgarmaydi; `replacementView` (so‘ralgan/kelgan/qabul/rad/qolgan) qabullardan hisoblanadi. KPI: o‘z vaqtida/lead time faqat asl yetkazish, bajarilish qabul qilingan almashtirishni hisobga oladi. UI: Xaridlar → Almashtirish |
| AUD-27b | Bildirishnomalar hodisaga bog‘lanmagan, takrorlanardi, filial doirasi yo‘q | FIXED | `notify(..., {key, branchId})`: bitta hodisa — bitta xabar. `domain/notifications.ts` `scanNotifications`: kechikkan MO, kechikkan PO, servis muddati, MRP yetishmovchiligi, MRP tavsiyalari (hisob, AI emas) — faqat muvaffaqiyatli va saqlangan buyruqdan keyin (AppContext). QC rad, MO yakuni, qaytarish, almashtirish — buyruqning o‘zida kalit bilan. `scopedView` boshqa filial xabarini yashiradi; Sozlamalar: kechikish, ishlab chiqarish, xarid, MRP toggle’lari; AI toifasi o‘chiq va sababi yozilgan |
| P4-F1 | Ledgerdan oldingi buyurtma qaytarishi kredit-notasiz qolardi | FIXED | `orderInvoicing` (ledger / legacy / mixed), `returnCreditGap`; eski qism uchun `ReceivableReconciliation` ochiladi, `resolveReturnCredit` (sales.approve, sabab majburiy): kredit (kalit `credit:<ret>:legacy`, eski qiymatdan oshmaydi) yoki kreditsiz. Qaror yakuniy va idempotent; boshlang‘ich qoldiq va to‘lovlar o‘zgarmaydi; yangi buyurtma qaytarishi avvalgidek avtomatik. UI: Debitorlik → “Eski buyurtmalar qaytarishi” |
| P4-T1 | Zona o‘zgarsa eski devor-soat yozuvlari yangi zonada o‘qilardi | FIXED | `settings.company.zoneHistory` (`recordZoneChange`), `parseDate` yozuvni yozilgan paytdagi zonada o‘qiydi; ISO instant (`T…Z/±hh:mm`) o‘zicha; `timestampKind`. Saqlangan qiymatlar qayta yozilmaydi; sana-faqat qiymatlar sof kalendar |
| P4-C1 | Ko‘p mashinali WC sig‘imi ulush bilan taxminlanardi; parallel 2 bitta mashinani ikki marta band qilardi | FIXED | `workCenterWindows.machines` (har mashina o‘z smena/tanaffus/servis/to‘xtash oralig‘i), `workCenterDay` = min(bo‘sh mashinalar, parallel) integrali; `scheduleOperations` mashina bo‘yicha: bir mashina — bir operatsiya, eng erta tugaydigan mashina, `ScheduledOperation.machineId` (boshlangan operatsiyaga mashina to‘qilmaydi). Gantt tooltip rejadagi mashinani ko‘rsatadi. Phase 4 “Scheduling 18” testi shu yangi semantikaga moslandi (bitta mashina + parallel 2 = ikki marta band qilish edi) |
| QA5-01 | Traceability per-unit seriallarda yuzlab qator chiqarardi | FIXED | Jo‘natmalar hujjat bo‘yicha guruhlanadi, omborda qolgan birliklar ombor bo‘yicha jamlanadi |
| QA5-02 | `/costs?view=overview` 375px’da 56px gorizontal toshish | FIXED | Standart/amaldagi tannarx jadvali `table-scroll` ichida |

**Migratsiya (sxema v4, o‘zgarmadi):** yangi to‘plamlar (`supplierReplacements`, `receivableReconciliations`) yo‘q bo‘lsa bo‘sh ro‘yxat; yangi maydonlar ixtiyoriy; hech qanday tarixiy yozuv qayta yozilmaydi.
**Cheklovlar:** (1) birlik kuzatuvidan oldingi serial diapazon yozuvlari o‘qiladi va miqdor bo‘yicha ishlaydi, lekin qaysi raqam qolgani noma’lum — birlik o‘ylab topilmaydi; yetkazishda tizim FEFO + eng kichik raqamni oladi (operator yetkazishda aniq raqamni skanerlab tanlamaydi — transfer/qaytarishda tanlanadi). (2) Zona tarixi yoqilishidan oldingi yozuvlar birinchi qayd etilgan (oldingi) zonada o‘qiladi; o‘zgarish atrofidagi |Δoffset| oralig‘ida yozilgan devor-soat qiymati ikki ma’noli — yangi zona tanlanadi. (3) Bildirishnoma ro‘yxati 150 ta bilan cheklangan; tushib ketgan kalitli hodisa holat davom etsa qayta paydo bo‘lishi mumkin; yetishmovchilik/MRP xabari kuniga bittadan. (4) Bu frontend demo: RBAC, idempotentlik va tranzaksiyalar brauzerda; backend xavfsizligi, haqiqiy ko‘p foydalanuvchi tranzaksiyasi yo‘q (audit #28).

### Pre-merge tekshiruvi (2026-10-29)

Testlar: `tests/premerge.test.mjs` (4), `tests/ui/phase5.test.tsx` (+1).

| ID | Muammo | Holat | Tuzatish |
|---|---|---|---|
| PM-01 (High) | Phase 5 qoidalari bilan yozilgan ma’lumot hali v4 belgisida edi: Phase 1–4 build uni ochib, qoidani buzib qayta yozishi mumkin edi (serial materialni raqamsiz qabul qilish, almashtirish qabulini PO qabuli deb hisoblash) | FIXED | `SCHEMA_VERSION=5`, v5 qadami faqat belgi (yozuvlar o‘zgarmaydi). Yangi qulfli (v4) build v5 ma’lumotni faqat o‘qish rejimida ochadi |
| PM-02 (High) | Versiya yangilanishi zaxirasi bitta `before-v4` kalitida edi: v3→v4 nusxasi bo‘lsa, v4→v5 oldidan nusxa olinmasdi | FIXED | Har versiyaga alohida kalit (`zenix-manufacturing-before-v<N>`), tiklash nusxalari ro‘yxatida hammasi |
| PM-03 (Medium) | Serial chiqishi kvadratik edi (har birlik butun ledger’ni nusxalardi): 25 000 birlik ≈ 4 s | FIXED | `addMoves` bitta yozuvda: 10 000 → 73 ms, 25 000 → 157 ms; tartib avvalgidek |
| PM-04 (Medium) | Zona o‘zgarishi atrofidagi yozuv nisbiy vaqt / dashboard’da aniq vaqt sifatida ko‘rinardi | FIXED | `stampZones` / `isAmbiguousStamp` / `displayStamp`: ma’lum zonadagi eski vaqt bugungi zonaga o‘giriladi, noaniq vaqt yozilganicha “vaqt noaniq” / “≈” belgisi bilan |

**Qolgan xavflar:** Chrome localStorage ≈ 5,23 M belgi (o‘lchangan); bir serial birlik ≈ 600 belgi → amalda ~7 000 birlikdan keyin saqlash rad etiladi va amal qaytariladi (ma’lumot yo‘qolmaydi); 10 000+ uchun IndexedDB/backend kerak. `origin/main` build’ida yangi-versiya qulfi yo‘q: v5 ma’lumot ochilgandan keyin main build’ga qaytish xavfli — `before-v5` nusxasidan tiklang. Davomiylik (time log) hisobi zona o‘zgarishi oynasidagi yozuvlar uchun |Δoffset| gacha farq qilishi mumkin.

## Phase 3.6 (2026-11-09) — RBAC, auth va subcontract qiymati

### ZENIX-Pro 2026-11-11 qo‘shimcha tekshiruvi

| ID | Holat | Tuzatish va dalil |
| --- | --- | --- |
| ZP-001/002 | FIXED | Yangi tenantda eski `super_admin` roli yo‘q; v7 hydration uni qayta qo‘shmaydi; kompaniya rol ro‘yxati, nusxalash va platform ruxsati domain chegarasida bloklangan. Domain, UI, desktop/mobil E2E. |
| ZP-003 | FIXED | Employees profilidan login yaratishga o‘tiladi, vaqtinchalik parol bir marta ko‘rsatiladi; xodim birinchi kirishda parolini almashtiradi. Desktop/mobil E2E. |
| ZP-004 | FIXED | Akkaunt yaratish xatosidan keyin qayta urinish saqlangan xodim profilini ishlatadi; ikkinchi profil ochmaydi. UI regressiya. |
| ZP-005 | FIXED (future migration) | Eski `super_admin` tayinlovi avtomatik `business_owner` ga aylantirilmaydi. Ilgari saqlangan o‘zgarishlar avtomatik qaytarilmaydi; alohida vakolatli tekshiruv kerak. Domain regressiya. |

To‘liq dalil va cheklovlar: `docs/audits/ZENIX_PRO_FULL_AUDIT.md`.

| ID | Holat | Natija |
| --- | --- | --- |
| ZA-001 | FIXED (frontend demo) | Filialga cheklangan xodim, sayt, xarajat va ledger ko‘rinishi hamda qarz yig‘indisi scope bo‘yicha tanlanadi; ko‘p filial topshirig‘i aniq yoziladi. |
| ZA-002 | CORE FIXED | Yuborilgan material va UZS ga konvertatsiya qilingan xizmat qiymati qisman qabulga taqsimlanadi; QC Passed LOT tannarxini ochadi, Scrap xarajatga chiqaradi; takror qabul kaliti bloklanadi. Qabulgacha sababli tuzatish va Draft bekori bor. |
| ZA-004 | FIXED | Ommaviy ro‘yxatdan o‘tishning domain kirishida egasi va kompaniya nomi majburiy. |
| ZA-005 | FIXED (bir brauzer) | Ishlatilgan imzolangan recovery chipta fingerprinti saqlanadi va qayta ishlatilmaydi. |
| ZA-006 | FIXED | Platforma chiptasi muddati tugaganda sahifadagi maxfiy metama’lumot avtomatik yashiriladi. |
| ZA-007 | PARTIAL | Ishlatilmagan vaqtinchalik parol 7 kunda tugaydi; xavfsiz yetkazish backendga bog‘liq. |
| ZA-012 | FIXED | Scoped rol uchun xodim profilida va akkaunt faollashtirishda filial/ish markazi/ombor tekshiriladi. |

**Ochiq:** ZA-008 yakuniy COGS farq jurnali, ZA-009 ko‘p kalitli ro‘yxatdan o‘tish atomikligi, ZA-010 kompaniya nomi/ID siyosati, yuborilgan material qaytarishi va qabuldan keyingi subcontract narx tuzatishi. Bularni tarixiy tannarxni dalilsiz qayta yozmasdan loyihalash kerak. Tafsilot va tekshiruvlar: `docs/audits/ZENIX_PHASE36_REPORT.md`.
