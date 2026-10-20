# Login, rollar va Admin Panel

ZENIX Manufacturing’da backend yo‘q: akkauntlar, sessiya va biznes ma’lumotlari **shu brauzerning localStorage’ida** saqlanadi.
Shuning uchun quyidagi himoya **lokal / demo (MVP) darajasida**: halol foydalanuvchilar uchun kirish va huquqlarni tartibga soladi,
lekin brauzer xotirasini o‘zi tahrirlay oladigan odamni to‘xtatmaydi. Ochiq (public) production uchun pastdagi
“Backend’ga ko‘chirilishi shart” bo‘limiga qarang.

## Nima bor

| Qism | Qanday ishlaydi | Kod |
|---|---|---|
| Birinchi sozlash | Akkaunt yo‘q bo‘lsa ilova `/setup`ga yo‘naltiradi. Tanlangan xodim Super Admin bo‘ladi, parolni egasi o‘zi kiritadi. **Standart (default) parol yo‘q.** Sozlash faqat bir marta ishlaydi | `domain/auth.ts` `setupFirstAdmin`, `features/auth/pages/AuthPages.tsx` |
| Login | Telefon raqami (`+998 90 123 45 67`, `998901234567`, `901234567` — hammasi bitta `+998901234567`), login yoki e-pochta + parol. Noma’lum login ham bir xil vaqt va xabar oladi | `normalizeLogin`, `findAccount`, AppContext `login` |
| Parol saqlash | PBKDF2-SHA-256, 210 000 iteratsiya, har parolga 16 baytli tasodifiy tuz (WebCrypto). Ochiq parol hech qayerda saqlanmaydi; xeshlar biznes ma’lumotiga ham, backup’ga ham kirmaydi | `shared/lib/crypto.ts` |
| Parol siyosati | Kamida 8 belgi, harf + raqam (Admin Panel → Xavfsizlik’da 8–64) | `validatePassword`, `updatePolicy` |
| Bloklash | 5 ta xato urinish → 15 daqiqa qulf (login bo‘yicha, mavjud bo‘lmagan login uchun ham) | `recordFailure`, `lockState` |
| Sessiya | 12 soat; “Meni eslab qol” — 30 kun; eslab qolinmagan sessiya 30 daqiqa harakatsizlikda yopiladi. Akkaunt bloklansa, xodim arxivlansa yoki **parol boshqa joyda o‘zgartirilsa/tiklansa** sessiya tugaydi | `sessionProblem` |
| Parolni almashtirish | Profil menyusi → “Parolni o‘zgartirish”; administrator bergan vaqtinchalik parol bilan kirganda ilova avval yangi parol so‘raydi | `ChangePasswordForm`, `ForcePasswordChange` |
| Parolni unutish | Administrator Admin Panel → Foydalanuvchilar’da vaqtinchalik parol o‘rnatadi (foydalanuvchi keyingi kirishda almashtiradi). E-pochta/SMS orqali tiklash yo‘q — server kerak | `resetPassword` |
| Tablar | Login/logout va akkaunt o‘zgarishlari barcha ochiq tablarga darhol tarqaladi | AppContext `storage` hodisasi |
| Marshrutlar | Kirmagan foydalanuvchi har qanday manzildan `/login?next=…`ga, kirgandan keyin o‘sha manzilga qaytadi (yangilash va to‘g‘ridan-to‘g‘ri havola ham). Ruxsatsiz modul — “Ruxsat mavjud emas”; ruxsatsiz `?view=` — modulning ruxsat etilgan bo‘limi | `App.tsx` `RequireAuth`, `Guard`, `AppLayout` `useViewGuard` |
| Audit | Kirish hodisalari (login, xato, qulf, logout, sessiya tugashi, parol, akkaunt o‘zgarishlari) alohida jurnalda; biznes amallari `userId` bilan; Admin Panel → Faoliyat jurnali | `logAuth`, `logActivity` |

## Rollar

Sakkizta tizim roli (`domain/access.ts` `SYSTEM_ROLES`): Super Admin · Admin / Direktor · Ishlab chiqarish menejeri · Operator ·
Sifat nazoratchisi · Texnik xizmat muhandisi · Omborchi · Ta’minot va sotuv menejeri. Qo‘shimcha rollarni Admin Panel → Rollar’da yaratish/nusxalash mumkin.

Qoidalar **domain darajasida** tekshiriladi (tugmani yashirish yetarli emas): har bir domain amali `ACTION_RULES` bo‘yicha,
CRUD `entityRules` bo‘yicha, eksport `export` huquqi bo‘yicha, backup import/tiklash `settings.edit`, backup eksport `settings.export`.

- **Darajalar:** Super Admin › Admin › qolganlar. Har kim faqat o‘zidan past darajadagi foydalanuvchi va rollarni boshqaradi; o‘z rolini, o‘z ruxsatlarini o‘zgartira olmaydi; o‘zida yo‘q huquqni boshqaga bera olmaydi.
- **Oxirgi Super Admin** bloklanmaydi, o‘chirilmaydi, rolidan tushirilmaydi; backup’ni tiklash ham uni yo‘qotsa rad etiladi.
- **execute:** Operator ishni bajaradi (start/pauza/natija/scrap/scan/to‘xtash), lekin rejalashtirmaydi, bekor qilmaydi, yopmaydi.
- **Qamrov (scope):** `workcenter` — sex amallari faqat xodimning o‘z ish markazida; `branch` va `warehouse` — faqat xodim filialidagi ish markazlari va omborlar. Cheklov: `warehouse` qamrovi aniq bitta omborga emas, filialga bog‘lanadi; ro‘yxatlar filtrlanmaydi — amallar tekshiriladi.
- **Pul ma’lumotlari:** tannarx, marja, MO tannarxi, WC va xodim stavkalari, xarajat va profitability hisobotlari faqat `costs.view` bilan.
- **Vazifalarni ajratish:** ECO muallifi uni tasdiqlay olmaydi; PO’ni qoralamasiz (darhol tasdiqlangan) yaratish `purchases.approve` talab qiladi; Sozlamalar → “Xaridda ikki kishilik tasdiq” yoqilsa, chegara summasidan katta PO’ni uni yaratgan xodim tasdiqlay olmaydi.

## Egasining akkaunti (birinchi ishga tushirish)

Parol repozitoriyada, kodda yoki konfiguratsiyada **saqlanmaydi**. Akkaunt bir marta, odatdagi sozlash oynasi orqali yaratiladi:

1. Ilovani oching (`npm run dev` yoki joylashtirilgan versiya). Bu brauzerda akkaunt yo‘q bo‘lsa, “Birinchi sozlash” oynasi ochiladi.
2. **Xodim:** `Abdulloh Karimov · Management` (standart tanlangan).
3. **Telefon yoki login:** egasining telefon raqami (masalan `+998 90 123 45 67`).
4. **Parol** va **Parolni takrorlang:** egasi tanlagan parol.
5. “Super Admin yaratish” — akkaunt yaratiladi va tizimga kiriladi. Keyingi kirishlar `/login` orqali.

Ilova mavjud akkauntni hech qachon qayta yozmaydi va ishga tushganda parolni tiklamaydi. Parolni keyin Profil → “Parolni o‘zgartirish”da almashtirish mumkin.
Har bir brauzer (va har bir manzil/port) o‘z xotirasiga ega: boshqa kompyuterda yoki boshqa brauzerda ilova yana birinchi sozlashni so‘raydi.

## Cheklovlar (ochiq aytilgan)

- Brauzer xotirasini tahrirlay oladigan odam (DevTools) akkauntlar, rollar va ma’lumotlarni o‘zgartirishi, sessiyani soxtalashtirishi mumkin. Tekshiruvlar mijoz tomonida ishlaydi.
- Parol xeshlari shu brauzerda saqlanadi: xotiraga kirish huquqi bor odam ularni offline tanlab ko‘rishi mumkin (PBKDF2 buni sekinlashtiradi, to‘xtatmaydi).
- Bloklash va urinishlar hisobi ham brauzerda — xotirani tozalash ularni ham tozalaydi.
- Ikki tab bir necha millisekund ichida yozsa, oxirgi yozuv g‘olib bo‘lishi mumkin (BUG-14 cheklovi).
- Parolni e-pochta/SMS orqali tiklash, 2FA, qurilmalar ro‘yxati yo‘q.

## Backend’ga ko‘chirilishi shart (public production’dan oldin)

1. Akkauntlar, parol xeshlari (Argon2id yoki bcrypt), sessiyalar (HttpOnly, Secure, SameSite cookie) va bloklash — serverda.
2. `domain/access.ts` qoidalari va `domain/actions.ts` amallari — serverda (API har so‘rovda ruxsat va qamrovni tekshiradi; brauzerdagi tekshiruv faqat UX uchun qoladi).
3. Biznes ma’lumotlari — tranzaksiyali ma’lumotlar bazasida (bir vaqtdagi yozuvlar, versiya/optimistik qulf).
4. Audit jurnali — o‘zgarmas (append-only) server jadvali.
5. Parolni tiklash (e-pochta/SMS), ixtiyoriy 2FA, rate limiting server tomonida.

`domain/actions.ts` funksiyalari sof `(state, ctx, ...args)` ko‘rinishida — ularni API endpoint’lariga 1:1 ko‘chirish mumkin (`docs/ARCHITECTURE.md`).
