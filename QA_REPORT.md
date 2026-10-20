# ZENIX Manufacturing — global UI/UX va funksional audit (2026-09-27)

> Tarixiy hisobot. Joriy holat (login, rollar, Admin Panel, bug reyestri): [docs/RELEASE_REPORT.md](docs/RELEASE_REPORT.md) va [docs/BUG_REGISTRY.md](docs/BUG_REGISTRY.md).

## Tekshiruv natijalari (shu sessiyada, Windows, Node 22)

| Tekshiruv | Natija |
|---|---|
| `npm run styles` | PASS — 8 manba |
| `npm run typecheck` | PASS — 0 xato |
| `npm run test:domain` | PASS — 33/33 (13 engine + 20 workflow) |
| `npm run build` | PASS — ogohlantirishsiz; sahifalar lazy chunk (asosiy 446 kB, oldin 521 kB bitta chunk) |
| Brauzer audit (86 ko‘rinish + har ro‘yxatdagi birinchi yozuv drawer’i) | 0 “o‘lik” tugma · 0 nomsiz boshqaruv · 0 ta 11px’dan kichik matn · 0 console xato |
| Responsive (1920/1440/1280/1024/768/480/375, 18 sahifa) | gorizontal overflow yo‘q; AI dock ko‘rinadigan boshqaruvni yopmaydi |
| Overlay | nested Escape, focus trap/qaytish, popover modal ustida, scroll lock — tekshirildi |

Eslatma: brauzer paneli yashirin bo‘lgani sababli `requestAnimationFrame` to‘xtatilgan edi; fokus testlari sahifada rAF’ni `setTimeout` bilan almashtirib o‘tkazildi (faqat test uchun).

## Topilgan va tuzatilgan asosiy nosozliklar

1. **Select modal/drawer ichida ishlamasdi** — popover z-index 260, modal 420: ro‘yxat modal orqasida qolardi (barcha formalar). Yagona z-index shkalasi.
2. **Escape** Select ochiq turganda butun modalni, Confirm ochiq turganda Drawer’ni ham yopardi. Overlay stack: faqat eng yuqori qatlam.
3. **Ma’lumot buzilishi:** Mahsulot drawer’i narxni `0` deb ko‘rsatardi (Saqlash → narx 0); CAPA drawer’i mavjud root cause matnini bo‘sh qiymat bilan qayta yozardi.
4. **Noto‘g‘ri natija xabarlari:** muvaffaqiyatli amal “bajarilmadi” deb ko‘rsatilishi mumkin edi (natija `setState` updater ichidan o‘qilgan). Domain action’lar sof va sinxron.
5. **Domain xatolari:** scrap qilingan birliklar ham omborga kirim qilinardi; backorder boshlanmagan MO’ni miqdor=1, progress=100% qilardi; bekor qilish boshqa MO rezervini ham bo‘shatardi; muvaffaqiyatsiz final QC bilan yakunlash mumkin edi; OEE foizni soat deb hisoblardi; standart tannarx material narxidan past edi.
6. **Soxta boshqaruvlar** (toast chiqarib hech narsa qilmaydigan): Yangi BOM, material/mijoz/xodim/xarajat qatorlari, ruxsat tahrirlash, label chop etish, hujjat biriktirish, sana menyusi, Quality KPI’lari, qaytarishlar, Gantt vazifalari; qattiq kodlangan dashboard raqamlari/grafigi, downtime sabablari, check-in vaqtlari, serial raqamlar.
7. **Maintenance jadvali qatoriga bosish buyurtmani yakunlab yuborardi.**
8. **Jadvallar:** `JSON.stringify` qidiruv (yashirin ID/snapshot bo‘yicha moslik, ko‘rinadigan nom bo‘yicha emas), raqamlar matn sifatida saralanardi, filtr o‘zgarganda sahifa tiklanmasdi, qatorlar faqat double-click’da ochilardi.
9. **Tipografiya/kontrast:** ~3 700 matn 7–10.5px; muted matn 2.6:1, barcha 8 accent oq matn bilan AA’dan past.
10. **Mobil:** topbar’da Theme/Fon va hatto bildirishnomalar yashirilardi; grid “blowout” (Shop Floor 375px’da kengayib ketardi).
11. **i18n:** `uz-UZ` lokal ma’lumoti yetishmasligi sababli sana “M09 27, Sun” ko‘rinishida chiqardi.
12. **Import/eksport:** hisobotlar qaysi sahifada bo‘lmasin faqat MO’larni eksport qilardi.

## Qo‘shilgan imkoniyatlar

Work orderlar + labor/machine time, qisman natija va FIFO lot backflush, serial diapazonlar, tahrirlanadigan forecast + haftalik MPS, ko‘p bosqichli MRP (sub-assembly), kunlik finite capacity, downtime hodisalari, haqiqiy costing va variance, BOM editor + ECO draft oqimi + BOM diff, QCP asosida avtomatik tekshiruvlar, rework MO, RMA, MTS rezerv / SO bekor qilish, PO qoralama/yo‘lda/bekor, supplier ko‘rsatkichlari, lot reyestri, Code 39 label, hujjat biriktirish, RBAC matritsasi + demo foydalanuvchi, JSON backup, not-found sahifa, sahifa ErrorBoundary.

## Olib tashlangan

141 kB qatlamli legacy CSS (9 fayl, POS/Savdo qoldiqlari va `!important` override’lar) — 96 kB token asosidagi tizim bilan almashtirildi; soxta sana menyusi; statik/soxta raqamlar.

## Ma’lum cheklovlar

- Backend yo‘q; ma’lumot brauzer xotirasida (~5 MB). 256 KB’dan katta biriktirmalar faqat metadata sifatida saqlanadi.
- ZENIX AI — qoidaga asoslangan tahlil, LLM emas.
- Fullscreen holati brauzer siyosati sababli qayta yuklanganda tiklanmaydi.
- Autentifikatsiya yo‘q (demo foydalanuvchi almashtirish RBAC’ni tekshirish uchun).
- Storage kaliti v3 ga ko‘tarildi: eski v2 ma’lumotlaridan faqat ko‘rinish sozlamalari ko‘chiriladi; demo ma’lumot yangi modelda qayta yaratiladi.
