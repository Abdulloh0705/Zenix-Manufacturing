# ZENIX Manufacturing — design system

Yagona manba: `src/styles/tokens.css`. Komponentlar faqat tokenlardan foydalanadi.

**Vizual til ZENIX POS bilan bir oila:** iliq grafit neytrallar, bitta xira “steel” accent (`#4d6e9f`),
yumshoq keng soyalar, o‘rtacha radiuslar, ixcham boshqaruvlar. Manufacturing o‘ziga xos bitta
qo‘shimcha rang oladi — `--mfg` (sanoat teal) — faqat ishlab chiqarish faolligi uchun.

## Rang
| Token | Light | Dark | Ishlatilishi |
|---|---|---|---|
| `--bg` | `#f3f4f4` | `#111315` | sahifa foni (tekis, gradient yo‘q) |
| `--surface` | `#fbfbfa` | `#181a1d` | karta, jadval, sidebar |
| `--surface-2` / `-3` | `#f6f6f4` / `#eff1f2` | `#1e2125` / `#25292e` | jadval sarlavhasi, hover, footer |
| `--text` / `-2` / `-3` | `#202327` / `#4f555c` / `#6b7078` | `#eef0f2` / `#b9bec5` / `#969ba2` | matn (muted ≥ 4.5:1) |
| `--accent` | Fon bo‘yicha (default `#4d6e9f`) | `#8fa8cc` | primary tugma, aktiv holat, fokus |
| `--mfg` | `#336d69` | `#7fb5b0` | Jarayonda, work order, mashina, OEE, progress, Shop Floor START |
| `--success` / `--warning` / `--danger` | `#36704f` / `#85602f` / `#a04649` | `#7cab90` / `#d4aa73` / `#d78184` | holat |

Rang faqat badge, kichik indikator, progress, ikonka, muhim qiymat va aktiv boshqaruvlarda.
Butun kartani bo‘yash yo‘q. Barcha semantik matnlar o‘z soft fonida ≥ 4.5:1 (tekshirilgan).

## Tipografiya
| Token | Qiymat | Ishlatilishi |
|---|---|---|
| `--fs-2xs` | 11px (minimal chegara) | badge, eyebrow, meta |
| `--fs-xs` / `--fs-sm` / `--fs-md` | 12 / 13 / 14px | label, jadval, asosiy matn |
| `--fs-xl` / `--fs-kpi` / `--fs-title` | 18 / 20 / 22px | drawer sarlavhasi, KPI qiymati, sahifa sarlavhasi |
| `--fs-2xl` / `--fs-3xl` | 24 / 28px | Shop Floor operatsiya, katta raqamlar |

Og‘irlik: 500 / 600 / 620 (sarlavha) / 640. “Shrift o‘lchami” sozlamasi `--fs-scale` orqali; 11px’dan kichik matn yo‘q.

## Shakl, zichlik, soya
- Radius: `--r-sm` 8 · `--r-md` 10 (boshqaruv) · `--r-lg` 14 (karta, jadval) · `--r-xl` 18 (modal).
- Zichlik — ikki mustaqil sozlama (Sozlamalar → Ko‘rinish, telefon’da “Ko‘rinish” menyusi): **Interfeys** (`<html data-density>`: compact / standard / comfortable → `--control-h` 32/34/40, `--card-pad`, `--gap`, `--form-gap`, `--nav-h`) va **Jadval** (`data-table-density` → `--row-py` 4/8/13px, `--cell-px`, `--th-h` 32/38/44). Standart = avvalgi yagona zichlik. Shrift (`data-font-size`) alohida; 11px pastki chegara saqlanadi. Sensorli ekranda (`pointer:coarse`) har bir boshqaruv ≥ 36px, hamma joyda ≥ 24px (WCAG 2.5.8).
- Soya: `--shadow-card` (POS kabi keng va juda yengil), popover/modal uchun `--shadow-lg`. Blur faqat sticky topbar va overlay fonida.

## Shell
- **Sidebar**: POS guruh yorliqlari (Asosiy · Ishlab chiqarish · Ta’minot zanjiri · Nazorat · Boshqaruv), 28px ikonka plitkasi, aktiv qator — neytral fon + accent ikonka + chapda 3px chiziq. Yig‘ilganda guruh yorlig‘i ingichka chiziqqa aylanadi. ≤1024px — off-canvas drawer.
- **Brend**: grafit gradientli `ZX` belgisi + `ZENIX / MANUFACTURING`.
- **Topbar**: qidiruv (Ctrl K), ish konteksti (POS’dagi do‘kon tanlovi o‘rnida: filial · ombor · liniya), Theme, Fon, Valyuta, Fullscreen, bildirishnomalar, profil. ≤760px — Theme/Fon/Valyuta/Fullscreen bitta “Ko‘rinish” tugmasida.

## Naqshlar
- **Sahifa sarlavhasi**: 22px sarlavha + bitta qisqa kontekst qatori; amallar o‘ngda.
- **KPI**: bitta bog‘langan strip (`kpi-grid`, `cols-3/5/6`); bosiladigan KPI filtrlangan sahifaga olib boradi. 6 talik strip noutbukda ikonkasiz bir qatorda, ≤1280px da 3 × 2.
- **Filtr paneli**: `[Qidiruv] [Status · Ochiq] [Priority] [Work center] [Due] [Ko‘proq] … [Tozalash n]` — `FilterSelect` bo‘sh holatda neytral chip, qiymat tanlanganda accent; ikkinchi darajali filtrlar `MoreFilters` popoverida (chipda soni ko‘rinadi). Holat URL’da.
- **Jadval**: sarlavha sentence-case, `--surface-2` fon; asosiy qiymat qalin, meta muted; raqamlar o‘ngga; qator hover; bosiladigan qator drawer ochadi. ≤640px — qatorlar kartaga aylanadi, ≤480px da `priority:'low'` maydonlar yashiriladi (drawer’da bor).
- **Drawer**: ikonka plitkasi + eyebrow + sarlavha + kontekst → status badge’lar → POS pill tablar → ma’lumot → pastda amallar.
- **Diqqat ro‘yxati** (`attention-row`): bitta sirtda istisnolar — nuqta · matn · son · o‘tish.
- **Boshqaruv paneli**: bitta 12 ustunli `dash-grid` — 8 talik KPI strip (keng ekranda 1 qator, aks holda 4 × 2), so‘ng 8/4 · 6/6 · 8/4 · 6/6 qatorlar; bir qatordagi panellar bir xil balandlikda (`dash-panel`: bitta radius, padding, 28px sarlavha). Planshet/telefonda tartib CSS `order` bilan (KPI → Diqqat → Ishlab chiqarish → Material → Sifat/OEE → Sig‘im → Buyurtmalar → Faoliyat); jadvallar tor panelda container query orqali ikki qatorli satrga aylanadi. Barcha raqamlar `src/domain/dashboard.ts` dan; har bir bosiladigan element o‘sha raqamni ko‘rsatadigan filtrlangan sahifani ochadi (davr = `periodStart(N)`: bugun bilan birga oxirgi N kun).
- **Nazorat markazi** (Ishlab chiqarish → Umumiy): boshqaruv paneli bilan bir xil panel tili (`dash-panel`, `StatStrip`, `attention-row`), o‘z 12 ustunli `pc-grid`i — 4 talik KPI strip (Bugun ishlab chiqarildi · Faol buyurtmalar · O‘z vaqtida · Material yetishmovchiligi — boshqaruv panelidagi bilan bir xil raqamlar), so‘ng 8/4 (Buyurtmalar navbati · Diqqat) va 6/6 qatorlar (Ish markazlari · Tor joy, Reja · Material, Sifat/natija · Uskunalar, Tannarx/mehnat · Faoliyat). Navbat ustidagi chiplar (Riskda, Kechikkan, Bugun, Material, Jarayonda, Pauzada, Kritik) — Buyurtmalar sahifasining aynan shu filtrlari; status ostida buyurtma turgan operatsiya (`Bo‘yash · 1/2`). Ish markazlari: har bir markaz uchun bugungi yuklama chizig‘i (100% belgisi bilan), band / bo‘sh / navbat / hozirgi operatsiya (`pc-wc`). Tor joy: cheklovchi markaz + qolganlarining 7 kunlik `mini-days` qatori. “Diqqat” — faqat real istisnolar, kritiklari birinchi, har birida qisqa sabab (kim · qancha · qachondan). Har bir panel — size container: navbat jadvali panel kengligiga qarab jadval → ikki qatorli satr → ustma-ust satrga o‘tadi, 4–6 katakli strip tor panelda 2–3 ustunga o‘raladi; matn kesilmaydi (o‘raladi). Planshet: KPI → Diqqat + Tor joy → Navbat → Ish markazlari + Material → Reja + Sifat → Uskunalar + Tannarx → Faoliyat; telefon (CSS `order`): KPI → Diqqat → Buyurtmalar → Material → Reja → Sifat → Ish markazlari → Tor joy → Uskunalar → Tannarx → Faoliyat, navbat chiplari bitta suriladigan qatorda. Barcha raqamlar `src/domain/productionControl.ts` dan; har bir bosiladigan element shu raqamni ko‘rsatadigan filtrlangan sahifani ochadi. Holatlar: ma’lumot bo‘lmasa soxta nol emas, tushunarli bo‘sh holat (“Work center kiritilmagan”, “Natija va QC qaydi yo‘q”; nol faqat biror narsa ishlab chiqarilgan/tekshirilgan bo‘lsagina “yaxshi” rangda); har bir blok o‘z `PanelBoundary`sida — bitta blok xatosi qolganlarini to‘xtatmaydi, hisob qatlami xatosida sahifa ichida “Qayta hisoblash” holati chiqadi. Ma’lumot sinxron (lokal holat) bo‘lgani uchun skeleton yo‘q — yuklanish faqat route darajasida.
- **Planning**: MPS — bitta grid (mahsulot guruhlari, haftalar, footer’da sig‘im yuklamasi); MRP — talab → rezerv → available → yo‘lda → yetishmaydi → tavsiya → amal.
- **BOM**: chekinishli jadval (Komponent · Qty · UOM · Scrap · Tannarx · Available), sub-assembly joyida ochiladi.
- **Shop Floor**: operator ekrani — katta taymer, Reja/Tayyor/Scrap/Qolgan, mashina/operator/material/QC qatori, kuchli START · PAUZA · YAKUNLASH · NATIJA · SCRAP · SIFAT NAZORATI · STOP tugmalari.
- **Pul**: `money()` / `compactMoney()` va `<MoneyInput>` (qiymat har doim so‘mda saqlanadi, UZS/USD/RUB faqat ko‘rinish).
- **AI**: o‘ng chetdagi grafit tab (faqat Y bo‘yicha suriladi, joyi saqlanadi, ↑/↓ bilan) → sahifa ustidan ochiladigan panel; layout’da joy egallamaydi.

## Fon muhitlari
Emerald · Amber · Sapphire (default, ZENIX steel) · Violet · Crimson · Neutral · Ocean · Minimal — har biri light/dark juftligi (`<html data-family>` + `data-bg`).
Har bir oila o‘z accent rangi bilan sirt ierarxiyasini tekis bo‘yaydi: sahifa (`--bg`) eng ko‘p, `--surface-2/3` o‘rtacha, karta/raised eng kam, chiziqlar (`--line`) juda yengil — oilalar sezilarli farq qiladi, lekin tinch. Light doim light, dark — chuqur navy/charcoal asos. Minimal — tussiz oq / qora. Gradient, doira, blob, foto yo‘q. Eski saqlangan qiymatlar (`Graphite`, `emerald-night`, `ZENIX Steel` …) `normalizePrefs` orqali qo‘llab-quvvatlanadigan oilaga o‘tadi.

## Komponent qoidalari
- Tugmalar: `primary / secondary / soft / warning / danger / ghost / icon` — bir xil balandlik va radius; primary’da POS kabi yengil vertikal nur va rangli soya.
- Bir ustunli grid’lar `minmax(0,1fr)` — kontent sahifani kengaytirib yubormaydi.
- Chartlar: ≤24px ustun, hairline grid, legend ≥2 seriyada, hover/focus tooltip, ekran o‘quvchi uchun jadval; seriya ranglari POS’ning xira palitrasi.
