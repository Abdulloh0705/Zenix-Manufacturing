# ZENIX backend texnik loyihasi

**Holat:** tasdiqlangan arxitektura va dastlabki besh biznes siyosati asosidagi yakuniy loyiha hujjatlari. Backend kodi, PostgreSQL migratsiyasi, deploy va import bajarilmagan. Manba papka: C:/Users/user/Desktop/Proyects/ZENIX-Pro. Ish branchi: codex/zenix-completion; main branchga bevosita push qilinmaydi.

## Hujjatlar

| Hujjat | Mazmun |
| --- | --- |
| DECISIONS_AND_DELIVERY.md | Qabul qilingan FIN-01..04 va TEN-01 siyosatlari, o‘zgarmas talablar, modul egaligi, implementatsiya bosqichlari va exit gate |
| DATABASE_SCHEMA.md | Barcha frontend state kolleksiyalari, ichki satrlar, SaaS/platform va moliyaviy jadvallar uchun mantiqiy PostgreSQL sxemasi, FK/unique/RLS/invariantlar |
| ERD.md | Identity/SaaS, catalog/planning, ERP/finance va platforma ER diagrammalari hamda modul bog‘liqligi |
| API_CONTRACT.md | Versiyali tenant/platform API, autentifikatsiya, query, buyruq, finance, import/export, xato va idempotency kontrakti |
| COMMAND_MAPPING.md | Manba koddan tekshirilgan 102/102 DOMAIN_ACTIONS, payload signaturalari, permission, source line va API mapping |
| REQUEST_DTO_CATALOG.md | Mappingda ishlatiladigan mavjud TypeScript request turlari va wire-format qoidalari |
| PROVIDER_MAPPING.md | 102 buyruqdan tashqari AppProvider’dagi 56/56 holat/funksiya uchun server yoki UI-only mapping |
| FINANCIAL_POSTING.md | Subcontract qaytishi va narx farqi, provisional/final COGS, revers, GL/tax kengayishi, noaniq holat va qabul testlari |

## Tasdiqlangan yo‘nalish

NestJS + PostgreSQL; modulli monolit; umumiy sxemada tenant_id va kompozit FK; server sessiyasi/RBAC/scope/entitlement; stock va ledger uchun tranzaksiya; append-only audit va moliyaviy posting; qoidaviy AI va mavjud frontend dizaynini saqlash. Beshta qabul qilingan siyosat tafsiloti DECISIONS_AND_DELIVERY.md va FINANCIAL_POSTING.md ichida.

## Hali tanlanmagan tashqi va qonuniy parametrlar

Hosting regioni/provideri, byudjet va SLA, email/SMS, payment provider, saqlash muddati, mamlakatga xos rasmiy identifier tekshiruvi, soliq/GL konturi va tegishli hisobchi tasdig‘i alohida qaror bo‘ladi. Ular noma’lum bo‘lgani uchun hech qanday finance yoki kompaniya holati avtomatik tasdiqlanmaydi. Provider almashishi mumkin bo‘lgan interfeyslar yuqoridagi sxema/APIga joylangan.

## Implementatsiyadan oldingi tekshiruv

102 nom manba DOMAIN_ACTIONS bilan tartib bo‘yicha mos; 18 generic entity turi va 43 ManufacturingState maydoni sxemada qamralgan; 56 AppContextValue a’zosi mappingda bor. Har bir API handler tayyor bo‘lishi uchun test, tenant isolation, concurrent stock, moliyaviy conservation/reversal va frontend parity gate’dan o‘tishi shart. Bu hujjatlar dizayn spesifikatsiyasidir, ishga tushiriladigan backend yoki DB migration fayli emas.
