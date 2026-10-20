# ZENIX Manufacturing

ZENIX Manufacturing — ishlab chiqarish korxonalari uchun ERP/MRP/MES frontend: rejalashtirish, ishlab chiqarish buyurtmalari, ombor, sifat, uskunalar, xarid/sotuv, tannarx va hisobotlar. Backend hozircha yo‘q: biznes oqimlari sof domain action’lar va brauzer xotirasi (localStorage) orqali ishlaydi. Domain qatlam REST API’ga 1:1 ko‘chirishga tayyor.

> **Xavfsizlik eslatmasi.** Login, rollar va Admin Panel brauzer ichida ishlaydi (lokal / MVP darajasi). Ochiq internetga chiqarishdan oldin autentifikatsiya va ruxsatlar serverga ko‘chirilishi kerak — [docs/AUTH.md](docs/AUTH.md).

## Stack

- React 19 + TypeScript, Vite 7, React Router 7
- Plain CSS design system (`scripts/build-styles.mjs` → generated `src/styles.css`)
- Pure domain engine + actions (`src/domain`), localStorage adapter
- Node built-in test runner (esbuild bundle) — 186 domain, workflow, RBAC, auth va regression test
- WebCrypto (PBKDF2) — parol xeshlash; tashqi auth kutubxonasi yo‘q

## Buyruqlar

```bash
npm install
npm run dev          # styles + Vite dev server (http://localhost:5173)
npm run typecheck    # tsc -b
npm run test:domain  # domain/RBAC/auth testlari (esbuild → node:test)
npm run build        # styles + tsc -b + vite build → dist/
npm run preview      # dist/ ni lokal ko‘rish
```

`src/styles.css` generatsiya qilinadi (`npm run styles`): CSS manbalarini tahrirlang, generated faylni emas.

## Birinchi ishga tushirish

Akkaunt bo‘lmagan brauzerda ilova **Birinchi sozlash** oynasini ochadi: xodimni tanlang (standart — Abdulloh Karimov, Management), telefon raqami yoki loginni va parolni kiriting. Bu akkaunt Super Admin bo‘ladi. Standart parol yo‘q, parol repozitoriyada saqlanmaydi. Qolgan foydalanuvchilar Admin Panel → Foydalanuvchilar’da ochiladi. Batafsil: [docs/AUTH.md](docs/AUTH.md).

## Arxitektura

```text
src/
├─ app/providers/AppProvider/   useApp(): login/sessiya, RBAC + scope’li action runner, tablar sinxroni, UI preferences, toasts
├─ app/theme/                   Light/Dark/System + Mist/Night fon juftliklari (WCAG AA accent)
├─ data/mockData.ts             master data + action replay orqali yaratiladigan tarix (bugungi sanaga nisbatan)
├─ domain/
│  ├─ manufacturingEngine.ts    MPS, ko‘p bosqichli MRP, finite capacity, OEE, costing, traceability
│  ├─ actions.ts                barcha biznes amallari — sof (state, ctx, …) → {state, result}
│  ├─ access.ts                 rollar, ruxsat qoidalari, qamrov (scope), huquq oshirishdan himoya
│  ├─ auth.ts                   akkauntlar, parol siyosati, bloklash, sessiya, kirish jurnali
│  ├─ migrations.ts             saqlangan ma’lumot sxemasi versiyalari (v4: 8 rol, tannarx muzlatish)
│  ├─ dashboard.ts              Boshqaruv paneli o‘qish qatlami (raqam = manzil sahifa qatorlari)
│  ├─ productionControl.ts      Ishlab chiqarish → Umumiy nazorat markazi o‘qish qatlami
│  ├─ supplierMaterials.ts      supplier ↔ material shartlari, supplier taqqoslash, buyurtma taklifi (MOQ, birlik)
│  └─ insights.ts               ZENIX AI (qoidaga asoslangan, engine’dan)
├─ features/*/pages             14 modul sahifalari + auth (login, setup) + Admin Panel
├─ features/common              charts, attachments/audit panellari, barcode label, QC modal
├─ layout/AppLayout             Sidebar, Topbar, AiAssistant, shell.css
├─ shared/ui                    Overlay stack, Forms (useForm), ResourceTable, Layout, DataDisplay
├─ styles                       tokens.css, base.css, modules.css
└─ utils                        dates (lokal kalendar), format, export
```

Batafsil: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md), [docs/AUTH.md](docs/AUTH.md), [docs/BUG_REGISTRY.md](docs/BUG_REGISTRY.md) (barcha topilmalar va holati), [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md).

## Manufacturing qamrovi

- **Rejalashtirish:** tahrirlanadigan haftalik forecast → MPS (max(forecast, sotuv), lot o‘lchami) → ko‘p bosqichli MRP (sub-assembly netting, make-or-buy, safety stock) → bir tugma bilan MO / PO; finite capacity (kun × work center), Gantt (drag & drop), kalendar.
- **Ishlab chiqarish (MES):** MO lifecycle, BOM snapshot, rezerv yoki “Material kutilmoqda”, routing bog‘liqligiga rioya qiluvchi work orderlar, labor + machine time loglari, qisman natija (backflush, FIFO lot), scrap → NCR, yield, split / merge / backorder / unbuild, rework MO, Shop Floor terminali (jonli taymer, material scan, downtime).
- **Sifat:** QCP bo‘yicha avtomatik incoming / in-process / final tekshiruvlar, final QC majburiyati, NCR → CAPA (4 bosqich), rework/scrap, pareto.
- **Ombor:** yagona stock manbasi, lot/serial reyestri (FIFO iste’mol, expiry), transfer, cycle count, lokatsiyalar, Code 39 barcode scanner va label chop etish.
- **Supplier ↔ material:** har juftlik uchun supplier SKU, narx + valyuta, xarid birligi va konversiya, MOQ, lead time, faollik, oxirgi xarid; MO yetishmovchiligi (ombor → yo‘ldagi PO → xarid kerak, pegging) → supplier taqqoslash → oldindan to‘ldirilgan PO → qabul (ombor tanlash, takroriy qabuldan himoya) → incoming QC → rezerv.
- **Xarid / sotuv:** ko‘p qatorli PO/SO, qisman qabul (lot + QC), supplier ko‘rsatkichlari (vaqtida, sifat, lead time), MTS rezerv / MTO MO, yetkazish, RMA (qaytarish → inspection → qaror), subcontracting.
- **Uskuna:** downtime hodisalari (OEE availability), maintenance so‘rovi → buyurtma → downtime → xarajat, preventive rejalashtirish, repair.
- **PLM:** ECO → draft BOM (editor) → review → approve → apply; BOM diff, versiyalar, hujjatlar.
- **Tannarx:** reja vs amalda (material, labor, machine, overhead), earned-value variance, roll-up, profitability (haqiqiy COGS).
- **Traceability:** lot / serial / MO / SKU → sarflangan lotlar → supplier PO → sifat → tayyor lot → mijoz.
- **Boshqaruv:** login va birinchi sozlash, 8 ta tizim roli + maxsus rollar, Admin Panel (foydalanuvchilar, rollar va ruxsatlar matritsasi, faoliyat jurnali, xavfsizlik siyosati, tizim/backup), qamrov (ish markazi/filial), PO va ECO uchun vazifalarni ajratish, hujjat biriktirish, JSON backup eksport/import (zaxira bilan).

## Ko‘rinish

Topbar: **Theme** (Light/Dark/System) · **Fon** (Emerald, Amber, Sapphire, Violet, Crimson, Ocean, Neutral Night/Mist, Minimal) · **Valyuta** (UZS so‘m / USD $ / RUB ₽ — faqat ko‘rinish; ma’lumotlar so‘mda saqlanadi, konvertatsiya `src/utils/format.ts`da) · **Fullscreen**. Hammasi bitta global holatda va saqlanadi (fullscreen brauzer siyosati sabab qayta yuklanganda tiklanmaydi).
