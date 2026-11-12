# ZENIX Manufacturing Pro

## Ishga tushirish

Node.js 22 bilan loyiha papkasida:

    npm ci
    npm run dev

Terminaldagi mahalliy manzilni oching. Birinchi ishga tushirishda kompaniya va biznes egasini yarating. Keyingi kirish uchun /login yoki /signin, ro‘yxatdan o‘tish uchun /register yoki /signup manzilidan foydalaning.

Biznes egasi Admin Panel → Foydalanuvchilar orqali xodim yaratadi, rol va ish qamrovini belgilaydi. Xodim vaqtinchalik parolni birinchi kirishda almashtiradi. Boshqaruv panelidagi Ish joyim bo‘limi operator, ishlab chiqarish menejeri, sifat nazoratchisi, muhandis, omborchi va ta’minot/sotuv menejeriga vazifasiga mos amallarni ko‘rsatadi.

## Ishlab chiqarish oqimi

1. Filial, ombor, ish markazi va uskunalarni sozlang.
2. Xomashyo, mahsulot, BOM va operatsiyalar ketma-ketligini kiriting.
3. MPS/MRP orqali talabni tekshiring, yetishmagan materialga xarid buyurtmasini yarating.
4. Ishlab chiqarish buyurtmasini tasdiqlang va materiallarni rezerv qiling.
5. Sexda operatsiyalarni bajaring, natija, brak va to‘xtashni qayd eting.
6. Sifat tekshiruvidan keyin tayyor partiya va tannarxni tekshiring.
7. Sotuv, yetkazish, qaytarish va hisobotlarni tegishli modullarda yuriting.

## Tekshiruv va joylash

    npm run check
    npm run build
    npm run preview

Vercel uchun vercel.json ichki sahifalarni to‘g‘ridan-to‘g‘ri ochish sozlamalarini o‘z ichiga oladi. Yig‘ilgan frontend dist papkasida chiqadi.

## Ma’lumot saqlanishi

Bu versiya brauzer xotirasida ishlaydigan ERP/MRP/MES ilovasi. Akkaunt va biznes ma’lumotlari boshqa qurilmaga avtomatik sinxronlanmaydi. Haqiqiy ko‘p foydalanuvchili production ishlatish uchun server autentifikatsiyasi, ma’lumotlar bazasi va server tomonida rol hamda kompaniya izolyatsiyasi kerak.

## Ushbu paket tarkibi

ChatGPT ZIP’dagi yangiroq dastur Desktop ZIP’dagi ishlab chiqarish modullari va yo‘llarini o‘z ichiga oladi. Paketda shu kod asos qilindi. Ushbu versiyada kirish havolalaridagi manzil parametrlari saqlanadi, operatsion rollar uchun tezkor ish joyi va Vercel marshrut sozlamalari qo‘shildi.

## Ushbu tuzatish

Yangi kompaniya, shu jumladan brauzerdagi birinchi kompaniya, bitta egasi, Asosiy filial va Asosiy ombor bilan ochiladi. Mahsulot, mijoz, buyurtma va boshqa ish yozuvlari bo‘sh bo‘ladi.

Avval saqlangan kompaniya ma’lumotlari yangilash paytida o‘chirilmaydi. Agar eski kompaniyangiz demo yozuvlari bilan yaratilgan bo‘lsa, toza ish joyi uchun akkauntdan chiqib, boshqa login va telefon bilan yangi kompaniya yarating.

Platform Admin → Kompaniyalar → kompaniya nomini oching. A’zolar jadvalida login, niqoblangan e-pochta, egasi yoki xodim ekani, a’zolik holati va qo‘shilgan sana ko‘rsatiladi. Mahalliy platforma shu brauzer profilida va shu ilova manzilida saqlangan kompaniyalarni ko‘rsatadi.
