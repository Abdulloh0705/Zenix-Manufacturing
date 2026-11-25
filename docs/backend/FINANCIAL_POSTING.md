# ZENIX financial posting and reconciliation rules

Status: technical interpretation of owner-accepted initial FIN-01..04 policies. These rules preserve today's source actions and add controlled paths for previously open cases. They do not assert statutory GL/tax compliance. Jurisdictional accounting and tax treatment requires separate expert sign-off.

## Common financial event contract

Every payable, receivable, valuation, cost or variance posting has tenant_id, source_type, source_id, source_event_id, event_kind, signed amount, currency, original amount, UZS amount, exchange-rate snapshot where applicable, accounting_date, occurred_at UTC, posting_basis, actor, approval actor where required, reason, evidence reference, idempotency key, correlation ID, and optional reverses_id. Reconciliation proposals have states open, pending_evidence, ready_for_review, approved, posted, rejected or reversed, with append-only case events. Ledger and valuation entries are inserted only when posted and are thereafter immutable; only these posted entries affect balances. Reversal is a compensating posted row with opposite sign and unique reverses_id; original rows remain immutable.

Positive payable amount raises supplier obligation; negative payment/credit lowers it. Positive receivable amount raises customer debt; negative payment/credit lowers it. Inventory and COGS valuation signs are explicit per event kind. Amounts are exact decimals; no frontend floating-point authority. Period states are open or locked. A locked period cannot receive a new effective posting; an approved adjustment is dated in the next open period with its original economic event date retained separately.

No command may mark actual, verified, approved or paid from a browser field alone. Provenance and approval are checked server-side. A failed or incomplete posting does not alter any source balance. Financial audit records and the source posting commit together.

## FIN-01 subcontract custody and material return

For each dispatch line and stock SKU/LOT:

sent_qty = used_in_accepted_or_scrapped_output_qty + returned_usable_qty + returned_damaged_qty + supplier_custody_open_qty.

All terms are nonnegative and recorded in stock units. Closing the subcontract requires supplier_custody_open_qty = 0 and evidence for damaged/missing quantity. If the equality cannot be established, the order remains open with a reconciliation case. Material issue freezes source stock layer, location, unit cost and origin. An unused return references that issue and cannot exceed its unreturned balance. Usable returns enter QC/stock at the frozen issue basis; damaged returns create a loss event; supplier credit is separately linked to the supplier payable ledger. No direct edit of the old dispatch movement or LOT value. Current Draft-only cancellation remains. A posted return can itself be corrected only by a linked reversal and new posting.

## FIN-02 subcontract partial receipt and service correction

Existing pre-first-receipt reasoned quote correction remains the only direct correction of the order quote. At dispatch, freeze source service amount, currency and approved conversion rate. For each partial receipt i, allocate service and material separately using cumulative rounding:

allocation_i = round(total * cumulative_received_i / ordered_qty, 2) - round(total * cumulative_received_before_i / ordered_qty, 2).

This preserves the existing frontend behaviour and places the rounding residual on the last receipt. Sum of all allocations cannot exceed the frozen total; when full ordered quantity is received, the allocations must equal the total exactly. QC accepts or scraps each receipt's frozen share. Accepted LOT value is never rewritten.

A later supplier document is a proposed signed delta, not a revision of a historical receipt. The document includes provider/reference ID, source currency, amount or revised-total mode, currency rate/date, receipt links, reason and evidence. Server resolves amount mode to one signed delta and rejects duplicate document IDs. It first verifies exact affected quantities and existing allocations. The delta is split among unreceived WIP, unsold stock, consumed WIP, shipped COGS and documented loss according to traceable quantities/cost layers. The sum of signed allocation rows must equal the source delta exactly; final row takes the rounding remainder. If any portion lacks provenance, the affected case stays pending and is not silently posted as actual. A proposer with purchases.edit cannot approve their own financial adjustment; approval requires costs.edit by another authorized user or an explicit owner exception with reason and audit. A credit uses the same path with negative delta. Reversal of a posted adjustment posts compensating entries against the exact original allocations.

## FIN-03 provisional and final production cost

Final QC release freezes physical LOT cost and basis actual, estimated or provisional. Shipment freezes the allocated LOT unit cost and quantity. A later MO close does not change either historical row.

For a normal single-output cost pool with complete provenance:

delta_total = final_eligible_MO_cost - sum(previously_frozen_output_cost_allocations).

The cost pool includes the current eligible material, labor, machine, energy, overhead and subcontract components exactly once, using the existing domain rounding policy. Allocation follows recorded output LOT quantities and their later disposition: remaining inventory, work-in-progress, sold quantity, returned quantity and documented loss. Each allocated delta is linked to MO, output LOT and when sold to shipment line. Sum(allocated_delta) = delta_total exactly, with one deterministic rounding residual. A return reverses the original frozen shipment value and the linked variance share; QC disposition then decides inventory/rework/scrap treatment. If by-products, split/merge/rework or older data make cost-pool ownership ambiguous, no proportional allocation is guessed. An open reconciliation case records missing inputs and awaits an approved rule/evidence. Reports retain provisional/estimated/unreconciled labels until the final posting is valid; a status change alone cannot make profitability actual.

Variance proposal and approval are separate. Only a user with costs.edit may approve; approval is audited with the exact preview and input version. If the period is locked, post in the next open period with a source-period reference after explicit approval. An approved variance can be reversed by compensating entries, never by editing the shipment or LOT.

## FIN-04 operational ledger and future GL/tax

Release 1 balance truth is current operational subledgers: supplier payable, customer receivable, stock/LOT valuation, production cost, variance and expenses. A balance is derived from posted signed entries, not edited on supplier/customer master. Opening balances imported from old browser data retain opening provenance and are not assigned to guessed invoices. Legacy return credit remains an explicit resolveReturnCredit decision.

Every posting has a stable source_event_id and mapping_status. Future GL can consume this stream into chart-of-account debit/credit entries with its own idempotent consumer and reconciliation to operational totals. Future tax documents can attach jurisdiction-specific tax code, legal identity, invoice and filing status without changing the underlying ERP movement. No dashboard or export labels operational balances as a certified GL or tax return until that separate module is implemented and validated.

## Reconciliation case lifecycle and control

open -> pending_evidence -> ready_for_review -> approved -> posted, or rejected. A posted case may create a linked reversal case; it does not return to open by row mutation. Mandatory fields: source row IDs, exact quantity/amount discrepancy, cost basis, missing evidence, reviewer, reason, period and expected allocation preview. A reviewer cannot approve if the source version, linked stock movements, exchange rate or period changed since preview. Unknown source, older incomplete LOT genealogy, unverified supplier document, unverified payment, unresolved ownership or missing final cost remain pending. Exports and APIs show the outstanding count and amounts separately.

## Acceptance examples

1. Split subcontract receipt 30 + 70 of 100 units: material and service allocations sum exactly to dispatch totals; replay of either receipt key changes nothing.
2. Dispatch 100 units, 60 used, 25 returned usable, 10 damaged, 5 missing: closure blocked with 5 open custody. No inferred stock return.
3. Supplier credit after 40 units sold and 60 unsold: negative delta allocates to attributable COGS and inventory only after document and provenance approval; original LOT/shipment values remain.
4. MO final cost greater than provisional cost after partial shipment: exact variance split between remaining LOT and shipped COGS; return reverses original shipment plus its variance share.
5. Multi-output/by-product MO with unknown allocation basis: case stays pending, profitability cannot become actual.
6. Closed period correction: no backdated write; approved compensating entry in next open period with original event date preserved.
7. A second reversal, duplicated supplier document or reused idempotency key with different body is rejected.
8. All examples repeat with two tenants sharing a user and overlapping legacy IDs; no cross-tenant value or audit record appears.

References: ../BACKEND_CONTRACT.md; ../audits/ZENIX_PHASE36_REPORT.md; ../../src/domain/payables.ts; ../../src/domain/receivables.ts; ../../src/domain/profitability.ts; ../../src/domain/actions.ts. IAS 2 inventory-cost principles: https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/ . Any applicable local statutory policy remains to be reviewed separately.
