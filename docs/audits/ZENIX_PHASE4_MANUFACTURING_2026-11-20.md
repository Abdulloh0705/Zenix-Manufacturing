# ZENIX Phase 4 — manufacturing simulation continuation (2026-11-20)

**Status: IN PROGRESS — not a Phase 4 sign-off.** This run continues the saved company of run `38407e97`
(`ZENIX Phase4 Factory 38407e97`, browser-only tenant `tenant-legacy-v3`). Every business step below was done
through the UI by the role that owns it, from the saved state `run-38407e97-final.storage.json`, by
`e2e/phase4Manufacturing.spec.ts` (opt-in project `phase4`). Passing evidence run: `manufacturing-14223c66`.
A first attempt (`manufacturing-add17128`) stopped at the CAPA close step on a test-locator error; its partial
evidence is kept and is not counted as a pass.

Repeat the run:

```
ZENIX_PHASE4=1 PW_CHANNEL=chrome PW_PORT=4191 \
PHASE4_STATE_PATH=docs/audits/evidence/phase4/run-38407e97-final.storage.json \
PHASE4_RUN_DIR=docs/audits/evidence/phase4/run-38407e97 \
npx playwright test e2e/phase4Manufacturing.spec.ts --project=phase4
```

Port 4191 is required: the saved browser state belongs to `http://localhost:4191`.

## Process results (run 14223c66)

| # | Process | Result | Evidence (record IDs from the final state) |
|---|---|---|---|
| 1 | Line + work center + equipment | PASS | line `pr-mwp180fl-t124c`, WC `wo-mwp180zy-w1i8d` (60 000/h), equipment `eq-mwp181il-9xua0` |
| 2 | BOM 0.5 kg/pc + routing on WC, activated | PASS | `bom-mwoy30sg-nbyeg` → Faol |
| 3 | MRP from customer demand | PASS | SO `so-mwp184er-hle8p` (100 pcs × 30 000) → Make 100, steel 50 kg |
| 4 | Production order | PASS | MO `mo-mwp1851a-3bm0z` (MO-261120-001), estimate 907 200 |
| 5 | Material availability + reservation | PASS | 50 kg reserved FEFO in w1 |
| 6 | Operator ↔ work center | PASS | operator `em-mwp187kw-lqoeq` bound to the WC; Purchases denied |
| 7 | Shop floor: start, lot scan issue, downtime, output, scrap | PASS | 95 good + 3 scrap (job card) + 2 scrap; 50 kg issued; downtime `dt-mwp18cv5-65mi6`; NCRs auto-opened |
| 8 | Final QC failed → rework MO → re-inspection → release | PASS | checks `qc-mwp18dpg-ouocg` Failed, `qc-mwp18lkr-ixbv2` / `qc-mwp18ovu-t7u02` Passed; rework MO `mo-mwp18grm-zpe6h` (5) |
| 9 | Finished goods into stock, LOT trace | PASS | one `Production +` of 95; LOT-P4-FG-38407E97-261120-1 (90) + RW lot (5); raw lots 35 + 15 kg upstream |
| 10 | Production cost / unit cost | PASS (material, overhead) · NOT VERIFIED (time-based) | actual 560 000, unit 5 895; see limits |
| 11 | Sales: reserve, partial shipment, payment, return | PASS | 95 shipped; payment 1 500 000 (local record only); return `ret-mwp18w92-4r7ev` → QC Scrap |
| 12 | NCR / CAPA with independent verification | PASS | NCR “scrap 3” closed; doer cannot verify; owner verified |
| 13 | Maintenance: request → approval → start → spare part → completion; PM plan | PASS (with finding P4-M-04) | request `ma-mwp195lq-vxjyr`, order `ma-mwp197jp-pjbsc`, expense `ex-mwp19cvt-vubjt` 160 000, PM `ma-mwp19e3r-8zzcc` |
| 14 | Reports and dashboard | PASS for the figures below · see limits | `REPORTS.json` |

## Independent reconciliation

| Figure | Independent calculation | App |
|---|---|---|
| MO estimate | 100×0.5×12 000 + 210 min×1 000 + 12 % | 907 200 |
| Material actually issued | 50 kg × 10 000 (PO lot price) | 500 000 |
| MO actual cost | (500 000 + 0 machine) × 1.12 | 560 000 |
| Unit cost | 560 000 / 95 good | 5 895 |
| Raw stock after production and the spare part | 75 + 25 − 50 − 1 | 49 kg (w1 24, secondary 25) |
| Finished goods | +95 produced, −95 shipped, +2 returned, −2 QC scrap | 0 |
| Customer ledger | 95×30 000 − 1 500 000 − 2×30 000 | 1 290 000 |
| Supplier ledger (unchanged from stage 3) | 1 000 000 − 200 000 | 800 000 |
| Maintenance expense | 150 000 work + 1 kg × 10 000 | 160 000 |
| Quality report | 4 Final checks: 2 Passed, 1 Failed, 1 Scrap (return) | pass rate 50 % |

## Fixes made in this run (each confirmed in the simulation first)

### P4-M-01 — Operator could not use the operator screen (blocking)
* **Symptom:** signed in as the Operator, every Shop Floor control (START, NATIJA, SCRAP, STOP, lot scan) was disabled.
* **Cause:** `src/features/production/pages/Production.tsx` gated the screen on `production.edit`. The Operator role holds `production.view/execute`, and the domain allows shop-floor actions with `execute` or `edit` (`PROD_RUN`, `src/domain/access.ts`; `tests/access.test.mjs` names this as the operator's job).
* **Fix:** the screen now uses `production.execute || production.edit`, the same rule the domain uses.
* **Test:** `tests/ui/shopFloorOperator.test.tsx`. It fails without the fix, which was checked by reverting the line temporarily.

### P4-M-02 — Lot scan bypassed the order's reservation
* **Symptom:** after a transfer, `LOT-…-2` existed in w1 (reserved for the MO) and in the secondary store. Scanning it issued 0.5 kg from the secondary store's free stock. The 50 kg reservation in w1 was left whole, so 0.5 kg stayed over-reserved until the MO closed.
* **Fix:** `recordMaterialScan` in `src/domain/actions.ts` prefers the lot record in the order's reservation store. This matches the documented rule "own reservation first".
* **Test:** `tests/phase4Manufacturing.test.mjs`. Rerun 14223c66 also confirms it: the issue came from w1 and the reservation went 50 → 49.5.

### P4-M-03 — Spare parts valued at standard price
* **Symptom:** a spare part issued from the same purchased lot was valued at 12 000/kg (standard), while production issues of that lot used 10 000/kg (PO price).
* **Fix:** `issueMaintenancePart` values each drawn lot with `issueUnitCost`, like production issues.
* **Test:** `tests/phase4Manufacturing.test.mjs`. Run 14223c66 shows the part at 10 000 and the expense at 160 000.

### P4-R-01 — Traceability report double-counted a lot split across stores
* **Symptom:** the upstream list showed `LOT-…-2` twice with 35.5 kg each (85.5 kg for 50 kg consumed).
* **Fix:** `src/features/reports/pages/Reports.tsx` sums consumption per lot record (item and store), not per lot code. Run 14223c66 shows 35 + 15.

## Findings re-verification (evidence and recommendation written before any fix)

UI reproduction ran on a copy of the final state of run `14223c66`, as owner, maintenance engineer and operator.
Values were read from the UI and browser storage. Controlled numbers come from `tests/phase4Metrics.test.mjs`, which uses fixed clock times and known rates.

### P4-M-04 — spare-part permission
* **Code:**
  * the domain rule `ACTION_RULES.issueMaintenancePart = [['equipment','edit'],['warehouse','edit']]` means *either* right is enough (`src/domain/access.ts`);
  * the UI rule `SparePartsPanel` uses `can('equipment','edit') && can('warehouse','edit')`, i.e. *both* rights (`src/features/equipment/components/SpareParts.tsx`).
* **UI reproduction:** the Maintenance Engineer planned and opened a corrective order (`MA-261120-02`). There was no "Qism berish" button. Role data:
  * engineer: `equipment` = all actions, `warehouse` = view only;
  * warehouse keeper: no `equipment` right at all, so it cannot open the maintenance order.
* **Expected vs actual:** either a maintenance or a warehouse person should be able to issue a part. Actually only Owner/Admin can, and the domain would accept a call from the engineer that the UI hides.
* **Business rule:** not documented. `QM-004` in `BUG_REGISTRY.md` describes the stock rules but not who may issue. Two valid models exist:
  * (a) the engineer issues parts against their own order (the domain "or" rule);
  * (b) separation of duties: only the storekeeper moves stock (the UI "and" rule is too strict for this too, because the storekeeper cannot see the order).
* **Recommendation:** the business has to choose. Then align the domain rule and the UI in one change, with a role test. **Not changed now.**

### P4-I-01 — inventory valuation basis
* **Code:** Reports → Ombor (`Reports.tsx`, `cost()`), Warehouse → Qoldiqlar (`Warehouse.tsx`) and the Materials drawer all value stock at `standardCost`. Production and maintenance issues use the lot or PO price (`issueUnitCost`).
* **UI reproduction:** Zaxira qiymati shows 588 000. That is 49 kg × 12 000 standard. Both remaining lots come from PO-261120-001 at 10 000/kg, so lot cost is 490 000.
* **Expected vs actual:** the screens are consistent with each other (all standard), but inconsistent with the cost of goods (lot cost). The 98 000 difference is purchase-price variance, which is not posted anywhere.
* **Business rule:** a costing-policy choice: standard cost with a purchase-price-variance account, versus FIFO or lot actual cost. `BUG_REGISTRY.md` already lists "supplier price variance" as open.
* **Recommendation:** decide the valuation method. If standard cost: post the purchase-price variance at receipt. If actual cost: value stock by lot. **Not changed now.**

### P4-U-01 — default branch in create forms
* **Code:**
  * `Admin.tsx` `CreateUserModal` uses `initialBranch = home branch ‖ branchOptions[0]`;
  * `Settings.tsx` new-line form uses `s.branches[0]`;
  * `createEntity` prepends new rows, so `[0]` is always the newest branch.
* **UI reproduction:** after adding "Phase4 East Branch", the new-user form defaulted to East, and the "Ish ombori" list for a warehouse keeper was empty. The new-line form also defaulted to East. The company default branch is `settings.defaultBranchId = b1`.
* **Expected vs actual:** a form default should not depend on creation order.
* **Business rule:** clear. The company already stores its default branch (`settings.defaultBranchId`, used by MRP and the empty-tenant scaffold). The actor's own home branch should still come first, as today.
* **Recommendation:** fall back to the company default branch (when the actor may use it) before "first in list". **Fix.**

### P4-Q-01 — OEE quality / performance ignore SCRAP-button scrap
* **Code:** `workCenterOee` counts job-card quantities (`goodQty` / `scrapQty`) when an operation has them. `recordScrap` (the SCRAP button) adds only to the order's `scrap`. It consumes a full BOM unit, like a unit lost at the end of the routing.
* **Controlled reproduction:** 10 pcs on one operation; job card 8 good + 1 scrap; 1 more unit scrapped with the SCRAP button.

  | Factor | Before the fix | Expected |
  |---|---|---|
  | Total units counted | 9 | 10 |
  | Performance | 45 % | 50 % |
  | Quality | 89 % | 80 % |

  Production yield and the order record already count 2 scrap. In the passing UI run, OEE had no data because run time was 0 minutes (see limits).
* **Business rule:** OEE quality = good / total units made at the work center. A unit scrapped while the order runs was made, so it must count. The order-level scrap that no job card holds belongs to the final operation, because that is where the domain books it (a full BOM unit consumed).
* **Recommendation:** in `workCenterOee`, add the order scrap that no job card holds to the final operation's count. **Fix.**

### Maintenance document codes
* **Code:**
  * request codes are built in the UI as `MR-${Date.now().toString().slice(-6)}` (`Equipment.tsx`), with no uniqueness check;
  * MA/PM codes come from the domain `nextCode(...,'MA'|'PM',now,2)`, i.e. `PREFIX-yymmdd-NN`;
  * seed requests use `MR-yymmdd-NN`.
* **UI reproduction:** codes `MR-406045` and `MR-252439` next to `MA-261120-01`, `MA-261120-02` and `PM-261120-01`.
* **Expected vs actual:** requests should follow the family pattern `MR-yymmdd-NN`, be unique, and be numbered by the domain like every other document. MA/PM already follow their 2-digit maintenance pattern, which is deliberate (`width=2`). That part is not a defect.
* **Recommendation:** the domain assigns `MR-yymmdd-NN` when a request is created without a code; the UI stops inventing one. **Fix.**

### Controlled cost / OEE / downtime check
Rates: operator 30 000/h, work center machine 60 000/h, energy 12 000/h, overhead 10 %, ideal cycle 6 min/pc, one 480-min shift.
Timeline: start 00:10, stop at +60, end of stop at +90 (resume), finish at +150.

| Metric | Expected | Result before the fix |
|---|---|---|
| Downtime duration | 30 min | 30 ✓ |
| Run time (`actualMin`) / labour minutes | 120 / 120 | 120 / 120 ✓ |
| Labour | 2 h × 30 000 = 60 000 | ✓ |
| Machine | 2 h × 60 000 = 120 000 | ✓ |
| Energy | 2 h × 12 000 = 24 000 | ✓ |
| Overhead | 10 % × (100 000 + 204 000) | ✓ |
| OEE availability | 120 / 480 = 25 % | 25 % ✓ |
| OEE performance | 6 × 10 / 120 = 50 % | **45 %** ✗ (P4-Q-01) |
| OEE quality | 8 / 10 = 80 % | **89 %** ✗ (P4-Q-01) |

## Finding status after re-verification

| Finding | Status | What changed / why not |
|---|---|---|
| P4-M-04 spare-part permission | **Not Fixed** → Fixed after the business decision, see below | The business rule is undefined (engineer issues vs. storekeeper issues). The domain "or" and UI "and" rules still disagree. Needs a decision, then one change for both. |
| P4-I-01 inventory valuation | **Not Fixed** → Fixed after the business decision, see below | A costing-policy decision (standard cost + purchase-price variance vs. lot/FIFO actual). Screens are consistent among themselves; the 98 000 purchase-price variance is not posted. |
| P4-U-01 default branch | **Fixed** | `Admin.tsx`, `Employees.tsx` and `Settings.tsx` (line form) default to the actor's home branch, then `settings.defaultBranchId`, then the first branch. Test: `tests/ui/defaultBranch.test.tsx`, which fails without the fix. |
| P4-Q-01 OEE quality / performance | **Fixed** | `workCenterOee` adds order scrap that no job card holds to the final operation. Tests: `tests/phase4Metrics.test.mjs` (before: 45 % / 89 %, after: 50 % / 80 %); job-card-only scrap is not double-counted. |
| Maintenance request codes | **Fixed** | The domain assigns `MR-yymmdd-NN` when no code is given; the UI no longer sends `MR-<timestamp>`; an explicit code (seed, import) is kept. Tests: `tests/phase4Metrics.test.mjs` and an assertion in `e2e/phase4Manufacturing.spec.ts`. MA/PM 2-digit codes are the intended maintenance pattern, not changed. |
| Labour / machine / energy / overhead cost | **Verified** (controlled data) | Exactly rate × running minutes; stop time excluded. |
| Downtime duration | **Verified** (controlled data) | end − start = 30 min, and the stop pauses the job card. |
| OEE availability | **Verified** (controlled data) | 120 / 480 = 25 %. |
| OEE in the real-time UI run | **Not Verifiable** | The UI simulation runs in seconds (0–1 min of run time), so live OEE and time costs are only checked with controlled data. |

Other low items:
* Creating equipment does not update `workCenter.machineIds`. Nothing reads that field today. Not changed.
* Existing `MR-<timestamp>` codes in saved data stay as they are. No migration was done.

## Business decisions implemented (2026-11-20)

The business confirmed one rule for each open finding. Only these two rules were implemented; nothing else was refactored.

### P4-M-04 — decision BOTH: maintenance and warehouse may issue spare parts
* **Rule now:** `MAINTENANCE_PART_RULES = [['equipment','edit'],['warehouse','edit']]` in `src/domain/access.ts`. Either right is enough. Issue and return use this one rule. The scope gate still applies: a branch role works in its own branch; a warehouse role works only in its own warehouse.
* **What was wrong:** the domain already accepted either right, but the UI required both. No role except Owner/Admin saw the button. The storekeeper also had no screen that showed maintenance orders.
* **Change:**
  * `SpareParts.tsx` shows "Qism berish" / "Qaytarish" by the same `MAINTENANCE_PART_RULES`.
  * New view **Ombor → Ehtiyot qism chiqimi** (`/warehouse?view=maintenance`, `Warehouse.tsx`, `navigation.ts`). It lists open maintenance orders (planned or in progress) and opens the same `SparePartsPanel`.
  * Both paths call the same domain command `issueMaintenancePart` with the same checks: free stock only, FEFO lots, lot-tracked parts only from lots, quantity checks, and an idempotency key.
* **Recorded on every issue:**
  * on the part: warehouse, item, quantity, lots, operator (`by`), time and key;
  * a stock movement `Maintenance Issue -` with the maintenance order code, lot and user name;
  * a maintenance history event and an activity log entry.
* **Cost:** parts are valued at lot cost. They join the maintenance expense once, at completion.
* **Not changed (open):** an engineer may issue against any open order in their branch, not only orders where they are the technician. "Own work order" was read as "within a maintenance work order". If the business wants it restricted to the assigned technician, that is a separate rule.

| Role | Rights | Result |
|---|---|---|
| Maintenance Engineer (role4) | equipment.edit, warehouse.view | **PASS** (domain, UI, E2E) |
| Warehouse Manager / Omborchi (role6) | warehouse.edit | **PASS** from the warehouse module (domain, UI, E2E) |
| Warehouse Operator, custom role with warehouse view/create only | — | **DENY**: no button; domain refuses "Rolingizda bu amal uchun ruxsat yo‘q" |
| Warehouse Operator with warehouse.edit (the Phase 4 operator account) | warehouse.edit | **PASS** (domain; E2E return) |
| Quality, Operator | neither | **DENY** (domain, UI, E2E) |
| Storekeeper of another warehouse or branch | scope | **DENY** (domain) |

### P4-I-01 — decision STANDARD: stock is valued at standard cost; lot cost and variance are shown beside it
* **Rule now:** the inventory book value stays `on hand × standardCost`. Totals are unchanged against the old formula (tested).
* **New helpers** in `src/domain/manufacturingEngine.ts`:
  * `stockValuation(balance)` values the same quantity at actual lot cost. Each lot in the store is valued at `issueUnitCost`, which is what production is charged. Stock that no lot covers is valued at standard.
  * `variance = actual − standard`. Negative means it was bought below standard.
  * `inventoryValuation(balances)` adds these up.
* **Screens:**
  * Warehouse → Qoldiqlar: KPI "Zaxira qiymati · standart" and a separate KPI "LOT tannarxida" with "farq …" under it; columns "Qiymat (standart)" and "Qiymat (LOT)", with the variance under the lot value. The first live run put the lot value and variance in the truncated sub-line of the standard KPI; that layout was changed so the variance is not hidden.
  * Warehouse → Omborlar cards.
  * Reports → Ombor: KPIs for standard, "LOT xarid tannarxida" and "Narx farqi (LOT − standart)", marked "Ko‘rsatiladi, hisobga o‘tkazilmaydi". The export has both values and the variance.
  * Materials drawer.
  * Dashboard and Costs show no inventory value, so they cannot conflict.
* **Production costing unchanged:** issues are still costed at the lot price (test: 10 000, not the standard 12 000).
* **Phase 4 example:** 49 kg × 12 000 = **588 000** standard; 49 kg × 10 000 = **490 000** lot cost; variance **−98 000**. Asserted in the domain test, the UI test, and on the live E2E screen.
* **Not done on purpose:** the variance is shown but not posted. There is no ledger or GL account for purchase price variance, and the instruction was not to invent an accounting mechanism. Recommendation for the backend: post PPV at goods receipt (receipt quantity × (PO price − standard)) to a dedicated account, then reconcile it with this report.

### Regression tests for the decisions
* **`tests/phase4Decisions.test.mjs`** (13 tests). It runs every call through `commandBlocker` and then the action, exactly as the app does. Covers:
  * the rule itself;
  * Engineer PASS with full audit trail;
  * Warehouse Manager PASS, plus returns from both sides;
  * Operator DENY without edit, PASS with edit;
  * unauthorised roles DENY;
  * scope DENY;
  * insufficient stock DENY for both sides;
  * duplicate key: one deduction and one ledger row;
  * parts from both sides join the cost once;
  * standard vs lot valuation and variance;
  * untracked stock;
  * totals equal the old standard formula;
  * production still costs at lot price.
* **`tests/ui/phase4Decisions.test.tsx`** (5 tests):
  * the engineer button issues the part;
  * the storekeeper issues from the warehouse view;
  * no button for a view-only warehouse operator or for quality;
  * stock table and KPI show standard, lot and variance;
  * the inventory report labels.
* **Checked against the old code:** with the old UI rule and without the lot column, UI tests 1, 2 and 4 fail. The files were restored and verified with `cmp`.
* **`e2e/phase4Manufacturing.spec.ts` step 10 now runs through the UI:**
  * the engineer issues 1 kg;
  * the Warehouse Manager issues 0.5 kg from the warehouse module;
  * the Warehouse Operator returns the 0.5 kg;
  * quality sees no button.
  * Step 11 checks the standard / lot / variance labels and the 588 000 / 490 000 / −98 000 KPI.

## Test separation and safety

* `playwright.config.ts`:
  * `phase4*.spec.ts` are ignored by the default `desktop` and `mobile` projects.
  * `ZENIX_PHASE4=1` adds a separate desktop `phase4` project for them.
* Continuation, Operations and Isolation now **skip** (instead of failing) when `PHASE4_STATE_PATH` / `PHASE4_RUN_DIR` are not set.
* Isolation no longer overwrites an existing `ISOLATION_SUMMARY.json`.
* Manufacturing writes each run to its own `manufacturing-<nonce>` folder.
* Passwords go only to the git-ignored `TEST_ACCOUNTS.md`; browser state goes only to git-ignored `*.storage.json`.
* `e2e/phase4.spec.ts` now expects the fixed branch, line and work-center behaviour. Fresh run: `run-ac19152f`.

## Checks (2026-11-20, after all fixes)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `git diff --check` | PASS |
| `npm run test:domain` | 518/518 (after the re-verification fixes) |
| `npm run test:ui` | 136/136 |
| `npx playwright test` (default: setup + desktop + mobile) | 65/65 |
| `phase4` project: manufacturing continuation | PASS (`manufacturing-14223c66`; again after the re-verification fixes: `manufacturing-c7b2df97`) |
| `phase4` project: fresh company | PASS (`run-ac19152f`, again `run-f25dcabc`); earlier failed attempt `run-b2dd3eb4` kept |
| `phase4` project without env | 3 skipped |
| `npx vite build` | PASS |

`npm run build` was not run, because its `styles` step rewrites the pre-existing modified `src/styles.css`. Its hash is unchanged by this run.

### Checks after the business decisions (P4-M-04 BOTH, P4-I-01 STANDARD)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `git diff --check` | PASS |
| `npm run test:domain` | 531/531 (+13 in `phase4Decisions.test.mjs`) |
| `npm run test:ui` | 141/141 (+5 in `phase4Decisions.test.tsx`) |
| `npx playwright test` (setup + desktop + mobile) | 65/65 |
| `phase4` manufacturing | **PASS** `manufacturing-0468064f` (final layout); also `manufacturing-d34cd364` (PASS, before the KPI layout change). Failed attempt `manufacturing-6be11d7a` is kept: every step passed, but the variance regex expected `98 000` while the browser prints `98,000`. Not counted as PASS. |
| `phase4` fresh company | PASS `run-286417ad` |
| `phase4` specs without env (with `PW_CHANNEL=chrome`) | 3 skipped |
| `npx vite build` | PASS; `src/styles.css` hash unchanged |

Remaining items (low):
* At 1366 px the stock table needs horizontal scroll to show the "Qiymat (LOT)" column. The KPIs above it always show both values.
* The purchase price variance is shown, not posted. It needs a ledger account in the backend.
* An engineer may issue parts to any open order in their branch, not only orders assigned to them (see P4-M-04 above).

## Limits — not verified

* **Time-based figures.** The UI simulation runs in seconds, so operation time is 0–1 min. In that run, labour, machine and energy cost, OEE availability and performance, and downtime minutes are not meaningful. Labour cost is also 0 there because no employee hourly rate is set; the app marks the costing "qisman taxminiy". The formulas themselves are verified with fixed clock times in `tests/phase4Metrics.test.mjs`.
* **Dashboard "reja 2".** This is the rework MO's quantity spread over its window. The main MO was produced before its planned start of 2026-11-21. This follows the current model and is not a defect.
* **No real external transactions.** Payments are local ledger entries only. This is still a browser-storage demo with no server (see the canonical audit).
* **Mobile not covered.** The phase4 project runs on desktop only. Mobile coverage comes from the default suite.

## Independent Codex Verification — 2026-11-20

**Status: PASS WITH LIMITATIONS.** This section is an independent check of the P4-M-04 and P4-I-01 decisions and the current working tree. It supersedes the earlier test totals above; it does not certify backend security or production readiness.

### Repository and change inventory

The canonical root was `C:\Users\user\Desktop\Proyects\ZENIX-Pro`, branch `codex/zenix-completion`, HEAD `deb1f0d3ff466a1b44984e8af17c09f6ea3b556b` at takeover and at completion. The tree was already dirty. A complete final pre-report `git status --porcelain=v1 --untracked-files=all` snapshot is in `evidence/phase4/independent-codex-2026-11-20/GIT_STATUS.txt` (51 modified tracked paths and 459 untracked files then, mostly audit evidence). An earlier conversation snapshot had HEAD `9d8740024c903367fa9638a551cc2cdefa3fca64`; the intervening documentation commit was already present when this independent review began. I did not make or push a commit.

All ten paths Claude named were present with changes or were new in the working tree: `src/domain/access.ts`, `src/domain/manufacturingEngine.ts`, `src/features/equipment/components/SpareParts.tsx`, `src/features/warehouse/pages/Warehouse.tsx`, `src/features/reports/pages/Reports.tsx`, `src/features/materials/pages/Materials.tsx`, `src/routes/navigation.ts`, `tests/phase4Decisions.test.mjs`, `tests/ui/phase4Decisions.test.tsx`, and `e2e/phase4Manufacturing.spec.ts`. Relevant additional changed paths included `src/domain/actions.ts`, `src/types/index.ts`, `src/features/production/pages/Production.tsx`, `src/features/settings/pages/Settings.tsx`, `src/features/admin/pages/Admin.tsx`, `src/features/employees/pages/Employees.tsx`, `src/features/equipment/pages/Equipment.tsx`, `e2e/sitesWorkCenters.spec.ts`, `tests/phase4Manufacturing.test.mjs`, `tests/phase4Metrics.test.mjs`, `tests/sitePermissions.test.mjs`, `tests/ui/defaultBranch.test.tsx`, `tests/ui/shopFloorOperator.test.tsx`, and `tests/ui/sitesWorkCenters.test.tsx`. The complete status snapshot records the remaining unrelated paths. Because all these edits were uncommitted and mixed with earlier work, Git cannot establish which person authored each line.

### Findings and corrections

| ID | Severity | Independent evidence | Status and correction |
|---|---|---|---|
| P4-M-04, mixed-cost partial return | High (cost accuracy) | Issuing two LOT units at 100 and 200, then returning the 100 unit, left the old average-cost calculation at 150 rather than 200. The new regression failed `150 !== 200` before the fix. | Fixed. Freeze cost on each issued allocation, calculate remaining cost from its actual LOT allocation, and use that calculation in the UI and completion expense. Legacy parts without allocation costs still use their saved average. Regression now checks 300 issued, 200 remaining, and a 1,200 expense after 1,000 work cost. |
| P4-I-01, premature balance rounding | Medium | Two 0.1 kg balances at 123.45 UZS/kg produced 24.70 in the new aggregate helper, while the former sum-of-stock calculation is 24.69. The new regression failed `24.7 !== 24.69` before the fix. | Fixed. Keep precision per balance and round only the aggregate returned by `inventoryValuation`. Independent domain cases also cover empty stock, zero cost, missing LOT cost, mixed LOTs and two warehouses. |
| P4-I-01, CSV row precision | Medium | For the same fractional stock, whole-UZS rounding of each CSV row yielded 12 + 12 = 24, inconsistent with the 24.69 standard total. | Fixed. Export the inventory row values at calculation precision. A new browser regression downloads the CSV and verifies both standard and LOT columns sum to 24.69. Normal whole-UZS records remain unchanged. |
| P4-M-04, engineer assignment boundary | Business decision | `equipment.edit` plus branch scope permits an engineer to issue to any open maintenance order in that branch; no assigned-technician condition exists. | Open. Decide whether engineers may issue to all branch orders or only orders assigned to them (with an explicit delegation path). Keep the current documented branch rule until the business chooses; do not invent a new role model. |

The corrections made during this independent review are limited to `src/domain/actions.ts`, `src/domain/manufacturingEngine.ts`, `src/features/reports/pages/Reports.tsx`, `src/features/equipment/components/SpareParts.tsx`, `src/types/index.ts`, the existing `tests/phase4Decisions.test.mjs` expectation, and new `tests/phase4Independent.test.mjs` and `e2e/phase4Independent.spec.ts`. This report and the new independent evidence directory were also updated or added. The existing Liquid Glass components and navigation structure were retained.

### P4-M-04 role and scope verification

| Actor | Domain / UI evidence | Result |
|---|---|---|
| Maintenance Engineer | `equipment.edit` OR rule; `phase4Decisions` domain case, UI button/click case, and `manufacturing-dc5bc0fe` browser run | May issue in permitted branch; stock, LOT, movement, order history, activity and cost recorded. |
| Warehouse Manager | `warehouse.edit` OR rule; warehouse route and same domain/UI/browser checks | May issue through Ombor → Ehtiyot qism chiqimi. |
| Warehouse Operator with `warehouse.edit` | Domain role case | May issue in own warehouse. The browser run exercised a return by a warehouse operator. |
| Read-only Warehouse Operator | Domain denial and absent UI issue button | Cannot issue. |
| Quality Inspector and unrelated Operator | Domain denial; Quality UI denial | Cannot issue. |
| Other-branch / other-warehouse keeper | Domain scope cases | Cannot issue outside branch or home warehouse. |

The same `MAINTENANCE_PART_RULES` is used by command authorization and the spare-parts UI. Domain cases also verify insufficient stock, a required valid LOT for LOT-tracked material, duplicate issue keys (one deduction), return keys, movements and maintenance expense posted once. Browser-side checks are workflow behavior, not server-side authorization.

### P4-I-01 independent reconciliation

| Case | Independent arithmetic | Observed result |
|---|---|---|
| Saved steel stock after production and maintenance | 24 kg in w1 + 25 kg in the second warehouse = 49 kg; 49 × 12,000 standard = 588,000; 49 × 10,000 PO LOT price = 490,000; actual − standard = −98,000 UZS | Reports KPI, Warehouse stock/cards, Materials drawer and two exported CSV rows agree; `VALUATION_VERIFICATION.json` and four screenshots are in `evidence/phase4/independent-codex-2026-11-20/`. |
| Fractional stock | 0.1 × 123.45 + 0.1 × 123.45 = 24.69 UZS | Domain total and downloaded CSV row sum are 24.69 after the fixes. |
| Mixed LOTs and untracked stock | w1: 2×10 + 1×15 + 2×12 = 59 actual versus 60 standard; w2: 3×8 = 24 actual versus 36 standard; zero-cost material = 0 | 83 actual, 96 standard, −13 variance; empty inventory = 0. |
| Production issue | 50 kg × 10,000 PO price | 500,000 actual material cost in `manufacturing-dc5bc0fe`, while standard stock remains the primary inventory basis. |

No currency conversion or purchase-price-variance ledger posting was introduced. UI currency labels still format amounts to whole UZS; the exported inventory rows retain calculation precision so fractional quantities can be reconciled. A backend ledger account and posting rule are required before purchase-price variance can be treated as accounting data.

### Verification results

| Check | Final result | Evidence / qualification |
|---|---|---|
| Targeted P4 decisions | 13/13 PASS | `node --test tests/phase4Decisions.test.mjs` |
| New independent domain regressions | 3/3 PASS | `node --test tests/phase4Independent.test.mjs`; two failed against the pre-fix implementations. |
| Full domain | 534/534 PASS | `npm run test:domain` after the fixes. |
| Full UI | 141/141 PASS | `npm run test:ui` after the fixes; existing React `act(...)` warnings remain non-failing. |
| TypeScript | PASS | `npm run typecheck`; an intermediate test-only type annotation error was corrected before this final run. |
| ESLint | PASS | `npm run lint`. |
| Production build | PASS | `npx vite build` (134 modules). `npm run build` invokes `npm run styles`, which rewrites the pre-existing modified `src/styles.css`, so it was not used. |
| Standard browser suite | 65/65 PASS | Setup 1, desktop 32, mobile 32; final isolated run after the CSV fix on port 4201, auth/output under ignored `test-results/`. |
| Phase 4 manufacturing | 1/1 PASS | New evidence `evidence/phase4/run-38407e97/manufacturing-dc5bc0fe/`; run preceded only the later CSV precision change. |
| Phase 4 fresh company | 1/1 PASS | New unique evidence `evidence/phase4/run-4dc1df38/`; run preceded only the later CSV precision change. |
| Independent valuation browser checks | 2/2 PASS | `e2e/phase4Independent.spec.ts`, after the CSV fix; saved-company UI/CSV and synthetic fractional CSV. An intermediate run failed because its saved 30-minute test session expired; the final test refreshes only its in-memory context. |
| `git diff --check` | PASS | No whitespace errors; Git reported only existing LF/CRLF notices. |

The final counted suites exercised 534 domain + 141 UI + 65 standard browser + 1 manufacturing + 1 fresh-company + 2 independent browser = **744 tests**. The 13 and 3 targeted domain checks are subsets of the 534, not additional tests. Intermediate failing runs are not counted as passes.

### Evidence integrity and limits

`src/styles.css` remained SHA-256 `D2C68370…38E349`, `e2e/.auth/admin.json` remained `ADEB442A…8EB20`, and the saved manufacturing storage file remained `AD077610…7EED00` during this independent review. Earlier evidence samples also retained their hashes: `manufacturing-0468064f/REPORTS.json` `7A82F50C…5C45` and `run-286417ad/02-new-company-dashboard.png` `77B81AD4…9369`. The auth file had a different hash in an earlier conversation snapshot, before this independent takeover; its cause cannot be assigned from the available evidence. New runs used isolated auth/output paths and unique evidence directories. Passwords and browser storage stayed in ignored local files and were not added to Git.

Remaining limits: the engineer-assignment business decision above; browser-controlled identity, roles, tenant data, subscriptions and persistence do not provide backend security; no server ledger posts the variance; Phase 4's dedicated manufacturing/fresh-company project uses desktop, while mobile coverage is from the standard suite. The Warehouse stock table may require horizontal scrolling at 1366 px to see the LOT column; its KPI remains visible. Time-derived labour, energy, OEE and downtime values from the rapid browser simulation are not real-world measurements. No commit, push, merge or PR was performed.

## Final business rules implementation — 2026-11-20

**Status: PASS WITH LIMITATIONS.** This section supersedes the open engineer-assignment decision and test totals above. It records frontend behavior only; it does not establish backend authorization, cross-client transaction safety, or production readiness.

### Scope and implementation

The canonical repository remained on `codex/zenix-completion` at HEAD `deb1f0d3ff466a1b44984e8af17c09f6ea3b556b`. The working tree was already modified and contained untracked audit files. No reset, clean, stash, commit, push, or merge was performed.

**P4-M-04 — maintenance assignment.** A Maintenance Engineer may issue or return spare parts only for a maintenance order whose current `technicianId` is that employee's ID. The shared command gate checks role, current assignment, branch, and warehouse scope. The direct domain actions call the gate too, and the spare-parts UI shows actions only to permitted actors. Submission rechecks the latest state, so reassignment after opening a modal denies the issue without changing stock, cost, order history, movements, or activity. Authorized Warehouse Manager and Warehouse Operator permissions continue through `warehouse.edit` and existing warehouse scope. Read-only and unrelated roles remain denied. Browser-local roles are not a server security boundary.

**Inter-warehouse transfer.** The existing two-step dispatch/receive/return and immediate transfer flows were extended; no parallel transfer feature was added. The form selects source stock/warehouse, destination, quantity, optional location and LOT through the existing stock planner, and now requires a reason of at least five characters. It displays the current session employee and source/destination branches and warehouses. The domain requires the reason and checks permission for both warehouses at dispatch or immediate transfer, destination at receipt, and both for return. Same-warehouse, insufficient available stock, reserved/quarantined/expired or inconsistent LOT stock, and out-of-scope cross-branch routes are refused. A cross-branch route works only when the existing role scope grants both warehouses; it is not silently enabled. Both flows retain LOT provenance and cost snapshots. The UI supplies an idempotency key; duplicate dispatch/immediate submissions are refused, and repeated receipt keys do not book a second arrival. A failed validation returns the original state. Dispatch moves stock into incoming transit; receipt books only the outstanding amount; a return restores only the in-transit remainder with a mandatory return reason. Immediate transfer books one decrease and one increase in one domain result.

New transfers have a structured history record with reference, item, quantity, mode/status, initiating employee and timestamp, source/destination warehouse and branch snapshots, mandatory reason, LOT lines with source record/cost, receipt or return employee and timestamp, quantities, and return reason. Stock movements and activity also include the transfer reason. Transfer details show these fields and the chronological event history. Completed records have no edit action. Older immediate ledger-only transfers are still visible, with a notice that their historical actor/reason cannot be reconstructed. Older two-step records may lack the new reason/branch snapshots; the drawer shows saved values where present and current warehouse names as a legacy fallback.

There is no existing approval/rejection workflow. Whether cross-branch transfers need approval, who may approve, and how rejection should reverse transit are separate business decisions. The existing cancellation path is a reasoned return of the unreceived remainder; it is not presented as an approval rejection.

### Regressions and verification

| Check | Final result | Evidence |
|---|---|---|
| Domain suite | **538/538 PASS** | `npm run test:domain`; four new cases cover assignment and transfer audit/validation/permissions/idempotence. Existing successful transfer fixtures were updated with a valid reason. |
| UI suite | **143/143 PASS** | `npm run test:ui`; two new cases cover unassigned engineer denial and immediate transfer history after remount. Existing UI cases verify missing reason and LOT validation. |
| TypeScript | **PASS** | `npm run typecheck` after the final test change. |
| ESLint | **PASS** | `npm run lint` after the final test change. |
| Safe production build | **PASS** | `npx vite build`; `npm run build` was avoided because its styles step rewrites the pre-existing modified `src/styles.css`. |
| Standard desktop/mobile E2E | **69/69 PASS** | Setup 1 + desktop 34 + mobile 34; `test-results/phase4-final-full-e2e`, isolated auth `test-results/phase4-final-full-auth.json`. New tests exercise immediate transfer audit/history after refresh and engineer reassignment at submission on both viewports. Targeted run was also 4/4 PASS and is a subset of this total. |
| Saved-company manufacturing E2E | **1/1 PASS** | `evidence/phase4/run-38407e97/manufacturing-d4147e15/`, `test-results/phase4-final-manufacturing-e2e`; same saved company with isolated auth. |
| Fresh-company Phase 4 E2E | **1/1 PASS** | `evidence/phase4/run-8c1da974/`, `test-results/phase4-final-fresh-e2e`; unique company/evidence run. |
| Saved-company transfer E2E | **1/1 PASS** | Correct stage-2 snapshot at its `localhost:4191` origin, `test-results/phase4-final-operations-stage2-e2e`; new screenshot suffix `stage2-finalrules-20261120`. |
| `git diff --check` | **PASS** | No whitespace errors; Git emitted only line-ending notices. |

The final suites comprise **753 test executions**: 538 domain + 143 UI + 69 standard browser (including setup) + 1 manufacturing + 1 fresh-company + 1 saved-company transfer. The targeted 4/4 browser run is included in the 69, not added again. Two intermediate saved-company transfer attempts failed due to test setup: one used port 4209 while its saved storage belonged to port 4191; the other used a post-transfer snapshot with an already invoiced PO. The final run used the correct origin and pre-invoice stage-2 snapshot. These failures were investigated and are not counted as passes.

Regression evidence is in `docs/audits/evidence/phase4/final-business-rules-2026-11-20/`: desktop/mobile screenshots of assigned and unassigned engineer outcomes and immediate transfer details, plus unique saved-company transfer dispatch/receipt screenshots. The complete manufacturing and fresh-company run IDs above contain their own summaries and screenshots. Playwright auth and test outputs used isolated `test-results/` paths. No pre-existing screenshot was overwritten.

### Files and integrity

Task-touched application files: `src/domain/access.ts`, `src/domain/actions.ts`, `src/features/equipment/components/SpareParts.tsx`, `src/features/warehouse/pages/Warehouse.tsx`, `src/types/index.ts`. Regression and fixture files: `tests/phase4Decisions.test.mjs`, `tests/inventoryCompletion.test.mjs`, `tests/inventoryPhase3.test.mjs`, `tests/phase1.test.mjs`, `tests/phase5final.test.mjs`, `tests/scopeStock.test.mjs`, `tests/workflows.test.mjs`, `tests/ui/phase4Decisions.test.tsx`, `tests/ui/inventory.test.tsx`, `tests/ui/scopeStock.test.tsx`, `e2e/maintenanceAssignment.spec.ts`, `e2e/inventory.spec.ts`, `e2e/phase4Operations.spec.ts`. This report and the new evidence files were also updated or added. Existing unrelated modifications and untracked files were retained.

The protected files retained their start-of-task SHA-256 hashes: `src/styles.css` `D2C68370650D67A97BE22F663E72B0C888F7FA2E9190394523DA72C99738E349`, `e2e/.auth/admin.json` `ADEB442AB361569056779E58294C441CAFFB20D18BE5974664ED091E4A68EB20`, and `run-38407e97-final.storage.json` `244DCC3D6C7A29F5471B5F0C13314D59BEFD96C15078A9D7BB41676923656308`. The saved stage-2 snapshot was read into an isolated browser context, not rewritten.

**Remaining risks:** Browser storage permits users with device access to alter identity, permissions, tenants, subscriptions, records, or audit history. Idempotency and stock changes are atomic only within one local domain result; simultaneous browsers/devices need server-side authorization, transactional stock updates, globally enforced idempotency keys, immutable audit records, and persistent storage. A transfer approval/rejection policy has not been chosen. No backend or migration was introduced, and no production-readiness claim is made.
