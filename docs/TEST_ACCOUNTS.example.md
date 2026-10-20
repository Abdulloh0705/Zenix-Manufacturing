# Lokal test akkauntlari (namuna)

Rollarni qo‘lda tekshirish uchun Super Admin Admin Panel → Foydalanuvchilar orqali har rolga bitta akkaunt ochadi.
Haqiqiy loginlar va parollar repozitoriyaga **kiritilmaydi**: ularni `docs/TEST_ACCOUNTS.local.md` faylida saqlang (`.gitignore`da).

| Rol | Login (namuna) | Parol |
|---|---|---|
| Super Admin | qa.superadmin | `TEST_ACCOUNTS.local.md`da |
| Admin / Direktor | qa.admin | 〃 |
| Ishlab chiqarish menejeri | qa.prodmgr | 〃 |
| Operator | qa.operator | 〃 |
| Sifat nazoratchisi | qa.quality | 〃 |
| Texnik xizmat muhandisi | qa.maint | 〃 |
| Omborchi | qa.ombor | 〃 |
| Ta’minot va sotuv menejeri | qa.supply | 〃 |

Akkauntlar faqat o‘sha brauzer va manzil (masalan `localhost:5199`) xotirasida yashaydi. Production muhitiga hech qachon ko‘chirmang.
