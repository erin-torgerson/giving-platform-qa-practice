# Answer key — open only after your session

The reference suite in this folder has **120 tests**. Run against the code exactly as handed to
you, **10 of them fail**, and every one of those failures is one of the three planted bugs below.
Nothing else in the code is known to be broken.

## 1. Check yourself

```bash
# From the project root. Reference unit suite: expect 10 failures / 110 passes before fixes.
npx vitest run --config .solutions/vitest.config.ts

# Reference negative-path e2e (4 tests, all pass against the current page).
npx playwright test --config .solutions/playwright.config.ts

# Your own suite must still be green.
npm test && npm run test:e2e
```

Then:

1. For each bug below — did your tests catch it? Catching **one** in a 60-minute session is a
   good result; catching the refund one is the strongest signal, because it is pure reading.
2. Compare your tests with `.solutions/tests/*.test.ts` by *class of case*, not line by line
   (see section 3).
3. Apply the fixes in section 2, rerun the reference suite → 120/120. Rerun yours → still green.

## 2. Planted bugs

### Bug 1 — `src/fees.ts`: float drift in the percentage fee

| | |
|---|---|
| Where | `const rate = schedule.percent / 100; const percentFee = Math.round(amount * rate);` |
| Symptom | `500 * (2.9 / 100)` is `14.499999999999998` in IEEE-754, so `$5.00` at 2.9 % rounds to **14¢** instead of 15¢; total fee 44 instead of 45. Same for $75.00, $85.00, $145.00, $155.00, $165.00, $175.00 (every exact-half-cent amount under $200). |
| Catching tests | `fees.test.ts` → "rounds half-up: $5.00 …" and the 7-case `it.each` |
| Fix | Do the division last, or better, work in integer basis points: |

```ts
const basisPoints = Math.round(schedule.percent * 100);           // 2.9 % → 290
const percentFee = Math.round((amount * basisPoints) / 10_000);   // exact integer math
```

Why it matters: fees are reconciled against the processor to the cent. One cent of drift on a
handful of amounts turns into a nightly reconciliation failure that someone has to chase.
How you find it: the doc comment says "rounded half-up"; the obvious test is an amount that
lands on exactly .5. 2.9 % of $5.00 is 14.5¢.

### Bug 2 — `src/refunds.ts`: over-refund check compares against the original, not the remainder

| | |
|---|---|
| Where | `if (refundAmount > donation.amount)` |
| Symptom | $10.00 donation → refund $6.00 (ok) → refund $6.00 again → **accepted**. `refundedAmount` becomes 1200, status flips to `refunded`, and $2.00 of someone else's money has gone out the door. |
| Catching test | `refunds.test.ts` → "rejects partial refunds whose total would exceed the original" |
| Fix | `if (refundAmount > remaining)` |

Note the error message already says `only ${remaining} is still refundable` — the message is
right and the condition is wrong. Reading an error message and asking "is that actually what the
`if` checks?" is exactly how you find this class of bug.

### Bug 3 — `src/api.ts`: idempotency keys are not scoped per church

| | |
|---|---|
| Where | `idempotency.get(idempotencyKey)` / `idempotency.set(idempotencyKey, …)` |
| Symptom | The doc comment on `createApi` promises "Keys are scoped per church". They aren't. Grace Fellowship posts with key `k1`; Hillside posts its own donation with `k1` and gets **409 IDEMPOTENCY_CONFLICT** (or, with an identical body, Grace's donation back). A multi-tenant collision. |
| Catching test | `api.test.ts` → "scopes keys per church, as the doc comment promises" |
| Fix | key the map by `${input.churchId}:${idempotencyKey}` in both `get` and `set` |

How you find it: the README task says "test the idempotency key"; the doc comment lists four
promises (replay returns same response, different body → 409, per-church scope, failures not
remembered). Write one test per promise. The third one fails.

## 3. Gaps that were planted, and a good test for each

### `tests/donations.test.ts` — happy path only

| Gap | Good test |
|---|---|
| Amount validation | `it.each([0, -1, -2500])` → `INVALID_AMOUNT`; `it.each([10.5, NaN, Infinity])` for non-integers; `amount: 1` accepted (boundary) |
| Currency allowlist | `'EUR'`, lower-case `'usd'`, `''`, `'USD '` rejected; `it.each(SUPPORTED_CURRENCIES)` accepted |
| Required fields | blank / whitespace `churchId` and `donorId` → `MISSING_FIELD` |
| Recurring | unknown interval → `INVALID_RECURRING`; `undefined` and `null` both mean one-time |
| Error contract | the thrown error is a `DonationError` with a `.code` — assert on the code, not the message |
| `settleDonation` | pending → settled; does not mutate input; no-op on settled; does not reopen refunded |
| Determinism | the injected `now` / `newId` are actually used |

### `tests/fees.test.ts` — round numbers only

| Gap | Good test |
|---|---|
| Exact half cents | `$5.00` → 45¢ (bug 1) |
| Round-down / round-up pairs | 250¢ → 7.25 → 7; 750¢ → 21.75 → 22 |
| Invariant | `fee + net === amount` for every amount 0..10 000 — a cheap property test |
| Floor | 0¢ and 1¢ still pay the 30¢ flat fee |
| Negative net | `calculateFee(10)` → `net: -20` — pin it **and ask**: is there a minimum gift? |
| Schedules | percent-only, zero schedule, 100 %, negative values rejected |
| Invalid input | -1, 10.5, NaN, Infinity → `RangeError` |

### `tests/ledger.test.ts` — no `reconcile`, no `record` validation

| Gap | Good test |
|---|---|
| `record` rejects duplicate ids and leaves the ledger unchanged | |
| `record` rejects 0 / negative / fractional amounts | |
| `occurredAt` defaults from the clock | |
| Stored entry is a copy (input mutation doesn't leak) | |
| `balanceFor` subtracts payouts; can go negative | |
| `reconcile` agree → `[]`; order-independent; empty inputs | |
| `reconcile` missing / duplicate (with count, incl. triplicates) / amount-differs (expected = source, actual = ledger) | |
| `reconcile` several kinds at once, in the documented order | |
| `reconcile` pins the *unspecified* behaviour and raises it: ledger-only entries not reported; matches on id only; duplicate with a different second copy | |

### `tests/refunds.test.ts` — one full refund

| Gap | Good test |
|---|---|
| Partial → `partially_refunded`, `refundedAmount` tracked, refund record shape | |
| Two partials summing to the original → `refunded` | |
| No amount after a partial → refunds exactly the remainder | |
| Single over-refund → `EXCEEDS_REFUNDABLE` | |
| **Cumulative over-refund** → `EXCEEDS_REFUNDABLE` (bug 2) | |
| Exactly the remainder is allowed (boundary) | |
| Second full refund → `ALREADY_REFUNDED`; any refund after partials total 100 % → `ALREADY_REFUNDED` | |
| Pending → `NOT_SETTLED`; unknown id → `NOT_FOUND` | |
| 0 / negative / fractional / NaN amount → `INVALID_AMOUNT` | |
| A rejected refund leaves the donation untouched | |

### `src/api.ts` — nothing at all

| Gap | Good test |
|---|---|
| `POST /donations` 201 shape: settled donation, `fee: 103`, `net: 2397` for $25 | |
| Ledger gets a `donation` and a `fee` entry; balance = net | |
| 400 + code for bad amount / currency; `INVALID_BODY` for non-object bodies (`it.each([undefined, null, 'text', 42, []])`) | |
| Failed validation writes nothing | |
| Extra fields ignored; trailing slash and query string tolerated | |
| Idempotency: replay → identical response, one donation, one pair of ledger entries | |
| Idempotency: same key + different body → 409 | |
| Idempotency: no key → two donations | |
| Idempotency: header name case-insensitive | |
| Idempotency: rejected request is not remembered → retry with corrected body succeeds | |
| **Idempotency: per-church scope** (bug 3) | |
| Idempotency: field order in the body doesn't matter; empty key = no key | |
| `POST /refunds`: partial lowers balance by the refund only; full refund leaves balance at `net − amount` (fees not returned) | |
| `POST /refunds`: 404 unknown, 409 double refund, 400 over-refund, 400 missing `donationId`; rejected refund writes no ledger entry | |
| `GET /churches/:id/balance`: 0 for unknown church; URL-decoded id | |
| Routing: 404 unknown path; 404 wrong method | |

### `e2e/donate.spec.ts` — happy path only

| Gap | Good test |
|---|---|
| Zero amount → `role=status` has `data-state="error"`, friendly message, no "Thank you", button re-enabled | |
| Empty amount → error | |
| Negative amount → error and the field keeps its value | |
| Hit the API directly with Playwright's `request` fixture: 400 + `INVALID_AMOUNT` | |

## 4. Things worth saying out loud or asking the interviewer

These are not bugs, but a strong candidate names them:

- `calculateFee(10)` returns `net: -20`. Is there a minimum gift? Where should it live — `createDonation` or the API?
- `reconcile()` is one-directional: ledger entries the processor never reported are silently ignored. Real reconciliation flags those ("unexpected") too.
- `reconcile()` does not detect duplicates *inside the source*.
- `Ledger.balanceFor` sums across currencies. A church receiving USD and CAD gets a meaningless number.
- Refunds never return fees — confirm the policy. The ledger refund entry is for the refund amount only.
- Idempotency keys never expire and live in a `Map`. Fine here; in production: TTL, shared storage, and what happens on a 5xx mid-request.
- The idempotency cache returns the stored response *object by reference*. A caller that mutates it corrupts the cache.
- `recurring` is stored but nothing schedules the next charge. Out of scope — but say so.
- `settleDonation` silently returns a refunded donation unchanged. Is silent the right behaviour?
- `GET /churches/:id/balance` returns 200 with 0 for a church that does not exist. 404 might be more honest.

## 5. What they are probably scoring

1. **Did you read before writing?** Ten minutes on the code and the existing tests, then one clarifying question ("Is the processor report authoritative for `reconcile`?" / "Are fees refunded?").
2. **Did you use what was there?** `tests/helpers.ts` has `buildSettledDonation`, `storeWith`, `entry`, `fixedClock`, `resetIds`. Reaching for them instead of re-creating fixtures shows you read the suite.
3. **Case taxonomy.** For every numeric input: zero, negative, non-integer, NaN, the exact boundary, and one past it. For every state machine: each transition, each illegal transition.
4. **One behaviour per test, named as a sentence.** `it('rejects partial refunds whose total would exceed the original')` beats `it('refund test 3')`.
5. **Run after every test.** Watch mode in the terminal. Red → green → next.
6. **Report, don't fix.** When a test goes red against the code: "this looks like a bug in `refund()` — the check uses `donation.amount` where I'd expect `remaining`. Want me to fix it or leave it red and move on?"
7. **Prioritise out loud.** "Reconcile has zero tests and the README says the processor report is money-critical, so I'm starting there."
8. **Pin unspecified behaviour and flag it.** A test named `(pin and ask)` is a legitimate deliverable.
