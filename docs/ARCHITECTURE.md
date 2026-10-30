# ZENIX Manufacturing — arxitektura

## Qatlamlar

```text
feature page (src/features/*)
   ↓  useApp() — bir xil API
AppProvider (src/app/providers/AppProvider/AppContext.tsx)
   ↓  execute(action): sessiya → RBAC (access.ts) → scope → boshqa tab saqlaganini o‘qish → toza action → Super Admin invarianti → commit + darhol saqlash → toast
Domain actions (src/domain/actions.ts)          ← pure: (state, ctx, ...args) → {state, result}
Domain engine  (src/domain/manufacturingEngine.ts) ← pure hisob-kitoblar (MPS/MRP/capacity/OEE/costing/trace)
   ↓
localStorage: zenix-manufacturing-v3-state (biznes) · zenix-auth-v1 (akkauntlar, xeshlar, kirish jurnali) · zenix-session-v1 · zenix-activity-archive-v1
```

- **Actions React’dan mustaqil.** Har bir biznes amali (MO lifecycle, work order, rezerv, qabul, yetkazish, QC, maintenance, ECO, …) `src/domain/actions.ts` ichida sof funksiya. Natija sinxron qaytadi — UI xabari har doim haqiqatda nima bo‘lganini aytadi.
  Oldingi versiyada natija `setState` updater ichida hisoblanib, tashqarida o‘qilardi; React updater’ni kechiktirsa (masalan, ketma-ket ikki amal) muvaffaqiyatli amal “bajarilmadi” deb ko‘rsatilardi.
- **RBAC ikki qatlamda:** sidebar/route/view guard (ko‘rish) va har bir action (`domain/access.ts`: `ACTION_RULES`, `entityRules`, `scopeBlocker`) — tugma yashirilmagan bo‘lsa ham ruxsatsiz amal bajarilmaydi. Login va sessiya `domain/auth.ts`da; parol xeshi `shared/lib/crypto.ts` (PBKDF2). Batafsil: `docs/AUTH.md`.
- **Tablar:** har bir amal oldidan saqlangan oxirgi nusxa o‘qiladi (`shared/lib/syncedState.ts`), boshqa tab yozgani ustidan davom etiladi va natija darhol saqlanadi; `storage` hodisasi qolgan tablarni yangilaydi. Bu tranzaksiya emas (localStorage’da qulf yo‘q).
- **Seed ma’lumot replay qilinadi.** `src/data/mockData.ts` master data’ni e’lon qiladi, tarixni esa haqiqiy action’larni bugungi sanaga nisbatan ketma-ket chaqirib yaratadi. Shuning uchun rezerv, lot, harakatlar, time log, QC va tannarx doim o‘zaro mos (testlar invariantni tekshiradi).
- **O‘qish/tahlil qatlamlari** (`src/domain/dashboard.ts`, `src/domain/productionControl.ts`): Boshqaruv paneli va Ishlab chiqarish → Umumiy (nazorat markazi) o‘z holatiga ega emas — raqamlar engine yordamchilaridan olinadi va aynan shu yordamchilar manzil sahifalarida ham ishlatiladi (`materialShortages`, `operationQueues`, `capacityConstraints`, `orderBlocker`, `equipmentActivity`, `scrapEvents`, `weeklyProductionPlan`, …). Shu sabab dashboard raqami = bosilganda ochiladigan filtrlangan ro‘yxat qatorlari yoki jami; `tests/dashboard.test.mjs` va `tests/productionControl.test.mjs` shu moslikni tekshiradi.
- **Backend ulanishi:** `domain/actions.ts` funksiyalari REST endpoint’larga 1:1 mos keladi; `AppContext.execute` ichidagi chaqiruvni API chaqiruviga almashtirish kifoya.

## Ma’lumot oqimi (asosiy bog‘lanishlar)

```text
Supplier → PO (Qoralama → Tasdiqlangan[incoming+] → Yo‘lda) → Qabul [lot, on hand+, incoming−, incoming QC]
                                                                   ↓ kutayotgan MO avtomatik rezerv
Sotuv/Forecast → MPS (haftalik: max(forecast, sotuv)) → MRP (ko‘p bosqichli netting: make / buy)
   → MO (BOM snapshot, work orderlar) → Tasdiqlash [rezerv yoki “Material kutilmoqda”]
   → Work orderlar (routing bog‘liqligi; labor + machine time loglari)
   → Natija kiritish [backflush sarf (FIFO lot), tayyor mahsulot + lot/serial, by-product, scrap]
   → Sifat nazorati [Final QC avtomatik; Failed/Rework/Scrap yakunni bloklaydi]
   → Yakun [qolgan backflush, rezerv yopiladi, haqiqiy tannarx, MTO sotuvga rezerv]
   → Sotuv yetkazish [FIFO lot, Sale− harakati] → Qaytarish [inspection → ombor / rework MO / scrap]
Uskuna: downtime hodisasi ↔ OEE availability ↔ capacity; maintenance so‘rovi → buyurtma → downtime → xarajat
PLM: ECO → draft BOM revision → review → approve → apply (eski MOlar o‘z snapshotini saqlaydi)
```

## Saqlash va tiklash

| Kalit | Mazmun |
|---|---|
| `zenix-manufacturing-v3-state` | ish ma’lumoti (bitta JSON, `schemaVersion`) |
| `zenix-auth-v1` · `zenix-session-v1` | akkauntlar va xeshlar · shu brauzer sessiyasi (backup’ga kirmaydi) |
| `zenix-activity-archive-v1` | 600 tadan eski faoliyat yozuvlari |
| `zenix-manufacturing-v3-before-reset` | tozalash / import / tiklashdan oldingi zaxira (Tizim → Tiklash) |
| `zenix-manufacturing-before-v4` · `…-v3-before-repair` · `…-v3-unreadable` | migratsiyadan · tuzatishdan oldingi · o‘qilmagan asl nusxa (Tizim → Tiklash nusxalari) |

- **Yuklash** (`domain/persistence.ts` → `prepareStored`): har bir ro‘yxatda yozuv bo‘lmagan / ID’siz elementlar chetga olinadi va sanaladi; ichki ro‘yxatlar (`workOrders`, `items`, `receipts`, …) va miqdorlar (`onHand`, `quantity`, …) yo‘q bo‘lsa `[]` / `0`; BOM snapshot’i yo‘q MO bugungi BOM’dan **tiklanmaydi** — bo‘sh, belgilangan snapshot oladi; takroriy ID faqat xabar qilinadi (ikkala nusxa saqlanadi). Keyin `normalizeLoaded` (keyingi versiyalarda qo‘shilgan ro‘yxat/sozlamalar) va `migrateState` (versiyali, idempotent). Yangiroq versiya saqlagan ma’lumot pasaytirilmaydi, foydalanuvchiga aytiladi. Xuddi shu yo‘l backup import va boshqa tab saqlagan matn uchun ham ishlatiladi.
- **Tiklash rejimi:** JSON o‘qilmasa yoki holat qurib bo‘lmasa, ilova saqlashni to‘xtatadi va `RecoveryScreen`ni ko‘rsatadi (nusxani yuklab olish → toza holatda ochish). Toza holatda birinchi sozlangan akkaunt xodimi Super Admin bo‘lib qoladi (`restoreSuperAdmin`), aks holda hech kim amal bajara olmasdi.
- **Yozish:** domain amali va UI sozlamalari saqlangan oxirgi nusxadan davom etadi va darhol yoziladi (`syncedState.ts`). Boshqa tab o‘qilmagan yangi ma’lumot saqlagan bo‘lsa yozuv rad etiladi (`conflict`): o‘sha ma’lumot qabul qilinadi va foydalanuvchiga oxirgi o‘zgarish saqlanmagani aytiladi. Yozish muvaffaqiyatsiz bo‘lsa (`failed`) amal xabari “saqlanmadi” deydi va saqlash tiklanguncha doimiy banner turadi.
- **Xatolar:** `RootBoundary` (provider va shell ustida, kontekstsiz) + har sahifada `PageBoundary`; foydalanuvchiga texnik tafsilot ko‘rsatilmaydi, faqat qayta yuklash va ma’lumot nusxasi.

## Backend integratsiya nuqtalari

Sahifalar biznes ma’lumotini faqat `useApp()` orqali o‘qiydi va o‘zgartiradi; localStorage’ga to‘g‘ridan-to‘g‘ri faqat qurilma darajasidagi UI qulayliklari yozadi (sidebar holati, AI tugma joyi, xomashyo forma qoralamasi). Shuning uchun almashtiriladigan joylar AppProvider ichida:

| Hozir | Backend bilan |
|---|---|
| `execute(name, fn, rules)` — sof `actions.ts` funksiyasi lokal holatga | `POST /api/commands/{name}` (yoki resurs endpoint’i) — server o‘sha qoidani (`ACTION_RULES`, `scopeBlocker`) va invariantlarni tekshiradi; javobdagi holat/patch `commit` qilinadi |
| `hydrate()` + `prepareStored` | dastlabki `GET` (scope bo‘yicha); migratsiya serverda |
| `persist` / `syncedState` / `storage` event | server versiyasi (ETag / `If-Match`) — `conflict` oqimi aynan shu javobga mos keladi |
| `domain/auth.ts` + `crypto.ts` (PBKDF2 brauzerda) | server sessiyasi (HttpOnly cookie), parol xeshi serverda — [AUTH.md](AUTH.md) |
| `scopedView` (o‘qishni cheklash) | serverda filtrlangan so‘rovlar |

`manufacturingEngine.ts` / `planning.ts` / `dashboard.ts` sof hisob-kitoblar — klientda (ko‘rinish) va serverda (tekshiruv) bir xil ishlatilishi mumkin. Brauzerdagi RBAC — UX qatlami; haqiqiy xavfsizlik chegarasi faqat server bo‘ladi.

## UI arxitekturasi

- **Overlay stack** (`shared/ui/Overlays.tsx`): Modal, Drawer, Popover, Select, mobil navigatsiya bitta stekda ro‘yxatdan o‘tadi. Faqat eng yuqori qatlam Escape, Tab (focus trap) va tashqi bosishni qabul qiladi; fokus ochuvchi elementga qaytadi; scroll lock `scrollbar-gutter: stable` bilan sakramaydi.
- **z-index shkalasi** (`styles/tokens.css`): sticky 10 · sidebar 30 · topbar 40 · AI dock 50 · mobil nav 60 · modal/drawer 100 · popover 200 · toast 300. Popover modal ichidan ochilishi mumkinligi sababli moddan yuqorida.
- **ResourceTable** (`shared/ui/ResourceTable.tsx`): ko‘rinadigan matn bo‘yicha qidiruv, raqamli/locale tartiblash (tri-state, `aria-sort`), filtr slotlari va “Tozalash”, sahifa o‘lchami, joriy natijani CSV eksport, bir marta bosib ochish, telefonda kartalar. Filtrlar URL’da (`useSearchParamState`), yozuv drawer’i `?id=` orqali ochiladi (deep link, global qidiruv, bildirishnomalar).
- **Shell**: `Sidebar` (collapse saqlanadi, hover/klaviatura flyout, mobil drawer + accordion, `inert`), `Topbar` (global qidiruv / Ctrl+K palette, kontekst, Theme·Fon·Valyuta·Fullscreen, bildirishnomalar, profil: parolni o‘zgartirish va chiqish), `AiAssistant` (o‘ng chetdagi ingichka tab, faqat Y bo‘yicha suriladi; o‘ngdan chiquvchi overlay panel — sahifa o‘lchami o‘zgarmaydi). Sidebar ≤1024px’da off-canvas drawer.
- **Sahifalar lazy yuklanadi** (`App.tsx`), har sahifa ErrorBoundary bilan; ilova ildizida `RootBoundary`. Toast’lar barcha marshrutlarda (login/register ham) ko‘rinadi.
- **iOS safe-area:** `viewport-fit=cover` + `--safe-top/right/bottom/left` tokenlari (topbar, sidebar drawer, kontent pasti, AI tugma, toast, auth sahifasi). Boshqa qurilmalarda inset 0 — joylashuv o‘zgarmaydi.

## Uslublar

CSS manbalari (preprocessor yo‘q) `scripts/build-styles.mjs` orqali `src/styles.css`ga yig‘iladi: `tokens → base → controls → surfaces → data → overlays → shell → modules`. Generated faylni tahrirlamang.

## Zaxira identifikatsiyasi, joylar va o‘lchov birliklari (Audit Phase 3, 2026-10-28)

- **Stock key** (`src/domain/inventory.ts`): fizik item — material/mahsulot id, variant zaxirasi yoqilgan mahsulotda `productId~variantId`. Saqlanadigan yozuvlar `itemId` + `variantId` ni alohida saqlaydi; engine qatorlarni `keyOf` bilan taqqoslaydi. Kalit backend’da ham bir xil (item, variant) juftligi bo‘ladi.
- **Joylar**: `StockBalance.bins` (joy → on-hand) balansning bo‘linishi; joysiz qism = onHand − Σbins. Alohida joy ledger’i yo‘q, shuning uchun ombor jami har doim joylar yig‘indisiga teng. LOT o‘z joyida (`LotRecord.location`); sarf LOT turgan joydan ayiriladi.
- **UoM** (`src/domain/uom.ts`): yagona konversiya servisi; omborda hamma narsa item’ning ombor birligida. BOM qatoriga saqlashda `factor` yoziladi, hujjat qabulida yozilgan birlik `entered` sifatida saqlanadi.
- **Sayt MRP** (`planning.ts runMrp`): har filial alohida; natijada `rows/suggestions` (`branchId` bilan) va `transfers` (faqat tavsiya).
- **Migratsiya**: yangi maydonlar ixtiyoriy — sxema v4 qoladi, eski ma’lumot o‘zgartirilmaydi; noaniqliklar `inventoryIssues` orqali ko‘rsatiladi va faqat aniq amal (`allocateLegacyLots`, `assignVariantStock`, `moveStockBin`) bilan hal qilinadi.

## Sana, debitorlik, eksport va sub-day sig‘im (Audit Phase 4, 2026-10-29)

- **Sana qatlami** — `src/utils/dates.ts`. Sana-faqat qiymatlar sof kalendar; vaqt belgilari kompaniya IANA zonasida (`settings.company.timezone`, `setTimeZone`, globalThis orqali barcha bundle’larga umumiy). Brauzer zonasiga tayanilmaydi.
- **Debitorlik** — `src/domain/receivables.ts` (o‘qish) + `actions.ts` (`postReceivable`, `recordCustomerPayment`, `adjustCustomerBalance`, yetkazish/qaytarish hook’lari). Yozuvlar faqat qo‘shiladi, `key` bilan idempotent.
- **Eksport** — `src/utils/exportData.ts`: `exportRows('xlsx'|'csv')`, `toXlsx`, `zipStored`, `crc32`. Boshqa sahifalar faqat shu funksiyani chaqiradi.
- **Sig‘im** — `workCenterWindows` (engine) → `workCenterDay` (kunlik) va `scheduleOperations` (finite, intervallar). `runtimeForecast`/`forecastWarnings` — `maintenance.ts`.

## Serial, almashtirish, bildirishnoma va reja mashinalari (Audit Phase 5, 2026-10-29)

- **Serial birlik = LOT yozuvi (miqdor 1).** `domain/serials.ts` faqat o‘qiydi: holat yozuvdan (ombor, joy, QC holati), chiqish sababi esa shu raqamli oxirgi manfiy ledger qatoridan. Ikkinchi inventar yo‘q; `addUnitMoves` serial birlik chiqqanda har biriga alohida qator yozadi.
- **Supplier almashtirishi** asl PO’dagi `replacementId`li qabul sifatida yoziladi (`receiveGoods(..., rep)`): PO qatori/statusi o‘zgarmaydi, doim kirish QC. Hisoblar `replacementView` orqali qabullardan.
- **Bildirishnomalar:** hodisa kaliti (`key`) bilan; holatga bog‘liq tekshiruv (`scanNotifications`) AppContext `execute` ichida faqat muvaffaqiyatli buyruqdan keyin, saqlash bilan birga (saqlanmasa — qaytariladi).
- **Eski qaytarish krediti:** `receivableReconciliations` — qaror kutayotgan va qabul qilingan qarorlar; kredit kaliti qaytarishga bog‘langan.
- **Vaqt:** devor-soat + `zoneHistory`; instantlar ISO UTC (auth). `parseDate(value)` (zona bermasdan) tarix bo‘yicha o‘qiydi.
- **Sig‘im:** mashinasi bor WC — mashina yo‘laklari; mashinasiz WC — avvalgi `parallel` birliklar.
- **Chegaralar:** bu brauzerdagi demo — RBAC, idempotentlik va atomiklik `execute` darajasida; server tomonidagi tranzaksiya, autentifikatsiya va ko‘p foydalanuvchi bir vaqtdaligi yo‘q.
