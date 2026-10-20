# ZENIX — yagona BUG reyestri

Manbalar: 1-audit (BUG-01…18), mahsulot auditi (N-01…26), 3-audit (B3-01…15), Login/RBAC auditi (A-C1…A-L4).
Takrorlar bitta qatorga birlashtirilgan, har bir ID saqlangan. Oxirgi yangilanish: 2026-10-20.

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
| N-14 | MRP needBy = bugun + lead time; vaqt bo‘yicha taqsimlanmagan | PARTIAL | `needBy` endi talab sanasi: draft MO boshlanishi yoki MPS’ning birinchi yetishmovchi haftasi, ota mahsulot ishlab chiqarish vaqti ayirilgan | release N-14 | Netting haftalarga bo‘lingan emas (ufq bo‘yicha jami) — to‘liq time-phased MRP alohida ish |
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
| A-H6 | `scope` qo‘llanmaydi | PARTIAL | Domain darajasida (`scopeBlocker`): `workcenter` — sex ishi faqat o‘z ish markazida; `branch`/`warehouse` — faqat o‘z filiali (filial xodimning ish markazidan) | release A-H6 (2 test) | `warehouse` scope alohida omborga emas, filialga bog‘lanadi (xodimda ombor maydoni yo‘q); ro‘yxatlar filtrlanmaydi — faqat amallar |
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
