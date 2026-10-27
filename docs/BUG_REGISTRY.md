# ZENIX — yagona BUG reyestri

Manbalar: 1-audit (BUG-01…18), mahsulot auditi (N-01…26), 3-audit (B3-01…15), Login/RBAC auditi (A-C1…A-L4).
Takrorlar bitta qatorga birlashtirilgan, har bir ID saqlangan. Oxirgi yangilanish: 2026-10-26 (Phase 5).

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
| BUG-14 | Tablar, debounce, buzilgan JSON, import | FIXED | Har bir domain amali saqlangan oxirgi nusxani o‘qib, boshqa tab yozganini davom ettiradi va darhol saqlaydi (`syncedState.ts`); `storage` event sinxronlash; tab yopilganda flush; o‘qilmagan JSON alohida kalitga; import/restore ruxsat bilan, oldin zaxira oladi, shakl va Super Admin tekshiruvi | release BUG-14 (2 test) | localStorage’da qulf yo‘q: ikki tab bir necha millisekund ichida yozsa poyga mumkin. Bu tranzaksiya emas — server kerak |
| B3-01 | Split bola MO Passed QC holatini meros oladi | FIXED | Bola MO `Pending` bilan boshlanadi | bugRegistry B3-01 | — |
| B3-02 = A-H1 | Demo foydalanuvchi almashtirgichdan qaytib bo‘lmaydi | FIXED | `switchUser` olib tashlandi; identifikatsiya faqat login sessiyasidan | access A-61 (`switchUser:allowed→refused`), auth | — |
| B3-03 | Qo‘lda kirish QC’si birinchi receipt’ni hal qiladi | FIXED | Aniq receipt majburiy; eski yozuvlar faqat bitta mos receipt bo‘lsa | bugRegistry B3-03 | — |
| N-01 | Final QC natijadan oldin Passed bo‘ladi | FIXED | Natijasiz Final yaratilmaydi/hal qilinmaydi | bugRegistry N-01 | — |
| N-02 | Final Scrap omborga ta’sir qilmaydi | FIXED | Ushlab turilgan birliklar scrap sifatida chiqadi | bugRegistry N-02 | — |
| N-03 | Supplier return takrorlanadi | FIXED | `returnedQty`; ikkinchi qaytarish rad etiladi | bugRegistry N-03 | Supplier qarzi (debit) yozilmaydi — moliya moduli yo‘q |
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
