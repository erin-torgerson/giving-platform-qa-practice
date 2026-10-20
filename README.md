# giving-platform

A small church giving platform, in-memory only: donations, fees, a ledger with
reconciliation, refunds, and a thin HTTP-shaped API with a static donation page on top.
No database, no framework. All money is in **integer cents**.

## Run it

```bash
npm test                # unit suite (Vitest), once
npm run test:watch      # unit suite in watch mode
npm run test:e2e        # Playwright; starts the dev server for you
npm run test:e2e:ui     # Playwright's interactive runner
npm run typecheck       # tsc --noEmit  (Vitest does not type-check)
npm run serve           # dev server at http://localhost:4173
```

Dependencies are already installed. Run one file with `npx vitest run tests/fees.test.ts`,
one test by name with `npx vitest run -t "rounding"`.

## Layout

```
src/
  donations.ts   createDonation() validation + statuses, settleDonation(), InMemoryDonationStore
  fees.ts        calculateFee(amount, { percent, flat }) → { fee, net }
  ledger.ts      Ledger.record() / balanceFor(), reconcile(source, ledger) → mismatches
  refunds.ts     RefundService.refund(donationId, amount?) — full and partial refunds
  api.ts         createApi().handle({ method, path, body, headers }) — POST /donations,
                 POST /refunds, GET /churches/:id/balance; Idempotency-Key on POST /donations
server.ts        node:http adapter: serves web/ and forwards /api/* to api.ts
web/             the donation form (index.html, app.js, styles.css)
tests/           Vitest unit tests + tests/helpers.ts fixtures
e2e/             Playwright tests (run against server.ts)
```

## Domain notes

- Fee schedule used by the API: **2.9% + 30¢**. The percentage part is rounded half-up to
  the cent, then the flat part is added. `fee + net === amount`.
- Donation statuses: `pending` → `settled` → `partially_refunded` → `refunded`.
  The API settles immediately after creating (there is no real processor).
- Ledger entry types: `donation` credits a church; `fee`, `refund`, `payout` debit it.
  Entry ids are unique. Donation entries use the donation id, fee entries `${donationId}:fee`.
- `reconcile(source, ledger)` treats the source (e.g. a processor settlement report) as
  authoritative and reports `missing`, `duplicate` and `amount-differs`.
- Refunds never return processing fees.

---

## Your task

> Here's a service one of our teams owns. The test suite exists but it's thin. Take ten minutes
> to read the code and the tests — ask me anything. Then extend the suite:
>
> 1. **Reconciliation** — `reconcile()` has no tests at all.
> 2. **Refund edge cases** — partial refunds, over-refunds, refunding twice, whatever else you'd worry about.
> 3. **Fee rounding** — the current tests only use round numbers.
> 4. **The idempotency key** on `POST /donations` — it's implemented, nobody has tested it.
> 5. **One negative-path e2e test** for the donation form.
>
> Use the existing helpers and structure where they fit. Run the tests as you go. If you find a
> bug, tell me — don't fix it silently. Think out loud; I care more about how you decide what to
> test than about finishing every item.

Suggested time box: 60 minutes. Commit as you go (`git init` is already done).

When you are done, the answer key is in `.solutions/SOLUTIONS.md`. It is hidden from the
Cursor file explorer; open it from the terminal with `cat .solutions/SOLUTIONS.md`.
