# Phase 3.4 — final frontend readiness (2026-11-07)

**Status: PARTIAL.** Phase 3.3 dan qolgan P32-010 va P32-011 yopildi; Phase 3.2/3.3 P32 ro‘yxatida P0/P1/P2/P3 ochiq masala qolmadi. Frontend demo Phase 4 Platform Super Admin ishini boshlash uchun barqaror. Ishlab chiqarish SaaS release uchun N-07 subcontract xizmat xarajatining mahsulot tannarxiga kirmasligi va server xavfsizlik/tranzaksiya chegaralari hal etilishi kerak. AI javoblari va barcha ekran variantlari bo‘yicha to‘liq qo‘lda qabul testi ham o‘tkazilmadi.

## P32-010 — tablararo tenant va saqlanmagan formalar: VERIFIED

Sabab: `AppProvider` saqlangan sessiya o‘zgarganda `TenantProvider`ni tenant `key`i bilan qayta yaratardi; ochiq forma holati yo‘qolardi. `useForm` va alohida state saqlaydigan asosiy BOM, PO, receiving, supplier sourcing, sales delivery, material safety, forecast hamda maintenance editorlari dirty registrga ulanadi. Boshqa tab sessiya/tenantni o‘zgartirsa dirty forma DOMda saqlanadi, fon inert bo‘ladi va eski tenantda saqlash bloklanadi. Alertdialog aniq discard/reload talab qiladi. Clean forma yangi sessiyaga o‘tadi; activity timestamp o‘zgarishi switch deb qabul qilinmaydi. Sessiya yaroqsiz bo‘lsa dirty forma ham saqlanadi va eski sessiya yozuv qila olmaydi. Listenerlar cleanup bilan olib tashlanadi.

`tests/ui/tenant.test.tsx`: dirty va clean switch, o‘zgarmagan identitet, takror event, pending async account yaratish, stale va null sessiya, auth/SaaS/business yozuvlarining o‘zgarmasligi. `tests/ui/forms.test.tsx` shared/custom dirty marker reset va unmountni tekshiradi. Chrome `e2e/smoke.spec.ts`: haqiqiy ikkita tabda dirty customer modal, membership olib tashlash, ogohlantirish, explicit reload, tenant izolatsiyasi — desktop va mobile; 820 px tabletda modal/navigatsiya. E2E faqat alohida test browser profile/localStorage bilan ishladi.

Chegara: brauzer xotirasi va tablar orasidagi saqlash atomik tranzaksiya emas. Foydalanuvchi discard/reload qilsa forma kiritmasi ataylab bekor qilinadi; avval saqlangan ERP yozuvlari saqlanadi. Boshqa sayt/qurilma bilan sinxronlash server bosqichiga tegishli.

## P32-011 — Final QC va MO close oralig‘idagi COGS: VERIFIED

Sabab: Final QC tayyor LOTni sotishga ochardi, lekin `deliveredLotCost` faqat MO `costSnapshot` mavjud bo‘lganda qiymat qaytarardi. Endi **sotiladigan LOT uchun qiymat chegarasi Final QC release**: shu vaqtdagi qayd etilgan material issue, material return, mehnat, uskuna, energiya va overhead formulasi fizik LOTning `unitCost`/`costBasis`iga muzlatiladi. MO close o‘zining yakuniy snapshotini alohida saqlaydi, shipmentga yozilgan qiymatni o‘zgartirmaydi yoki qayta post qilmaydi. Har jo‘natish movementi asl LOT qiymatini muzlatadi; qaytarish shu movement qiymatini teskari yozadi. Rework LOTi manba va rework tannarxini bir marta qo‘shadi; scrap tayyor miqdor denominatoriga qo‘shilmaydi, shuning uchun yaroqli birlikka tushgan xarajat saqlanadi.

Ochiq MO qiymati `provisional`; eski input stavkasi yetishmasa `estimated`; isbotlanmagan eski jo‘natish `unavailable` va marja bo‘sh. Reports jadvali va eksport `costBasis`ni ko‘rsatadi. MO yopilgandan oldin sotilgan LOTning provisional belgisi tarixiy tan olish holatini saqlaydi; final snapshot farq qilsa u avtomatik ravishda eski savdoga yozilmaydi. Bunday tafovutni reconciliation oqimi keyingi moliyaviy dizaynda ko‘rib chiqishi kerak.

`tests/phase34.test.mjs`: QC oldidan tannarx yo‘q, QC release, material/mehnat/uskuna/energiya/overhead, MO yopilmasdan qisman savdo, close va ikkinchi savdo, no double QC/close, report oldin/keyin, eski noma’lum provenance. `tests/phase31.test.mjs`, `tests/workflows.test.mjs`, `tests/phase5.test.mjs` ko‘p LOT, rework, scrap, qisman return va inventar invariantlarini tekshiradi.

## RBAC, auth va multi-tenant demo

| Holat | Tekshiruv |
|---|---|
| VERIFIED | Business Owner register, tenant ichida xodim yaratish, vaqtinchalik parol va first-login change, rol/scope; UI `phase33`, auth, E2E setup va ikkinchi tenant register. |
| VERIFIED | Delegatsiyali manager faqat quyi rol va o‘z scope’i; o‘zini promote/permission grant qilish, platform obunasini o‘zgartirish rad etiladi (`access`, `phase33`, `saas`). |
| VERIFIED | Xodim login va modul/amal ruxsati; operator Purchases’ga kira olmaydi (auth/UI va Chrome E2E). |
| VERIFIED | Tenant A/B alohida state kalitlari, membership, rol va siyosat; backup import privilege ko‘tarmaydi, suspended subscription o‘zini qayta yoqmaydi (`tenant`, `phase33`, `saas`). |
| BACKEND REQUIRED | Browser localStorage’dagi auth, RBAC, tenant va subscription klient tomonidan o‘zgartirilishi mumkin; server enforce, DB isolation, audit va payment tasdig‘i `docs/BACKEND_CONTRACT.md` bo‘yicha kerak. |

## ERP funksional tekshiruv matritsasi

Bu holatlar ko‘rsatilgan **asosiy xatti-harakat** uchun; modulning barcha ekran/edge holatlari to‘liq tasdiqlandi degani emas.

| Sohа | Holat | Amaliy dalil / chegara |
|---|---|---|
| Production / Shop Floor | VERIFIED | MO status, rezerv, issue/backflush, scrap/rework, Final QC, close; `phase5`, `workflows`, `phase31`, Chrome Shop Floor. |
| Warehouse / LOT / serial | VERIFIED | Receipt, quarantine, transfer, FEFO, reservation, material return va reconciliation; `inventoryPhase3`, `phase5final`, `phase31`. |
| MRP / BOM | VERIFIED | Variant, branch shortage, expired stock, demand va finite capacity; `phase2`, `phase31`, `planning`, `phase5final`. |
| Purchases / payable | VERIFIED | Partial receipt, incoming QC, supplier return/replacement, idempotent payable; `phase3`, `phase31`, Chrome receipt/QC. |
| Sales / receivable | VERIFIED | Partial delivery, cancellation, return/credit, receivable; `phase1`, `phase4`, `phase31`, `receivables`. |
| Finance / COGS | PARTIALLY VERIFIED | Material, labor, machine, energy, overhead, LOT COGS, provisional report va return regression bor. N-07 subcontract service mahsulot tannarxiga kirmaydi; pre-close va close tannarxi farqini reconciliation qiluvchi oqim yo‘q. |
| Quality | VERIFIED | Incoming/in-process/Final, Hold, qayta tekshirish, scrap, qayta resolve rad; `bugRegistry`, `phase3`, `phase5`, Chrome incoming QC. |
| Maintenance / OEE | VERIFIED | Requested→planned→running→complete, downtime, preventive capacity, OEE real loglardan; maqsadli 14 testdan maintenance/OEE qismlari va Chrome equipment deep link. To‘liq maintenance UI transaction E2E alohida qilinmagan. |
| Dashboard / reports / export | VERIFIED | KPI’lar actionlardan qayta hisoblanadi; CSV BOM/UTF-8/formula safety, OOXML XLSX, filterlangan export; `dashboard`, `manufacturingEngine`, `phase4`, `tests/ui/receivables.test.tsx`. Barcha hisobotlar bilan qo‘lda reconciliation qilinmagan. |
| AI / notifications | PARTIALLY VERIFIED | Notification dedup, role visibility, category settings va deep link testlari bor (`phase5final`, UI). AI panel ochilishi tekshirilgan, javob mazmuni va barcha tenant kontekst savollari qabul testidan o‘tmagan. |
| Accessibility / responsive | PARTIALLY VERIFIED | Desktop/mobile Chrome smoke, 820 px tablet modal, keyboard search/Escape/focus, empty/error/recovery, theme persistence. Barcha ekran va assistive-technology kombinatsiyasi qo‘lda tekshirilmagan. |

## Data integrity

`phase5` va tegishli regressionlar stock movement/balance, LOT, rezerv, manfiy qoldiqni rad etish, materialni takror iste’mol qilmaslik, payable/receivable idempotency, COGS shipment per LOT, branch scope, invalid status va rad etilgan amal state’ni o‘zgartirmasligini tekshiradi. Testlar mavjud ishchi browser ma’lumotiga tegmadi; test profile alohida. Mavjud kod va Phase 1–3.3 saqlanmagan o‘zgarishlar saqlandi. Reset, commit, push, merge yoki deploy bajarilmadi.

## Validation (yakuniy run)

| Tekshiruv | Natija |
|---|---|
| P32-010 focused UI / Chrome | UI tenant va dirty registry regression 2/2; Chrome session switch va membership desktop+mobile 4/4 |
| P32-011 focused domain | 2/2 |
| Domain full | 417/417 |
| UI full | 77/77 |
| Chrome Playwright full | 27/27: setup 1, desktop 13, mobile 13 |
| Maintenance/KPI/export focused | 14/14 |
| TypeScript / ESLint / production build / `git diff --check` | PASS / PASS / PASS / PASS |

## Phase 4 prerequisites and next step

Phase 4 Platform Super Admin’ni mavjud frontend demo ustida alohida bosqichda boshlash mumkin. Platform rollari va tenant biznes rollari ajratilishi, serverdagi tenant/RBAC/abonement enforce, immutable audit, transactional stock/ledger, backup/recovery va subscription payment verification `docs/BACKEND_CONTRACT.md` asosida loyihalanishi kerak. Bundan oldin subcontract xizmat xarajatining mahsulotga kapitalizatsiya qoidasi va pre-close provisional COGS reconciliation qoidasini biznes egasi bilan aniq belgilash tavsiya etiladi. Phase 4 implementatsiyasi bu bosqichda bajarilmadi.

## Shu bosqichda o‘zgargan fayllar

- Sessiya va formalar: `src/app/providers/AppProvider/AppContext.tsx`, `src/shared/ui/Forms.tsx`, `src/styles/modules.css`, generatsiya qilingan `src/styles.css`.
- Mustaqil dirty editorlar: `src/features/products/components/BomEditor.tsx`, `src/features/materials/pages/Materials.tsx`, `src/features/production/pages/Production.tsx`, `src/features/purchases/pages/Purchases.tsx`, `src/features/purchases/components/Sourcing.tsx`, `src/features/sales/pages/Sales.tsx`, `src/features/equipment/pages/Equipment.tsx`.
- Tannarx va hisobot: `src/domain/actions.ts`, `src/domain/manufacturingEngine.ts`, `src/domain/profitability.ts`, `src/types/index.ts`, `src/features/reports/pages/Reports.tsx`.
- Regression: `tests/phase34.test.mjs`, `tests/ui/tenant.test.tsx`, `tests/ui/forms.test.tsx`, `e2e/smoke.spec.ts`.
- Hujjatlar: `docs/BUG_REGISTRY.md`, `docs/audits/PHASE34_FINAL_READINESS.md`.
