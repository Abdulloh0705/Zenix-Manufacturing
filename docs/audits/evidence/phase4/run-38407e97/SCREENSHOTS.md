# Screenshot metadata

- run-38407e97/01-signup-validation.png: signup-validation; desktop 1366×900; expected: Required name rejected; actual: Name validation visible; source: browser storage/UI state.
- run-38407e97/02-new-company-dashboard.png: new-company-dashboard; desktop 1366×900; expected: Empty new tenant workspace; actual: One owner, zero products and work centers; source: browser storage/UI state.
- run-38407e97/03-owner-relogin.png: owner-relogin; desktop 1366×900; expected: Login and refresh retain session; actual: PASS in isolated browser storage; source: browser storage/UI state.
- run-38407e97/04-branch-create-blocked.png: branch-create-blocked; desktop 1366×900; expected: New branch saved; actual: FAIL: modal remains open and only default branch exists; source: browser storage/UI state.
- run-38407e97/05-line-create-blocked.png: line-create-blocked; desktop 1366×900; expected: New production line saved; actual: FAIL: modal remains open and no production line exists; source: browser storage/UI state.
- run-38407e97/06-work-centers-empty.png: work-centers-empty; desktop 1366×900; expected: New work center creation available; actual: No work centers and no create control; source: browser storage/UI state.
- run-38407e97/07-raw-material-created.png: raw-material-created; desktop 1366×900; expected: Raw material saved; actual: Material visible in list; source: browser storage/UI state.
- run-38407e97/08-supplier-created.png: supplier-created; desktop 1366×900; expected: Supplier linked to material; actual: Supplier visible in list; source: browser storage/UI state.
- run-38407e97/09-purchase-order-created.png: purchase-order-created; desktop 1366×900; expected: 100 kg at 10,000 UZS per kg; actual: PO saved in browser storage; source: browser storage/UI state.
- run-38407e97/10-partial-goods-receipt.png: partial-goods-receipt; desktop 1366×900; expected: 40/100 kg received; actual: PO received quantity 40 kg; source: browser storage/UI state.
- run-38407e97/11-full-goods-receipt.png: full-goods-receipt; desktop 1366×900; expected: 100/100 kg received; actual: Two receipt movements, PO fully received; source: browser storage/UI state.
- run-38407e97/12-inventory-after-receipt.png: inventory-after-receipt; desktop 1366×900; expected: 100 kg raw material on hand; actual: Warehouse stock view after UI receipts; source: browser storage/UI state.
- run-38407e97/13-role-accounts-created.png: role-accounts-created; desktop 1366×900; expected: Eight distinct employee accounts; actual: Eight role-scoped employees listed; source: browser storage/UI state.
- run-38407e97/14-role-1-deny.png: role-1-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /admin?view=users allowed; /platform denied; source: browser storage/UI state.
- run-38407e97/15-role-2-deny.png: role-2-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /production allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/16-role-3-deny.png: role-3-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /purchases allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/17-role-4-deny.png: role-4-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /sales allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/18-role-5-deny.png: role-5-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /warehouse allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/19-role-6-deny.png: role-6-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /warehouse allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/20-role-7-deny.png: role-7-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /quality allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/21-role-8-deny.png: role-8-deny; desktop 1366×900; expected: Forbidden route rejected; actual: PASS: /equipment allowed; /admin?view=users denied; source: browser storage/UI state.
- run-38407e97/22-operator-blocked.png: operator-blocked; desktop 1366×900; expected: Operator can select a work center; actual: No work center exists in fresh tenant; source: browser storage/UI state.

## Continuation screenshots

- phase4-finished-product-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-bom-blocked-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-dashboard.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-warehouse.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-purchases.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-production.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-reports.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-dashboard.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-warehouse.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-purchases.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-production.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-reports.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.

## Continuation screenshots

- phase4-finished-product-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-bom-blocked-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.

## Continuation screenshots

- phase4-finished-product-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-bom-blocked-desktop.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-dashboard.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-warehouse.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-purchases.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-production.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-desktop-reports.png: desktop 1366×900; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-dashboard.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-warehouse.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-purchases.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-production.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
- phase4-mobile-reports.png: mobile 393×850; expected: route renders or BOM saves; actual: see screenshot and ROUTE_AUDIT.json; source: UI/browser storage.
