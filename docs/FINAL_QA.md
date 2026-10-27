# ZENIX Manufacturing — Phase 5 yakuniy QA (2026-10-26)

Muhit: Windows 11, Node 22.23, npm 11. Baza: Phase 1–4 o‘zgarishlari (`claude/zenix-phase-4-ui-audit-0e8183` worktree’idan bayt-ma-bayt ko‘chirilgan, 292 test bilan tasdiqlangan). Hech narsa commit / push / deploy qilinmagan.

## Buyruqlar

| Tekshiruv | Natija |
|---|---|
| `npm run lint` | PASS — 0 xato, 0 ogohlantirish (ESLint 9 + typescript-eslint + react-hooks + jsx-a11y) |
| `npm run typecheck` | PASS — ilova + e2e loyihalari |
| `npm test` | PASS — domain 263/263, UI 46/46 (Phase 4: 253 + 39) |
| `TZ=UTC npm test`, `TZ=America/Los_Angeles npm run test:domain` | PASS — vaqt zonasiga bog‘liq emas (CI UTC’da) |
| `npm run build` | PASS — `npm run styles` + `tsc -b` + Vite; `src/styles.css` generatsiyasi bilan mos |
| `npm run test:e2e` (Chrome, desktop 1366×900 + Pixel 7) | PASS — 17/17, ketma-ket ikki marta (beqarorlik yo‘q) |
| Toza klon simulyatsiyasi (faqat git’ga kiradigan fayllar, `npm ci` → typecheck → lint → test → build) | PASS — CI qadamlari mahalliy holatsiz ishlaydi |

## Yangi testlar (har biri real invariant yoki ilgari qoplanmagan xatoni himoya qiladi)

- `tests/phase5.test.mjs` — bitta bog‘langan zanjir: sotuv → MRP (pegging) → MO → PO (takroriy tasdiq dublikat bermaydi) → qisman qabul → karantin (rezerv qilinmaydi) → incoming QC → rezerv → Shop Floor (+scrap, takroriy hisobot kaliti) → Final QC → yakun (ikkinchi marta rad) → tannarx muzlatilgan, OEE chekli → yetkazish (yetmagan qismi rad, mavjudi o‘tadi) → lot trace (PO lot → MO → sotuv) → qaytarish → qaror (bir marta) → yangi BOM revisiyasi (eski MO snapshot va tannarxi o‘zgarmaydi). Har qadamda: qoldiq = harakatlar, manfiy/NaN yo‘q, rezerv + karantin ≤ on hand, xomashyo rezervi = ochiq MO’lar ushlagani, havolalar butun, ID takrorlanmaydi, saqlangan holat qayta yuklashda tuzatish talab qilmaydi. Shuningdek: downtime → sig‘im, kritik amallar RBAC’i, legacy v3 migratsiyasi (idempotent), buzilgan yozuvlar, yangiroq versiya, tablar `conflict`, buzilgan sessiya/akkaunt, toza holatdan keyin Super Admin.
- `tests/ui/reliability.test.tsx` — tiklash rejimi (yopilishdagi flush ham yozmaydi), tuzatish xabari va Tiklash nusxalari, saqlash xatosi banneri (va tiklanishi), boshqa tab yangi saqlovi ustidan yozmaslik, buzilgan sessiya → login, mavjud bo‘lmagan `?id=`, RootBoundary (texnik matnsiz).
- `e2e/` — birinchi sozlash (Super Admin, parol har safar generatsiya), modullar va 404, mijoz yaratish + modal Escape/fokus qaytishi, qisman qabul → karantin → QC Passed, Shop Floor (job card, scrap, natija, sifat nazorati), global qidiruv → deep link, theme qayta yuklashdan keyin, operator uchun Xaridlar yopiq va “Yangi buyurtma” o‘chiq, o‘qilmagan ma’lumot → tiklash ekrani. Har testda sahifa/konsol xatosi bo‘lsa test yiqiladi.

## Brauzer tekshiruvi (dev server, haqiqiy Chrome)

Tiklash ekrani (desktop va 375 px, overflow yo‘q, saqlangan matn o‘zgarmagan); Tizim → xotira o‘lchagichi (ish ma’lumoti + jami); saqlash xatosi banneri telefon kengligida; safe-area qoidalari inset 0 bo‘lganda o‘lchamlarni o‘zgartirmaydi (topbar/brand 58 px desktop, 54 px telefon, shell padding 0). iOS qurilmasida (notch) tekshirish bu muhitda imkonsiz.

## Unumdorlik

Seed ma’lumotida o‘lchangan: `createInitialState` 0.7 ms, demo tarix 9 ms, `runMrp` (8 hafta) 0.3 ms, `productionControl` 0.9 ms, `scopedView` <0.01 ms — optimallashtirish uchun dalil yo‘q, kod o‘zgartirilmadi. Sahifalar allaqachon route bo‘yicha lazy. Asosiy chunk 380.2 → 390.0 kB (gzip 116.1 → 119.1 kB): saqlash/tuzatish qatlami, tiklash ekrani va RootBoundary.

## Qolgan cheklovlar

[BUG_REGISTRY.md → Phase 5](BUG_REGISTRY.md#phase-5-2026-10-26--arxitektura-ishonchlilik-saqlash-testlar-va-ci) “Kechiktirildi” bandida: UoM konversiyasi, serial genealogy, o‘chiq bildirishnoma turlari, runtime keyingi sana prognozi, supplier return/almashtirish, kun ichidagi sig‘im; localStorage tranzaksion emas; brauzerdagi auth xavfsizlik chegarasi emas (server kerak — [AUTH.md](AUTH.md)).
