# Login, rollar va Admin Panel

ZENIX Manufacturing’da backend yo‘q: akkauntlar, sessiya va biznes ma’lumotlari **shu brauzerning localStorage’ida** saqlanadi.
Shuning uchun quyidagi himoya **lokal / demo (MVP) darajasida**: halol foydalanuvchilar uchun kirish va huquqlarni tartibga soladi,
lekin brauzer xotirasini o‘zi tahrirlay oladigan odamni to‘xtatmaydi. Ochiq (public) production uchun pastdagi
“Backend’ga ko‘chirilishi shart” bo‘limiga qarang.

## Nima bor

| Qism | Qanday ishlaydi | Kod |
|---|---|---|
| Ro‘yxatdan o‘tish | Akkaunt yo‘q bo‘lsa ilova `/register`ga yo‘naltiradi (`/setup`, `/signup` ham shu yerga). Ism, kompaniya, login va parol kiritiladi; mavjud rahbar xodim profili Super Admin bo‘ladi. **Standart (default) parol yo‘q.** Faqat kompaniya egasi hali bo‘lmagan brauzerda ishlaydi: akkaunt mavjud, akkaunt saqlovi buzilgan yoki egasi avval bo‘lgan (Super Admin rolli xodim, `setup` hodisasi) bo‘lsa, forma ko‘rsatilmaydi va hech narsa yozilmaydi — xodimni administrator ochadi | `domain/auth.ts` `bootstrapBlocker`, `registrationProblem`, `setupFirstAdmin`, `RegisterPage` |
| Login | Telefon raqami (`+998 90 123 45 67`, `998901234567`, `901234567` — hammasi bitta `+998901234567`), login yoki e-pochta + parol. Noma’lum login ham bir xil vaqt va xabar oladi | `normalizeLogin`, `findAccount`, AppContext `login` |
| Parol saqlash | PBKDF2-SHA-256, 210 000 iteratsiya, har parolga 16 baytli tasodifiy tuz (WebCrypto). Ochiq parol hech qayerda saqlanmaydi; xeshlar biznes ma’lumotiga ham, backup’ga ham kirmaydi | `shared/lib/crypto.ts` |
| Parol siyosati | Kamida 8 belgi, harf + raqam (Admin Panel → Xavfsizlik’da 8–64) | `validatePassword`, `updatePolicy` |
| Bloklash | 5 ta xato urinish → 15 daqiqa qulf (login bo‘yicha, mavjud bo‘lmagan login uchun ham) | `recordFailure`, `lockState` |
| Sessiya | 12 soat; “Meni eslab qol” — 30 kun; eslab qolinmagan sessiya 30 daqiqa harakatsizlikda yopiladi. Akkaunt bloklansa, xodim arxivlansa yoki **parol boshqa joyda o‘zgartirilsa/tiklansa** sessiya tugaydi | `sessionProblem` |
| Parolni almashtirish | Profil menyusi → “Parolni o‘zgartirish”; administrator bergan vaqtinchalik parol bilan kirganda ilova avval yangi parol so‘raydi | `ChangePasswordForm`, `ForcePasswordChange` |
| Parolni unutish | Xodim: administrator Admin Panel → Foydalanuvchilar’da vaqtinchalik parol o‘rnatadi. Egasi: `/forgot-password` — tiklash kaliti yoki imzolangan chipta, pastga qarang. E-pochta/SMS orqali tiklash yo‘q — server kerak | `resetPassword`, `recoverPassword`, `ForgotPasswordPage` |
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

## Egasining akkaunti (ro‘yxatdan o‘tish)

Parol repozitoriyada, kodda yoki konfiguratsiyada **saqlanmaydi**. Akkaunt bir marta, odatdagi ro‘yxatdan o‘tish oynasi orqali yaratiladi:

1. Ilovani oching (`npm run dev` yoki joylashtirilgan versiya). Bu brauzerda akkaunt yo‘q bo‘lsa, “Ro‘yxatdan o‘tish” oynasi ochiladi.
2. **Ism-familiya** va **Kompaniya:** oldindan to‘ldirilgan qiymatlarni o‘zingiznikiga almashtiring. Ism rahbar xodim profiliga (`Management` bo‘limining birinchi faol xodimi), kompaniya Sozlamalarga yoziladi.
3. **Telefon yoki login:** egasining telefon raqami (masalan `+998 90 123 45 67`).
4. **Parol** va **Parolni takrorlang:** egasi tanlagan parol.
5. **Tiklash kaliti** bir marta ko‘rsatiladi: uni saqlang. Keyingi kirishlar `/login` orqali.

Ilova mavjud akkauntni hech qachon qayta yozmaydi va ishga tushganda parolni tiklamaydi. Parolni keyin Profil → “Parolni o‘zgartirish”da almashtirish mumkin.
Har bir brauzer (va har bir manzil/port) o‘z xotirasiga ega: boshqa kompyuterda, boshqa brauzerda yoki boshqa portda bu akkaunt **yo‘q**, ilova yana ro‘yxatdan o‘tishni so‘raydi. U yerda yaratilgan akkaunt umumiy (server) akkaunt emas.

## Parolni tiklash

Parol PBKDF2 xeshi sifatida saqlanadi, shuning uchun uni **ochib ko‘rib bo‘lmaydi** — faqat yangisini o‘rnatish mumkin. Tiklash faqat akkaunt parolini almashtiradi: rol, xodimlar, kompaniya va biznes ma’lumotlari o‘zgarmaydi, boshqa ochiq sessiyalar tugaydi. Hodisa Admin Panel → Faoliyat jurnalida ko‘rinadi.

| Kim | Yo‘l |
|---|---|
| Xodim | Administrator Admin Panel → Foydalanuvchilar’da vaqtinchalik parol beradi |
| Kaliti bor Super Admin | `/forgot-password` → “Tiklash kaliti”: login, kalit, yangi parol. Kalit bir martalik: ishlatilgach yangisi beriladi. 5 ta xato urinish 15 daqiqaga qulflaydi (kirish qulfidan alohida) |
| Kaliti yo‘q yoki yo‘qotgan Super Admin | `/forgot-password` → “Kalitim yo‘q”: egasining maxfiy kaliti bilan imzolangan bir martalik chipta. Maxfiy kalit brauzerda ham, repozitoriyada ham yo‘q; build faqat ochiq kalitni biladi. Sozlanmagan build’da bu yo‘l yopiq |

Chipta bitta login, sahifaning bitta ochilishi (har safar yangi kod) va 15 daqiqa uchun amal qiladi. Eski kod, boshqa login, muddati o‘tgan yoki soxta chipta rad etiladi; faol Super Admin bo‘lmagan akkaunt tiklanmaydi.

**Sozlash (bir marta):**

```bash
node scripts/auth-recovery.mjs keygen
```

Maxfiy kalit `~/.zenix/recovery-private.jwk` fayliga yoziladi (repozitoriya ichiga yozilmaydi). Chiqqan `VITE_RECOVERY_PUBLIC_KEY=…` qatorini `.env.local`ga (joylashtirilgan versiyada build sozlamalariga) qo‘shing va serverni qayta ishga tushiring yoki qayta build qiling. Maxfiy kalitni zaxiralang: u yo‘qolsa, yangi juftlik va qayta build kerak.

**Tiklash:** akkaunt turgan brauzer va manzilda “Kalitim yo‘q”ni oching, login kiriting, sahifadagi buyruqni loyiha papkasida bajaring, chiqqan chiptani va yangi parolni kiriting. Keyin yangi tiklash kaliti beriladi.

**Frontend-only cheklovi:** chipta ilova ichidagi begona foydalanuvchini to‘xtatadi, lekin brauzer xotirasini tahrirlay oladigan yoki ilova kodini brauzerda o‘zgartira oladigan odamni to‘xtatmaydi: u `zenix-auth-v1`ni to‘g‘ridan-to‘g‘ri o‘zgartirishi mumkin. Haqiqiy himoya faqat server tomonida bo‘ladi.

Akkaunt saqlovi o‘chirilgan yoki buzilgan bo‘lsa, ilova yangi egasini yaratmaydi va saqlovning ustidan yozmaydi. Bunday holatda ilova ichidan tiklash yo‘li yo‘q: `zenix-auth-v1`ning nusxasi kerak.

## Cheklovlar (ochiq aytilgan)

- Brauzer xotirasini tahrirlay oladigan odam (DevTools) akkauntlar, rollar va ma’lumotlarni o‘zgartirishi, sessiyani soxtalashtirishi mumkin. Tekshiruvlar mijoz tomonida ishlaydi.
- Parol xeshlari shu brauzerda saqlanadi: xotiraga kirish huquqi bor odam ularni offline tanlab ko‘rishi mumkin (PBKDF2 buni sekinlashtiradi, to‘xtatmaydi).
- Bloklash va urinishlar hisobi ham brauzerda — xotirani tozalash ularni ham tozalaydi.
- Ikki tab bir necha millisekund ichida yozsa, oxirgi yozuv g‘olib bo‘lishi mumkin (BUG-14 cheklovi).
- Parolni e-pochta/SMS orqali tiklash, 2FA, qurilmalar ro‘yxati yo‘q. Tiklash kaliti ham shu brauzerdagi akkaunt uchun ishlaydi.

## Backend’ga ko‘chirilishi shart (public production’dan oldin)

1. Akkauntlar, parol xeshlari (Argon2id yoki bcrypt), sessiyalar (HttpOnly, Secure, SameSite cookie) va bloklash — serverda.
2. `domain/access.ts` qoidalari va `domain/actions.ts` amallari — serverda (API har so‘rovda ruxsat va qamrovni tekshiradi; brauzerdagi tekshiruv faqat UX uchun qoladi).
3. Biznes ma’lumotlari — tranzaksiyali ma’lumotlar bazasida (bir vaqtdagi yozuvlar, versiya/optimistik qulf).
4. Audit jurnali — o‘zgarmas (append-only) server jadvali.
5. Parolni tiklash (e-pochta/SMS), ixtiyoriy 2FA, rate limiting server tomonida.

`domain/actions.ts` funksiyalari sof `(state, ctx, ...args)` ko‘rinishida — ularni API endpoint’lariga 1:1 ko‘chirish mumkin (`docs/ARCHITECTURE.md`).
