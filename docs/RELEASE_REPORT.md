# ZENIX Manufacturing — release hisoboti (2026-10-20)

Bu hisobot bug tuzatishlar, login/RBAC, Admin Panel va dizayn integratsiyasi bosqichining **haqiqiy** natijasini yozadi.
Har bir topilmaning holati va dalili: [BUG_REGISTRY.md](BUG_REGISTRY.md). Login va rollar: [AUTH.md](AUTH.md).

## Tekshiruv buyruqlari (oxirgi ishga tushirish, Windows, Node 22)

| Buyruq | Natija |
|---|---|
| `npm run typecheck` (`tsc -b`) | 0 xato |
| `npm run test:domain` | **186 / 186 o‘tdi**, 0 yiqildi |
| `npm run build` (styles + tsc + vite) | O‘tdi, ogohlantirishsiz: `vendor` 261 kB (gzip 83), ilova 294 kB (gzip 89), CSS 140 kB |
| Lint | Loyihada lint sozlanmagan (`package.json`da skript yo‘q) — ishga tushirilmadi |

Testlar fayllar bo‘yicha: workflows 55 · bugRegistry 39 · release 17 · manufacturingEngine 16 · supplierMaterials 16 · access 13 · productionControl 12 · auth 10 · reset 5 · dashboard 3.

**Eski kodga qarshi tekshiruv:** release testlari o‘zgarishdan oldingi manba nusxasiga (scratchpad, loyiha fayllari o‘zgartirilmagan) qarshi ishga tushirildi — 15 testdan 13 tasi yiqildi, ya’ni testlar haqiqiy nuqsonni ushlaydi. Qolgan 2 tasi BUG-14 yordamchisini tekshiradi va eski “oxirgi yozuv g‘olib” xatti-harakatini test ichida modellashtiradi. Oldingi bosqich testlari (bugRegistry 39) xuddi shu usulda tekshirilgan.

## Brauzerda tekshirilgan (dev server, bo‘sh xotirali alohida manzil `localhost:5198`)

- Birinchi sozlash: yangi dizayn, standart xodim Abdulloh Karimov; egasining telefon raqami va paroli bilan Super Admin yaratildi. Xotirada: login `+998…` ko‘rinishida, PBKDF2 xeshi (64 belgi, 210 000 iteratsiya), ochiq parol hech bir kalitda yo‘q.
- Chiqish → sessiya kaliti o‘chadi; kirmagan holda `/admin?view=users` → `/login?next=…`.
- Noto‘g‘ri parol → “Login yoki parol noto‘g‘ri”, parol maydoni tozalanadi; to‘g‘ri parol (telefon bo‘sh joylar bilan yozilgan) → `next` manziliga qaytadi. Kirish jurnali: logout → login_failed → login.
- Admin Panel → Foydalanuvchilar → Operator akkaunti yaratildi; Operator sifatida: sidebar faqat ruxsat etilgan modullar, `/admin` va `/settings?view=system` → “Ruxsat mavjud emas”, Mahsulotlar’da tannarx/marja ustunlari va CSV tugmasi yo‘q, Work center’da stavka ustuni yo‘q, `/production?view=nonsense` → Ishlab chiqarish + bitta xabar.
- Login sahifasi: 1440×900 Dark va Light, 375×812 mobil — gorizontal siljish yo‘q, brend paneli mobil’da ixcham qatorga aylanadi.
- Production build (`vite preview`, bo‘sh xotira): `/setup` ochiladi, konsolda xato yo‘q.
- Barcha tekshiruvlardan keyin konsolda xato yo‘q.

**Tekshirilmagan:** har 8 rol bilan to‘liq 86 ko‘rinishli UI auditi; System tema (OS sozlamasi emulyatsiyasi) login sahifasida; planshet o‘lchami; haqiqiy ikki tab bilan bir vaqtda yozish (domain darajasida test bilan tekshirilgan, UI’da emas).

## Bu bosqichda tuzatilgan (dalil — [BUG_REGISTRY.md](BUG_REGISTRY.md))

- **BUG-14** — har bir amal saqlangan oxirgi nusxani o‘qib davom etadi va darhol saqlaydi (`shared/lib/syncedState.ts`); backup tiklash va tozalash ham darhol saqlanadi.
- **BUG-07 / A-M2** — faoliyat domain’da kesilmaydi; 3000 dan eskisi arxiv kalitiga ko‘chadi (yozilmasa ma’lumotda qoladi); har yozuvda `userId`; audit jurnali arxivni ham ko‘rsatadi.
- **BUG-16** — OEE: smena asosidagi rejadagi vaqt, bo‘sh turish, ochiq to‘xtash, birlik bo‘yicha performance.
- **BUG-17** (qisman) — QCP chastotasi/namuna foizi avtomatik tekshiruvni boshqaradi.
- **N-07** (qisman) — subcontract qabuli karantin + kirish QC (Passed/Scrap).
- **N-14** (qisman) — MRP `needBy` talab sanasidan.
- **N-19 / B3-15** — unbuild MO snapshot’i va haqiqiy sarfdan, qayta tiklash % foydalanuvchidan.
- **N-20** — nazoratli qo‘shimcha material chiqimi.
- **B3-12** — noma’lum/ruxsatsiz `?view=` uchun qo‘riqchi.
- **A-H6** (qisman) — rol qamrovi domain darajasida.
- **A-M1** — pul ma’lumotlari `costs.view`ga bog‘landi (mahsulot, BOM, MO tannarxi, WC stavkasi, scrap yo‘qotishi, hisobotlar).
- **A-M6** — PO: qoralamani chetlab yaratish `approve` talab qiladi; ixtiyoriy ikki kishilik tasdiq siyosati.
- **Auth** — telefon raqami bilan kirish (bitta kanonik ko‘rinish), parol o‘zgarsa/tiklansa eski sessiyalar tugaydi.
- **Dizayn** — login, birinchi sozlash va majburiy parol almashtirish sahifalari split-screen ko‘rinishida, mavjud tokenlar, glass yuzalar, Light/Dark/System va fon oilalari bilan; ortiqcha matnlar qisqartirildi; sahifada tema almashtirgich.
- **Build** — vendor chunk ajratildi (500 kB ogohlantirishi yo‘qoldi).

Oldingi bosqichda (shu kun) tuzatilganlar — BUG-01…06, 05b, 08…11, 13, 15, 18, N-01…06, 08…10, 12, 13, 15…18, 21…26, B3-01…11, 13, 14 va login/RBAC/Admin Panel asosi — reyestrda.

## Ochiq yoki qisman qolganlar

| ID | Holat | Nima qoldi |
|---|---|---|
| N-11 | OPEN | Har bir serial alohida yozuv (genealogy) — ma’lumot modeli o‘zgarishi |
| N-07 | PARTIAL | Subcontract xizmat narxi mahsulot tannarxiga qo‘shilmaydi; qisman qabul yo‘q |
| N-14 | PARTIAL | Haftalarga bo‘lingan (time-phased) netting yo‘q |
| BUG-12 | PARTIAL | Umumiy UoM konversiya jadvali yo‘q |
| BUG-17 | PARTIAL | `timezone` sozlamasi qo‘llanmaydi |
| A-H6 | PARTIAL | `warehouse` qamrovi filial darajasida; ro‘yxatlar qamrov bo‘yicha filtrlanmaydi |
| A-M5 | PARTIAL | Theme/valyuta/kontekst — brauzer bo‘yicha umumiy |

## Login / RBAC — imkoniyat va cheklov

Imkoniyatlar: birinchi sozlash (standart parolsiz), login (telefon/login/e-pochta), PBKDF2 xesh, parol siyosati, bloklash, sessiya muddati va harakatsizlik, parol o‘zgarishida sessiyalarni bekor qilish, tablar sinxroni, kirish jurnali, 8 tizim roli + maxsus rollar, darajalar, oxirgi Super Admin himoyasi, domain darajasidagi ruxsat/qamrov/eksport tekshiruvlari, PO va ECO uchun vazifalarni ajratish, Admin Panel (foydalanuvchilar, rollar va matritsa, audit, xavfsizlik siyosati, tizim/backup).

**Cheklov:** hammasi brauzerda ishlaydi — DevTools orqali xotirani o‘zgartira oladigan odamni to‘xtatmaydi. Bu lokal / MVP darajasidagi himoya.

## Production blokerlari (ochiq internetdan oldin)

1. Autentifikatsiya, sessiya, ruxsat va qamrov tekshiruvi serverda bo‘lishi kerak ([AUTH.md](AUTH.md)).
2. Ma’lumotlar tranzaksiyali bazada (bir vaqtdagi yozuvlar, o‘zgarmas audit) — localStorage ~5 MB va qulfsiz.
3. Parolni e-pochta/SMS orqali tiklash yo‘q.

## Git

Repozitoriya: `https://github.com/Abdulloh0705/Zenix-Manufacturing.git`, `main`. Commit’ga kirmaydi: `node_modules/`, `dist/`, `.test-dist/`, `.claude/` (lokal yo‘llar), `*.local.md` (test parollari), `.env*`.
