# ZENIX source manifest

Audit date: 2026-11-09 (Asia/Tashkent). Branch: `main`. HEAD: `dbbe317550e51154429d0ceb70529060038223a2`. Source of truth: this local worktree including uncommitted files.

## Uncommitted inventory at manifest generation

```text
 M docs/AUTH.md
 M docs/BUG_REGISTRY.md
 M e2e/auth.setup.ts
 M e2e/fixtures.ts
 M e2e/smoke.spec.ts
 M scripts/run-domain-tests.mjs
 M src/App.tsx
 M src/app/providers/AppProvider/AppContext.tsx
 M src/data/mockData.ts
 M src/domain/access.ts
 M src/domain/actions.ts
 M src/domain/auth.ts
 M src/domain/dashboard.ts
 M src/domain/insights.ts
 M src/domain/manufacturingEngine.ts
 M src/domain/migrations.ts
 M src/domain/notifications.ts
 M src/domain/persistence.ts
 M src/domain/planning.ts
 M src/domain/productionControl.ts
 M src/domain/receivables.ts
 M src/domain/reset.ts
 M src/features/admin/pages/Admin.tsx
 M src/features/ai/pages/AI.tsx
 M src/features/auth/pages/AuthPages.tsx
 M src/features/equipment/pages/Equipment.tsx
 M src/features/materials/pages/Materials.tsx
 M src/features/production/components/OrderParts.tsx
 M src/features/production/pages/Overview.tsx
 M src/features/production/pages/Production.tsx
 M src/features/products/components/BomEditor.tsx
 M src/features/purchases/components/Sourcing.tsx
 M src/features/purchases/pages/Purchases.tsx
 M src/features/reports/pages/Reports.tsx
 M src/features/sales/pages/Sales.tsx
 M src/features/settings/pages/Settings.tsx
 M src/layout/AppLayout/Topbar.tsx
 M src/routes/navigation.ts
 M src/shared/ui/Forms.tsx
 M src/styles.css
 M src/styles/access.css
 M src/styles/modules.css
 M src/types/index.ts
 M tests/access.test.mjs
 M tests/auth.test.mjs
 M tests/bugRegistry.test.mjs
 M tests/phase2.test.mjs
 M tests/phase5.test.mjs
 M tests/premerge.test.mjs
 M tests/productionControl.test.mjs
 M tests/reset.test.mjs
 M tests/scopeStock.test.mjs
 M tests/ui/appFixture.tsx
 M tests/ui/auth.test.tsx
 M tests/ui/forms.test.tsx
 M tests/ui/phase5.test.tsx
 M tests/workflows.test.mjs
 M vite.config.ts
?? docs/BACKEND_CONTRACT.md
?? docs/audits/
?? scripts/platform-provision.mjs
?? src/domain/backupSecurity.ts
?? src/domain/payables.ts
?? src/domain/profitability.ts
?? src/domain/saas.ts
?? src/features/platform/
?? src/features/subscription/
?? tests/phase31.test.mjs
?? tests/phase33.test.mjs
?? tests/phase34.test.mjs
?? tests/profitability.test.mjs
?? tests/saas.test.mjs
?? tests/ui/phase33.test.tsx
?? tests/ui/platform.test.tsx
?? tests/ui/tenant.test.tsx
```

Audit reports and ZIP were created during this task; application source and tests were not intentionally edited. Build regenerated its usual outputs. No commit, push, merge, deploy, or business-data deletion occurred.

## Verification

| Check | Command | Current result |
| --- | --- | --- |
| Domain | `npm run test:domain` | PASS 417/417 |
| UI | `npm run test:ui` | PASS 77/77 |
| TypeScript | `npm run typecheck` | PASS |
| ESLint | `npm run lint` | PASS |
| Production build | `npm run build` | PASS |
| Diff whitespace | `git diff --check` | PASS, CRLF conversion notices only |
| Chrome E2E | `PW_CHANNEL=chrome npx playwright test` | UNVERIFIED: local Playwright web server did not reach browser assertions; full run and targeted setup were stopped after prolonged startup. 0 current Chrome tests completed. Historical Phase 3.4 report says 27/27 on 2026-11-07; that is not a current result. |
| Focused synthetic probe | `scopedView(createSeedState(), branch manager)` | Cross-branch employee and expense reads reproduced |
| Focused synthetic probe | `setupFirstAdmin` with empty owner/company | Accepted; blank metadata reproduced |
| Focused synthetic probe | ECDSA ticket verified twice | Both checks returned true |
| Focused synthetic probe | Create branch manager without home site in clean tenant | Profile accepted; located action refused |

## Source to test mapping

| Source | Relevant tests |
| --- | --- |
| `src/domain/auth.ts`, `src/shared/lib/crypto.ts`, `src/features/auth/pages/AuthPages.tsx` | `tests/auth.test.mjs`, `tests/ui/auth.test.tsx`, `e2e/auth.setup.ts`, `e2e/smoke.spec.ts` |
| `src/domain/access.ts`, `src/domain/backupSecurity.ts`, employee/admin UI | `tests/access.test.mjs`, `tests/phase33.test.mjs`, `tests/ui/phase33.test.tsx`, `tests/ui/tenant.test.tsx` |
| `src/domain/saas.ts`, `src/features/platform/PlatformPage.tsx` | `tests/saas.test.mjs`, `tests/ui/platform.test.tsx`, `tests/ui/tenant.test.tsx` |
| `src/domain/actions.ts`, inventory/planning/production modules | `tests/workflows.test.mjs`, `tests/phase31.test.mjs`, `tests/phase33.test.mjs`, `tests/inventoryPhase3.test.mjs` |
| `src/domain/payables.ts`, `receivables.ts`, `profitability.ts` | `tests/phase31.test.mjs`, `tests/phase34.test.mjs`, `tests/profitability.test.mjs` |
| `src/domain/dashboard.ts`, `insights.ts`, `notifications.ts` | `tests/dashboard.test.mjs`, `tests/phase5final.test.mjs`; AI answer accuracy unverified |

## Verified versus unverified

Verified for tested browser-demo flows: owner-only public role, account/member/session gates, targeted RBAC escalation checks, tenant key isolation, purchase/production/stock/sales ledger scenarios in the suites. Partial: every role/page/action/export combination, interrupted registration, timed platform expiry browser behavior, full recovery browser replay, cost/accounting policy, AI answers, real multi-user concurrency. Backend authentication, database isolation, payment and support access are absent.

## Sanitization and included evidence

The ZIP allowlist contains the five new audit reports; listed historical reports and contract; `package.json`; all text source under `src`; source tests under `tests` and top-level `e2e/*.ts`; and script/config code. It excludes `.env*`, `.git`, `node_modules`, `dist`, `.test-dist`, `test-results`, `e2e/.auth`, localStorage exports, browser profiles and generated logs. `src/data/mockData.ts` and test contact details are synthetic fixtures. No actual customer/business records were read or exported. The included text was scanned for private-key headers and common API/access-token signatures; no matches.

## SHA-256 of evidence source, tests and historical documents

| Relative path | SHA-256 |
| --- | --- |
| `README.md` | `e272d3fa44cbe5b719f67c4f4f9117f6c83e3b67c14962459b8685541bef343d` |
| `docs/AUTH.md` | `f97165e0ecec3ac3d89219f6218aeceecc6a56a1255a6f4bb390cc297efc8236` |
| `docs/BACKEND_CONTRACT.md` | `a99ce2bc0a17a489d0500d3cabe9cd6b1cfcbf10071529c5bfa837e77c1bc2fb` |
| `docs/BUG_REGISTRY.md` | `1f8e16b805d898eca03557c1008beb92b117e778c0c80a249b1a5b675dbd1247` |
| `docs/audits/PHASE32_AUDIT.md` | `85573189f4f76fbb3db32293cbd7d6fb22073ec0c2b55dc73bf61807890a20d6` |
| `docs/audits/PHASE32_ISSUES.md` | `0c099e18c2039be2910ac35e0c968f67cee551096e5d6cf9674c318b5e133dcb` |
| `docs/audits/PHASE32_ROLE_MATRIX.md` | `14621a9b6d4eb3d3dc79977a53e39ee7298bb175772c7fec869e21890dbb0af7` |
| `docs/audits/PHASE34_FINAL_READINESS.md` | `cf28bc567c379f608b88d69fe155ad1f4f39c63dd5c29515f3be305b1775f854` |
| `e2e/auth.setup.ts` | `fa520aba6d3cbad057dccf66aa6993b3fe922f46fca11cd10f94534b6b8648ed` |
| `e2e/fixtures.ts` | `af2fe90cddca5355088bf14a2716983cd19fedcbd70e16b2201e0944ba9ab177` |
| `e2e/smoke.spec.ts` | `831b8b66a231f4dd64e11d6c8954c65bb2fa5110f84a726570c524936e9a53de` |
| `eslint.config.js` | `3a9a0fddfe30c23bd86a418ae36e72b2235f6ceb118ef8ad159652a6d36629c6` |
| `package.json` | `33342ca089a6d7401a965d32aeed8b4d9bb6c7336157dafed2647bc955f42e11` |
| `playwright.config.ts` | `1fffa02eb16b712a20150d817ded558a98b4b31c1bc900b9271b2e926d5b5d4f` |
| `scripts/auth-recovery.mjs` | `7a632cea801f64451dad167661008e42398c60b6fcfe76dcff2e1f42e41fcd77` |
| `scripts/build-styles.mjs` | `0e971a4c16b252dadcde61a5714f4911a55323619b8f59f81ca094535fed62da` |
| `scripts/platform-provision.mjs` | `91b62025e6b424cb5cf0a1f997a4366f2c770d6d042640c81cb759c325e50b91` |
| `scripts/run-domain-tests.mjs` | `2f7c345867d57177d3785d401becead7ed219ca9e2ae8345ff277879ce2c7474` |
| `scripts/run-ui-tests.mjs` | `b2f3ca78e290ba5c1161d47a4d1d52e5f9d6cb2944baf7fbc46b9328e10ba536` |
| `src/App.tsx` | `b061d138093955c7d69e948041ecc5330e1befd46d9f5b3927193830266c531f` |
| `src/app/RootBoundary.tsx` | `d69b4bea1e4419cf373ae7502c6d2a1d36a322be54df0863d4f50c8dc78aa718` |
| `src/app/providers/AppProvider/AppContext.tsx` | `f911e832f15125f1ac1fd60e1a2ca0e263a4f3950d6ac33bda0466a0a9ed19cd` |
| `src/app/theme/preferences.ts` | `c5901b8ff71960c327ef739b1def6955bd287eb6661ad3ce1086e8f950a23934` |
| `src/app/theme/themeRegistry.ts` | `d29b11bcffc61e78ab954b6f5baac1dde7baada9cc68f26eaf60815e9e2fd24b` |
| `src/data/mockData.ts` | `9b6ad8dbf9eba45d9f48f16b2383da0308538664cf3229348a7b802e3f8e97ca` |
| `src/domain/access.ts` | `4ca02c196d065cf953cfad317253ea71aeb1734a18d863a04982572de99e5048` |
| `src/domain/actions.ts` | `3f315e6b815ad173d32bac8046c4cc272c1c4e632df1d7581094482409fbae14` |
| `src/domain/auth.ts` | `5225049f0f393df77f7390992b25d559e6b4c12dc15e78f75c6d968e6e575be2` |
| `src/domain/backupSecurity.ts` | `43c7b23c68312d2ba0d0d68c8ca114f6b42140ccc36e984722af4f4e7dae2721` |
| `src/domain/dashboard.ts` | `1d45239e6beca2b80c270c0cb8bc3181daa9087e67571694b2b3bc5289132c24` |
| `src/domain/insights.ts` | `e302ab205867b69424c233459f031782440acaa802f8605aae612b36e8b29c68` |
| `src/domain/inventory.ts` | `8573e47addd5ab6b19ba8fed3a479c685705a55cba8e22f13feef4e67867c82b` |
| `src/domain/maintenance.ts` | `68ed9a92468acae7057a6459f24eaeaa34c76af9b70d210083d84763a8c292d2` |
| `src/domain/manufacturingEngine.ts` | `cbfbe6c410532b7ecae998ef8f73576527fd64cfc6b550dd4aa2eb9979f84f12` |
| `src/domain/migrations.ts` | `b440ee7c97efb748d3071dddeecd9c7c92dcb6f98b94d91ae7127d847e1e2a25` |
| `src/domain/notifications.ts` | `10f0b4d01ef096ca976c886ca9e8f90867670e5da054d847b815ef5807533a6c` |
| `src/domain/payables.ts` | `61d1e2a41d2bcc827dc2f01d8cd4b1e4dc836130bc782a9be4bb0e3689dce0f2` |
| `src/domain/persistence.ts` | `5e59de62a2487972f0a1a482e78c272d9b3b989a509014f4c236817193eaec62` |
| `src/domain/planning.ts` | `155be4151983fcfe83bb250c68f9ab358b78ca2afe5742ace2bedf8e73523250` |
| `src/domain/productionControl.ts` | `7e7678892cc3e8031351ddea69189eae47a806a4a9fdb4b62a66a68bbba708e2` |
| `src/domain/profitability.ts` | `a90b10a04187e35fe94b0e7d383d758d9fe57a670b2a885c73921729f43cc8e1` |
| `src/domain/receivables.ts` | `acfa1bcae09812a1140e57a4a4ceea4fd5d265085c0b02e0cfd2bbc7eeceb17e` |
| `src/domain/reset.ts` | `1468969c07e205491e25c8e26f9e4a3887f47425e3cbf45847b76e88d11de94f` |
| `src/domain/saas.ts` | `e8bd0914c437299284bdd9a91ce4024eca17e644bd3a3bb75355f38832a69c05` |
| `src/domain/serials.ts` | `55e95824ba6cdca1ac9d9fa7405f5ad0f0937f3ac50bb2bec92603673729c1ab` |
| `src/domain/supplierMaterials.ts` | `a21e3672989e57b18e7e8ecfc568527df889bb45b04b13ac8a5d1a4639d5465c` |
| `src/domain/uom.ts` | `354531c711e5cf5665adbfe668602ce50bc4cf8006857339c99a9b3db6e797db` |
| `src/domain/validation.ts` | `d79e7dea72148b0a3b59d2953f80045996c400e9eaf14e38bf31d24589126707` |
| `src/features/admin/components/PermissionMatrix.tsx` | `aa6ebbe5b57d85b0568d6e57d180ba2d5969a0c375a57c902b4398dc4d3ca267` |
| `src/features/admin/pages/Admin.tsx` | `91d8f0d24dda7aaafb2f86d1f5ad2b811dea2d870fe4fb389a34009b6c11e224` |
| `src/features/ai/pages/AI.tsx` | `36e922764c29826a388d49274729b1b4ef380ae564a643da454c01b50558fe37` |
| `src/features/auth/pages/AuthPages.tsx` | `91d8525bbd83b6985460359edc028a7dd7d52442e056f6525eb53ba9a8bb47d6` |
| `src/features/common/Barcode.tsx` | `35cd11d290ceb37ac96b9ad1662e4f4100f609faef6abcadf3e038aed55f6486` |
| `src/features/common/QualityResolveModal.tsx` | `b1af066dda8684e0b3af85c2c2b53b1f64aca1034fe5664e3d3fab39f3b07bcf` |
| `src/features/common/RecordPanels.tsx` | `fd3ad669e841e508cd279c7038d583cea61a3119a0fcd449a117606cead1b60a` |
| `src/features/common/StatStrip.tsx` | `d005a8211b9f0d256937056a14f9b13f893107776fded64ab67128102b05908a` |
| `src/features/common/WorkingDays.tsx` | `30ccd5c61b93c142728877c65ce9db181c2148072747e62c7cc08a6aa6120ed5` |
| `src/features/common/charts.tsx` | `21501df7b85c0b76f8e33839174a3ee37a7b2bf093873117b14775f53e907522` |
| `src/features/common/lookups.ts` | `0177b970b4b1a23a8e892e406e92975a19708d871ece2a4f50118dbee793168b` |
| `src/features/costs/pages/Costs.tsx` | `d91c5ac7f65b945e0906370177c223731999e78976139f411c6c19880a5ea0bb` |
| `src/features/dashboard/pages/Dashboard.tsx` | `a6a5ab4a4c2a3b246e559ce6ccb00eb3fa2999576df51945a3d7e354facf5890` |
| `src/features/employees/pages/Employees.tsx` | `3e742f1eea422e9695e9ded05e612607cfccd6bcbb1fe8f6a63fa5748a483fa4` |
| `src/features/equipment/pages/Equipment.tsx` | `4cf0f42fe67f8da9f9113bb086f678d309c2ca2e61f95fbdd9a3177a2dc7649f` |
| `src/features/materials/materialDraft.ts` | `e0b387e2cd5d58248e554ae096647a4a4740625908e80b971bba8d92890fbb5d` |
| `src/features/materials/pages/Materials.tsx` | `d3cc3fa6a5aa7176e23fa8f4e5c4bfbecc6f572167d8a6805a345a977969abdd` |
| `src/features/platform/PlatformPage.tsx` | `0cb9138e6f2a4eccf87da230aef23e6262f4899b8a239c82907d4433fb33c08e` |
| `src/features/production/components/OrderParts.tsx` | `22379a8e987fa0a402bf7d5d12d89534440c22e9eb578a413dd60d646c984766` |
| `src/features/production/pages/Overview.tsx` | `51a63429a5bb94d57f033c0d8b326b695a194722abdc5ba60e645857af7197d6` |
| `src/features/production/pages/Production.tsx` | `7d0852b2233453ea2c96f1c47f47b7d962cd4d04e32616efd6be70c7b3f25359` |
| `src/features/products/components/BomEditor.tsx` | `a126bbe2330b1cb094e0ebb59174d2695a707841957ca9134ecb9da84be86e79` |
| `src/features/products/components/ProductForm.tsx` | `8d4a72e3df16ca0e0f8931c07261fe83f2e232403b81193b7782d519ca87fd1d` |
| `src/features/products/pages/Products.tsx` | `ef9fa9ebf109a719525e4f7530c6a540931f69194b2f7133ea173fdb4335970e` |
| `src/features/purchases/components/Sourcing.tsx` | `78d8b78bf2012b828bfdca6b0ffa46cac04bfdaa833c726a035640200d3a4699` |
| `src/features/purchases/pages/Purchases.tsx` | `7de0ce453020a763276bbfe7e7e7c0a58e363a29b70a3708f37baf8c5483f628` |
| `src/features/quality/pages/Quality.tsx` | `ccaa6f63b0148a87636a553ec2c3d90e359cf9d7a85fe443ad1f1f08c6f92a52` |
| `src/features/reports/pages/Reports.tsx` | `8b5ea04d0653fade4f037e800771013566e34196b907f4c87a6c12967a02e019` |
| `src/features/sales/components/Receivables.tsx` | `b73b1ae010f674a9cf97ac256fb5be83871bebf2657588c9282a2307ae98cbaf` |
| `src/features/sales/pages/Sales.tsx` | `c16bf01d8202524970895d293629f9bb3c5dd6d5040691c61b7291de98c0ec89` |
| `src/features/settings/pages/Settings.tsx` | `89c02dae4d024461555277a13ca794afb02f9dea813a7bae593f33ef7513711f` |
| `src/features/subscription/pages/Subscription.tsx` | `d3dfd921e9f86ae9b91a1fd393c56ea1c8bb50ec4ec2adfa3853004775bd047f` |
| `src/features/warehouse/pages/Warehouse.tsx` | `ccafe35e77ee093d6a8dc15f7a62ce8c47374341ed0f9439439a763dae4466fd` |
| `src/layout/AppLayout/AiAssistant.tsx` | `b67d671226c07dc2d6051f136910cd4e4303c54e4b93fc7071b64bc16caceedd` |
| `src/layout/AppLayout/AppLayout.tsx` | `900f05498958fa1a08ca5c8992f534025ca6b9043927f977397c7e9bb98f9dd9` |
| `src/layout/AppLayout/Sidebar.tsx` | `35fbec9398e5d88a2038a79c0a168389cc319e196c6da8c26f1d631934d947ab` |
| `src/layout/AppLayout/Topbar.tsx` | `a12eb355f9f8c95fbc9428e3593766665137b47f68a821490c0aae887a628d61` |
| `src/layout/AppLayout/aiDock.ts` | `915610375d28a8b8bfe6edc84809542064070e254762f7d5820c58119e349a57` |
| `src/layout/AppLayout/notificationsView.ts` | `4ba04f28a3082f39abfe518331e9e3e0a7c9972193665fa6278d4201346149e5` |
| `src/layout/AppLayout/searchIndex.ts` | `8c99c88e4a297fd4705e223c5ea86832b23c381dc2746938c7fc8846dd5afac8` |
| `src/layout/AppLayout/shell.css` | `d2e2b810617cbddf284efaef74e70c56d2e2ff5772ad166adc2bf1481d8dc07a` |
| `src/main.tsx` | `6696a8dbe284f35749dc5d29c1525849f6d19bafeef5ab7ee50d8dbb51ba72fe` |
| `src/routes/navigation.ts` | `1c9d0cfa8676068bcbe86dc50fe3f5b3e8697633a500e5e013cbd2dcf6ed4977` |
| `src/shared/lib/crypto.ts` | `3e8d06246d69ab2e6cff8fd2be9026c14c618c9051018c4b5ee731781a62fc49` |
| `src/shared/lib/storage.ts` | `f7e88feb39839cd0585bc3497cc4c9ec60be47762abc6add2171a7598e2950f7` |
| `src/shared/lib/syncedState.ts` | `0968ff1fbcf10486f498a3111794d892767aa4dd24c14ef7be0520054f564bbd` |
| `src/shared/lib/useMediaQuery.ts` | `9ed07b94588345e3814f070739e5ce3486e7e10d99dc8472c05eaec9eab66fda` |
| `src/shared/ui/DataDisplay.tsx` | `3b99856e82569fdbb82a384fbdffb55d44cc9aed312922b2ab017747f463e49a` |
| `src/shared/ui/Forms.tsx` | `cb8eb7d1c8f08c197a13a0789117c66df48c3708cf01d1d7033044aaa6a9fc75` |
| `src/shared/ui/Icon.tsx` | `372c8c9aa2445325e3e1cc9ddf0f418f903ab264c6fc8a47483fe55b92e466c8` |
| `src/shared/ui/Layout.tsx` | `62d3c0cd90da3bace974305d0193cc7a75f8ccf3ceacd0179e71232452155c91` |
| `src/shared/ui/Overlays.tsx` | `323302c9e586dac71450b4ffdb1ea04f83c3818ed9c7c073b0a2fc1d7f845069` |
| `src/shared/ui/ResourceTable.tsx` | `3eb4d7a3391ec90f958a67e57b1bfb9ee6f6bbc7da079e3d721c3772d46a755b` |
| `src/shared/ui/index.ts` | `a465925549d7f9ea651f3fb258f850f60cc08ec83f8234a0fe0c206c7b75eb64` |
| `src/shared/ui/styles/controls.css` | `5786a2ebd2d809097828d724e84617bc596a6138d4d0af7a7bff171c812add4c` |
| `src/shared/ui/styles/data.css` | `dfe602a3d9c54958e0055203056fc00f375d6a353c771e8fe633c6b0afa3d418` |
| `src/shared/ui/styles/overlays.css` | `623f6ccf9d16fbdca62dfaad0f88b70bc3bdea02c78b83b34b809c5af4db6580` |
| `src/shared/ui/styles/surfaces.css` | `27cfe52d3da647e98b86a8595e0a66f2bc5179c55c763a43440458926728a435` |
| `src/shared/ui/tableSort.ts` | `b167853af0ddff0815b7279cb62f4aaf3f6984b2bdc4c1ab2602fc6236af0b15` |
| `src/styles.css` | `b2a2b82c4f9bab9a1b793a66589f433a49037b8d4d4e7962210f5cec2c1c8f80` |
| `src/styles/access.css` | `9d1fbf3aa57914ea7ffcdb688e0f0cb50dc2fa475a09151a9297e7e3006717fc` |
| `src/styles/base.css` | `26e15084b28e02e55438120551227a35af03c7a8462ea64d8c814e55cabaf3fe` |
| `src/styles/modules.css` | `0b57514d7e5e9c846d37356f5ce8b01398aa6585967ab5549b1e0420cf8c9059` |
| `src/styles/tokens.css` | `1502c403d969b37f283fe17b700d94f824ceb49f7b3c77b07b00fdfbeffd29ad` |
| `src/types/index.ts` | `1fc62344208b644c8fdf6fc53be3bedf663b902b247c2b3c9c07b717d6a18d69` |
| `src/utils/dates.ts` | `023eca108b56c5ec0332f303c73eac0b3425b07d8f15862f4df8c2fa07a3fe6c` |
| `src/utils/exportData.ts` | `1b1f2dc06a58a7dc50648f0fbc17a3aeccb4c2ad20271b4a1dc3eee48ceb4beb` |
| `src/utils/format.ts` | `ea07d9ecf00a68b6562fd4f6cd812ea132f365167be1eab07d03800c046761fa` |
| `tests/access.test.mjs` | `fbea53ded8bc4098627d69db51930bb917b34f67877286619af953924c3b0ef6` |
| `tests/auth.test.mjs` | `20ddbd3cef6cf3234b9f84a18cd2baddcc2e0691aefa5a0917b013924d503fbf` |
| `tests/bugRegistry.test.mjs` | `4bef6fe97bac5a2ef22926f9d4da6895d3fd204ac9a7562356998feb2b501d40` |
| `tests/dashboard.test.mjs` | `732ed52ed067765c485007dd057ecd09fdb3a0bb480b720840aa14039b233a34` |
| `tests/integrity.test.mjs` | `275e14debbad11aa6318654c7fffadaee3ddf5688f66cb979349b346af499656` |
| `tests/inventoryPhase3.test.mjs` | `6c935669d02a51a0ecc626a61dd9863f5236a5defe694ccca2efbbb80156d92a` |
| `tests/manufacturingEngine.test.mjs` | `3ddcb0032766309a9003c6fc18e0e489b59fbfc9007f86cdc0fc69d3e083c7f5` |
| `tests/phase1.test.mjs` | `0903e022a33eecd008585311bea23c739efa026986bbc4eb3dc28d8cd5b3382d` |
| `tests/phase2.test.mjs` | `c403c553b6bd3cc06d0c4940d1b85beef7485acc136526dd50061e6a2a3c95e9` |
| `tests/phase3.test.mjs` | `ada0498611bdd82ca29dd76ddb14256311e7622c5cca35706381562c7ba6a03b` |
| `tests/phase31.test.mjs` | `2d8796801847f314a3e7035161213b4d07c8a331e095443773fcaf7e163032d0` |
| `tests/phase33.test.mjs` | `e82f291151ddf91afc5900a2445dfa4111d704f6504426fea5439550ec82d415` |
| `tests/phase34.test.mjs` | `5cb3beb2a213596d7f816103f96bbc0b986dd362a28249b4e3bb7c95477a797b` |
| `tests/phase4.test.mjs` | `4e161a84aded43c07a8ca7ba08181bf6b06696d8cbe1b4e7297e2862fe089ec2` |
| `tests/phase5.test.mjs` | `1bdf9583bfdc1a46a97cff76a0d1b56ea6eddaea8b4677acb6432a8dbc397326` |
| `tests/phase5final.test.mjs` | `9546c5e6bab6dc87b62cb154c71a469153bc3f2f7a2407621f25cab384aef039` |
| `tests/premerge.test.mjs` | `d89bcd7a1cc9aa03eeceff79f9364f92065e053b6dac094b03e05021357fb109` |
| `tests/productionControl.test.mjs` | `38178cf2dc1d5f44462d7564d5035234be7aaf00656afd29c2e6c02c9b01795d` |
| `tests/profitability.test.mjs` | `56e073768a0a473c91eaf812f4a65dc48340589e4a33f849d14342d75a454d74` |
| `tests/release.test.mjs` | `de626727f18516284fea876a01018c0a13185ac5f7d809c0abb95fbf345dcdda` |
| `tests/reset.test.mjs` | `567abca1a957203cbb87d9f212be985d13d9bcb7ae8d922022cb343864084209` |
| `tests/saas.test.mjs` | `f34b5471d9fb7f2b15bd9a99e135ddb2b6ade13cee860093974c6329cf1a9a73` |
| `tests/scopeStock.test.mjs` | `1f339a6c6ad786e474bfa1edae6bee828e44b8f9c796853a42eae02a9257370c` |
| `tests/supplierMaterials.test.mjs` | `3df29f983b8b569b4412977e06e338ff410c3f7c92c4e7b10096aff072233ab3` |
| `tests/ui/app.test.tsx` | `935e228b0d115986ec73041f6d4142d5f91ffd38ee24fd495e82e8a6a24a4760` |
| `tests/ui/appFixture.tsx` | `87fb91ef773c8ece61ce0cc5ce236442212f957177929e358fc076e3e82916a9` |
| `tests/ui/auth.test.tsx` | `5ef64feb67448754c079f03587d03eb5f488aecff7dd74951912b3c236de9037` |
| `tests/ui/forms.test.tsx` | `3040d673bdf44463576d8b1d51f0842371bb8e6a61cf59c98d5cfd776948abbe` |
| `tests/ui/helpers.tsx` | `2e230b57a83723c85983269660764b4e3b72971b40cf9bc13b9f639d868fbfa2` |
| `tests/ui/overlays.test.tsx` | `69b4c5ecd8f16f10a7e2b8a3b19b3912d97afae3e5adfcd00f98ffe2aa72f5ff` |
| `tests/ui/phase33.test.tsx` | `a6e88df335d787b7e0ee1acb1d1418e373d847a47a8934afd2a29f08f8aa93c0` |
| `tests/ui/phase5.test.tsx` | `f0a84e5398e2f5b067bfe61ac7ce361ccd610c19debe737e5d35afb773bdc87a` |
| `tests/ui/platform.test.tsx` | `480781dec8cc25e2ac00569ad3673ba185ebecdc8f71c09c1ffb83e8f4e21b87` |
| `tests/ui/receivables.test.tsx` | `b1f4cbd2fff265e24e200a3762e7c62af515e2921922d6954ca6e3288d2dd1f7` |
| `tests/ui/reliability.test.tsx` | `bd749d4b52238da284a80e5b4577df5a17d6078954d256c4282bc89516ad9d8c` |
| `tests/ui/scopeStock.test.tsx` | `964ab0739124af78ee41a974c6a7b3b2db3f3bd5f51716d04226b8e6ce7e0072` |
| `tests/ui/setup.ts` | `c4624153e2d81679d1a06ff7a8038e74457d7c99ae9b46754080bd336e8c340f` |
| `tests/ui/shell.test.tsx` | `2ec55723ceb0ce0ad945476b15e5c96d43c42ec45463fdaaa4601291c4bf12ed` |
| `tests/ui/table.test.tsx` | `b11016ac872642f5f64e62ecda5a820a61966ce1924246c4bba2a837cb0a1fa0` |
| `tests/ui/tenant.test.tsx` | `97ebd14a0941c6fe7efcfdcc9e1fb50c06a5403f5e38c632a8c9b9eb39ec87fb` |
| `tests/workflows.test.mjs` | `3e94975a5f9fbda3f7b351ab029d0094e11c278078d189bcd72ceb73603dc785` |
| `tsconfig.app.json` | `2a1a96499bc8ef18cc8784c6da9950ee661cd4895e1b1f7880f4b1be59b6ccb0` |
| `tsconfig.e2e.json` | `471d683a8f854f406fb5ec09076d4941ec59f7242387de5facf4c7bea0f61a83` |
| `tsconfig.json` | `5f3f534d99b026b76f93db53b3a04d222e52a3e67b000e85310c9c09a2d7041e` |
| `tsconfig.node.json` | `b2b740fd62fcb83d525cf3b1f4db8a8bfc0837e420624ec67f40fe81d84b88f9` |
| `vite.config.ts` | `108eceff20255ea009b2fd1ae2f6b0144afc92c3fbd73c67d5e5161d0e14fcd9` |
