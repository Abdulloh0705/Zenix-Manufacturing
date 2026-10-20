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

## UI arxitekturasi

- **Overlay stack** (`shared/ui/Overlays.tsx`): Modal, Drawer, Popover, Select, mobil navigatsiya bitta stekda ro‘yxatdan o‘tadi. Faqat eng yuqori qatlam Escape, Tab (focus trap) va tashqi bosishni qabul qiladi; fokus ochuvchi elementga qaytadi; scroll lock `scrollbar-gutter: stable` bilan sakramaydi.
- **z-index shkalasi** (`styles/tokens.css`): sticky 10 · sidebar 30 · topbar 40 · AI dock 50 · mobil nav 60 · modal/drawer 100 · popover 200 · toast 300. Popover modal ichidan ochilishi mumkinligi sababli moddan yuqorida.
- **ResourceTable** (`shared/ui/ResourceTable.tsx`): ko‘rinadigan matn bo‘yicha qidiruv, raqamli/locale tartiblash (tri-state, `aria-sort`), filtr slotlari va “Tozalash”, sahifa o‘lchami, joriy natijani CSV eksport, bir marta bosib ochish, telefonda kartalar. Filtrlar URL’da (`useSearchParamState`), yozuv drawer’i `?id=` orqali ochiladi (deep link, global qidiruv, bildirishnomalar).
- **Shell**: `Sidebar` (collapse saqlanadi, hover/klaviatura flyout, mobil drawer + accordion, `inert`), `Topbar` (global qidiruv / Ctrl+K palette, kontekst, Theme·Fon·Valyuta·Fullscreen, bildirishnomalar, profil: parolni o‘zgartirish va chiqish), `AiAssistant` (o‘ng chetdagi ingichka tab, faqat Y bo‘yicha suriladi; o‘ngdan chiquvchi overlay panel — sahifa o‘lchami o‘zgarmaydi). Sidebar ≤1024px’da off-canvas drawer.
- **Sahifalar lazy yuklanadi** (`App.tsx`), har sahifa ErrorBoundary bilan.

## Uslublar

CSS manbalari (preprocessor yo‘q) `scripts/build-styles.mjs` orqali `src/styles.css`ga yig‘iladi: `tokens → base → controls → surfaces → data → overlays → shell → modules`. Generated faylni tahrirlamang.
