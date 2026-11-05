# Bounded coupon claim policy

Baseline: published `f5ae0db13c7152d4d3dd4efcf8e4efa1010bb4cf`.
This policy was established before implementation. The detached worktree now
holds a local review candidate; no source commit, push, deployment or real data
change has been made.

V2 corrects only the two frozen-V1 findings: nonpositive-counter cancellation
availability and conservative generation-origin cap counting after rename plus
redaction/untrusted latest state. Frozen V1 remains unchanged. Publication and
compatible-rollback/writer-isolation gates remain open.

## Observed storage and trust boundary

`order_events` has eight columns and no `payload`: id, order_id, kind,
from_status, to_status, actor, note, created_at. A payload-column design would
change the pinned 19-table/204-column contract and is outside this patch.

The existing `note` can carry a reserved internal JSON record with
`kind='edit'` and an actor under the reserved `system:coupon-claim:` prefix.
Application grants in
`db/grants.mjs` classify order_events as SELECT+INSERT, with neither UPDATE nor
DELETE. Existing application writes are append-only; customer timeline SQL
selects only status/refund-request, and never edit records. Admin note actions
choose kind=note and actor=admin:<authenticated id>; they cannot choose marker
kind/actor from input. General logEvent refuses the entire reserved prefix
as a defense against a future caller passing it accidentally. Reserved marker
records must be filtered out of the ordinary admin history projection so raw
JSON/generation IDs do not become product UI.

This is integrity against ordinary application inputs and the restricted runtime
role, not cryptographic protection from a DB owner, direct SQL privileges, a
compromised server or a deployment running modified code. No claim that the
current hosted runtime already has these restricted grants is made here.

## Modern state, created only on a new claim

Checkout and a genuinely newly applied admin coupon write, atomically with the
order/claim/counter, a validated reserved marker containing:

- Protocol/version and state: claimed or released.
- Immutable offer ID and exact redemption row ID for a claimed state. The
  pointed-to row must match the current order's code, normalized phone and
  email; those personal values are not copied into the append-only event.
- The order edit sequence at which the state was established (checkout 0).

No new copy of phone/email/authentication data is placed in order_events, which
is excluded from normal personal-data redaction. offer_redemptions has
SELECT/INSERT/DELETE rather than UPDATE under the app grant matrix, so a phone
move deletes its old record and inserts the new record with a new marker.

The latest event under the ENTIRE reserved prefix by ID is the authoritative state. It must validate
strictly and match the current order/one exact ledger record. Every mutation
checks that same latest-event ID after its existing order CAS/status guard.
Unknown future versions and malformed/missing/replaced state are not inferred from timestamps, counter
equality, current code matches or an older valid marker. A malformed latest
marker never falls back to an earlier marker. A released marker requires no
redemption and no order coupon before a new claim may start.

Legacy means an existing nonempty order coupon without that durable state.
It remains legacy even if its one record and all current counters look normal.
No marker is adopted/backfilled from existing order/redemption rows.

## Edit behavior

- Address/city/notes only, same normalized phone/code and actual basket: preserve
  all agreed money and leave claim/counter untouched. Works for legacy, expired,
  disabled, deleted or inconsistent offers. A phone spelling change normalizing
  to the existing identity does not move a claim. Submitted unchanged quantities
  and unchanged code do not turn a correction/no-op into a requote.
- Any actual coupon/basket/phone mutation involving a legacy/malformed claim
  refuses an explicit coupon-history review response before writes. Nothing is
  repaired or guessed. A no-coupon order with stray legacy ledger records also
  refuses a coupon-sensitive change.
- None to a new coupon: current quoted ID, type/value/minimum/per-phone policy,
  inclusive transaction-time window, active state and caps are guarded. Exactly
  one new record, +1 counter and durable marker commit together.
- Modern A to B/removal: return exactly A's generation by its durable ID, remove
  its exact record and claim B/-1/+1 or release/-1 in one batch. If A's row is
  deleted, remove its known record but never decrement a same-code replacement.
  New B failure restores the complete old A state.
- Modern phone move: preserve all money and global count. Use the existing
  original offer ID (including an expired/disabled row) to serialize, then check
  the current destination-phone limit and reallocate a monotonic slot. The
  existing self-claim is excluded from its own count. If that original generation
  is deleted, refuse review because its current policy/serialization row is
  unavailable; do not borrow the replacement generation's limits.
- Modern unchanged-coupon basket change: existing intended repricing may use the
  same original offer generation, with quote terms pinned through the write.
  Expiry/active/global-full/self-per-phone-full do not spend the old claim again.
  Deleted/recreated generation or unavailable original terms refuses review.

All same-generation per-phone counts must include modern claims by durable offer
ID even if the offer's code was renamed. Unknown legacy rows with the current
code may be counted conservatively, but never adopted or decremented. Merely
counting code would lose renamed modern claims. All relevant generation rows
lock in a preceding statement before count/claim statements, allowing a fresh
READ COMMITTED snapshot after waiting. Existing checkout UPDATE already provides
its preceding serialization; do not add an invented advisory-lock fix.

Conservative enforcement-origin evidence is separate from strict mutation-state
proof. A canonical immutable v1 claimed marker pointing to this exact surviving
redemption ID/order continues to count for its known generation after contact
redaction, malformed latest state or an unknown latest protocol version. This
adds a conservative count only; it never adopts an older marker for edits or
restores contact data. Deleted records are not counted through old markers, and
unknown legacy code-renaming history is not reconstructed.

Keep order CAS first, sorted stock movement, editable statuses, agreed surviving
line prices, audit ownership, permissions/CSRF and post-commit mail boundaries.
Use a bounded conflict for slot unique collision/overflow, not an uncaught partial
edit. No extra use or notification for an unchanged order.

## Cancellation, including legacy

The final root-QA direction accepts bounded legacy cancellation. The existing
status guard plus captured edit-sequence CAS remain first and authoritative;
the latest reserved-prefix event is checked after that per-order serialization.
A repeated/concurrent cancel cannot return stock or claims twice.

- Valid modern claim: release the exact known ledger record and return only its
  durable offer ID. If the original generation is deleted, release the known
  record without changing any same-code replacement counter.
  Known absence alone produces no nonpositive-counter review flag; replacement
  counters of zero or seven are equally unrelated to that original generation.
- Existing modern generation with a nonpositive counter: leave that counter
  unchanged, release the exact known claim and complete ordinary cancellation,
  stock and audit. Append a private review note and return couponReviewNeeded
  from the transaction result. No post-commit read determines this flag. A
  coupon-sensitive EDIT still refuses an inconsistent return unchanged.
- Legacy/malformed/missing/duplicate/ambiguous state: legitimate cancellation,
  status, stock and ordinary audit may commit. Delete only redemption rows owned
  by this cancelled order. Skip every guessed same-code counter decrement and
  append one private human-readable review note, without personal data or a
  fabricated modern claim marker. Historical use may remain conservatively
  overstated; no universal reconciliation or repair is claimed.
- A valid modern release appends a released marker. Released means no ACTIVE
  ledger claim; a terminal cancelled order retains its historical coupon,
  discount and money. This is not a reason to reject a replay or adopt legacy
  provenance.

Coupon-sensitive legacy EDITS still refuse with all state unchanged. This may
legitimately delay a phone/coupon/basket correction; address/city/notes and a
same-normalized-phone correction remain available. No other-order cleanup,
bulk historical repair, schema or provider mutation is authorized.

## Scope and acceptance

The schema-free implementation changes order-edit, checkout, order-status,
one minimal shared claim helper, the new admin history-review flash mapping and
focused real-PG fixtures. No schema/contract/grants/gates/provider changes.
Legacy identity cannot be recovered heuristically.

## Retention and rollback boundaries

No marker contains phone, email, address, authentication/token material or a
session key. If retention has blanked an identity, the old ledger cannot be
used to restore it: a claim-changing edit refuses review, and an unrelated
address correction writes no old phone/email back into the order. Customer SQL
projects only public status/refund events; admin SQL filters the entire reserved
actor prefix, including unknown versions. Review notes remain private and
human-readable in the admin history.

This additive event protocol does not break the old schema, but an older
deployment ignores these markers and retains its old code-only coupon writers.
Rolling back to such a writer after modern claims exist is NOT semantically safe:
it may corrupt counters or leave stale provenance. Before any publication,
provide a compatible rollback artifact or a deliberate maintenance/writer-
isolation plan. Do not strip markers, infer legacy generations or repair history
automatically. Existing idempotent stored replies still replay before any new
claim write. Published f5ae has not been changed by this local work.

Tests must cover the independent matrix at
`C:/Users/IGIPS/Documents/Codex/2026-10-31/task-2/qa-scratch/N7-ADMIN-LEDGER-ACCEPTANCE-20261101.md`,
including real two-connection schedules if a safe owned loopback runtime is used.
Single-backend schedules alone must not be labeled concurrency proof. Any
checkout and cancellation changes require independent review before publication;
published f5ae checkout stays unaffected by this local proposal.
