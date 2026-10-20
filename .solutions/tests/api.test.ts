import { describe, it, expect, beforeEach } from 'vitest';
import { createApi, type Api, type ApiErrorBody } from '../../src/api';
import type { Donation } from '../../src/donations';
import { fixedClock, GRACE, HILLSIDE } from '../../tests/helpers';

interface DonationResponse {
  donation: Donation;
  fee: number;
  net: number;
}

const VALID = { amount: 2500, currency: 'USD', churchId: GRACE, donorId: 'donor_erin' };

describe('API', () => {
  let api: Api;

  const give = (overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    api.handle({ method: 'POST', path: '/donations', body: { ...VALID, ...overrides }, headers });

  const refund = (body: unknown) => api.handle({ method: 'POST', path: '/refunds', body });

  const balance = (churchId: string) =>
    api.handle({ method: 'GET', path: `/churches/${churchId}/balance` }).body as { balance: number };

  beforeEach(() => {
    api = createApi({ now: fixedClock });
  });

  describe('POST /donations', () => {
    it('returns 201 with a settled donation and the fee breakdown', () => {
      const response = give();
      const body = response.body as DonationResponse;

      expect(response.status).toBe(201);
      expect(body.donation).toMatchObject({ ...VALID, status: 'settled', refundedAmount: 0 });
      expect(body.fee).toBe(103); // 2500 × 2.9% = 72.5 → 73, + 30
      expect(body.net).toBe(2397);
    });

    it('records the donation and its fee so the church balance is the net amount', () => {
      give();
      expect(balance(GRACE).balance).toBe(2397);
      expect(api.ledger.all().map((e) => e.type)).toEqual(['donation', 'fee']);
    });

    it('returns 400 with the validation code for a bad amount', () => {
      const response = give({ amount: -5 });
      expect(response.status).toBe(400);
      expect((response.body as ApiErrorBody).error.code).toBe('INVALID_AMOUNT');
    });

    it('returns 400 UNSUPPORTED_CURRENCY', () => {
      const response = give({ currency: 'EUR' });
      expect(response.status).toBe(400);
      expect((response.body as ApiErrorBody).error.code).toBe('UNSUPPORTED_CURRENCY');
    });

    it.each([undefined, null, 'text', 42, []])('returns 400 INVALID_BODY for body %j', (body) => {
      const response = api.handle({ method: 'POST', path: '/donations', body });
      expect(response.status).toBe(400);
      expect((response.body as ApiErrorBody).error.code).toBe('INVALID_BODY');
    });

    it('does not touch the ledger or the store when validation fails', () => {
      give({ amount: 0 });
      expect(api.ledger.all()).toEqual([]);
      expect(api.donations.all()).toEqual([]);
    });

    it('ignores extra fields in the body', () => {
      expect(give({ note: 'for the roof' }).status).toBe(201);
    });

    it('tolerates a trailing slash and a query string', () => {
      expect(api.handle({ method: 'POST', path: '/donations/', body: VALID }).status).toBe(201);
      expect(api.handle({ method: 'POST', path: '/donations?x=1', body: VALID }).status).toBe(201);
    });
  });

  describe('POST /donations — Idempotency-Key', () => {
    it('replaying the same key returns the identical response and creates one donation', () => {
      const first = give({}, { 'idempotency-key': 'k1' });
      const replay = give({}, { 'idempotency-key': 'k1' });

      expect(replay).toEqual(first);
      expect((replay.body as DonationResponse).donation.id).toBe((first.body as DonationResponse).donation.id);
      expect(api.donations.all()).toHaveLength(1);
      expect(api.ledger.all()).toHaveLength(2);
      expect(balance(GRACE).balance).toBe(2397);
    });

    it('rejects the same key with a different body with 409 IDEMPOTENCY_CONFLICT', () => {
      give({}, { 'idempotency-key': 'k1' });
      const conflict = give({ amount: 9999 }, { 'idempotency-key': 'k1' });

      expect(conflict.status).toBe(409);
      expect((conflict.body as ApiErrorBody).error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(api.donations.all()).toHaveLength(1);
    });

    it('without a key, identical requests create separate donations', () => {
      give();
      give();
      expect(api.donations.all()).toHaveLength(2);
      expect(balance(GRACE).balance).toBe(2 * 2397);
    });

    it('matches the header name case-insensitively', () => {
      give({}, { 'Idempotency-Key': 'k1' });
      give({}, { 'IDEMPOTENCY-KEY': 'k1' });
      expect(api.donations.all()).toHaveLength(1);
    });

    it('does not remember a rejected request, so the key can be retried with a corrected body', () => {
      const bad = give({ amount: 0 }, { 'idempotency-key': 'k1' });
      const good = give({ amount: 2500 }, { 'idempotency-key': 'k1' });

      expect(bad.status).toBe(400);
      expect(good.status).toBe(201);
      expect(api.donations.all()).toHaveLength(1);
    });

    // PLANTED BUG #3: fails until api.ts scopes the key by churchId.
    it('scopes keys per church, as the doc comment promises', () => {
      const grace = give({ churchId: GRACE }, { 'idempotency-key': 'k1' });
      const hillside = give({ churchId: HILLSIDE }, { 'idempotency-key': 'k1' });

      expect(grace.status).toBe(201);
      expect(hillside.status).toBe(201);
      expect(api.donations.all().map((d) => d.churchId).sort()).toEqual([GRACE, HILLSIDE].sort());
    });

    it('treats bodies with the same fields in a different order as identical', () => {
      api.handle({
        method: 'POST',
        path: '/donations',
        body: { amount: 2500, currency: 'USD', churchId: GRACE, donorId: 'donor_erin' },
        headers: { 'idempotency-key': 'k1' },
      });
      const reordered = api.handle({
        method: 'POST',
        path: '/donations',
        body: { donorId: 'donor_erin', churchId: GRACE, currency: 'USD', amount: 2500 },
        headers: { 'idempotency-key': 'k1' },
      });
      expect(reordered.status).toBe(201);
      expect(api.donations.all()).toHaveLength(1);
    });

    it('an empty key header behaves like no key', () => {
      give({}, { 'idempotency-key': '' });
      give({}, { 'idempotency-key': '' });
      expect(api.donations.all()).toHaveLength(2);
    });
  });

  describe('POST /refunds', () => {
    let donationId: string;

    beforeEach(() => {
      donationId = (give().body as DonationResponse).donation.id;
    });

    it('refunds part of a donation and lowers the balance by the refund only', () => {
      const response = refund({ donationId, amount: 500 });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        refund: { donationId, amount: 500 },
        donation: { status: 'partially_refunded', refundedAmount: 500 },
      });
      expect(balance(GRACE).balance).toBe(2397 - 500);
      expect(api.ledger.all().at(-1)).toMatchObject({ type: 'refund', amount: 500, churchId: GRACE });
    });

    it('refunds in full when amount is omitted', () => {
      const response = refund({ donationId });
      expect(response.body).toMatchObject({ donation: { status: 'refunded', refundedAmount: 2500 } });
      expect(balance(GRACE).balance).toBe(2397 - 2500); // fees are not returned
    });

    it('404 for an unknown donation', () => {
      const response = refund({ donationId: 'don_nope' });
      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe('NOT_FOUND');
    });

    it('409 for a second full refund', () => {
      refund({ donationId });
      const second = refund({ donationId });
      expect(second.status).toBe(409);
      expect((second.body as ApiErrorBody).error.code).toBe('ALREADY_REFUNDED');
    });

    it('400 when the refund exceeds the original', () => {
      const response = refund({ donationId, amount: 2501 });
      expect(response.status).toBe(400);
      expect((response.body as ApiErrorBody).error.code).toBe('EXCEEDS_REFUNDABLE');
    });

    it('400 INVALID_BODY when donationId is missing', () => {
      const response = refund({ amount: 100 });
      expect(response.status).toBe(400);
      expect((response.body as ApiErrorBody).error.code).toBe('INVALID_BODY');
    });

    it('does not write a ledger entry when the refund is rejected', () => {
      const before = api.ledger.all().length;
      refund({ donationId, amount: 99_999 });
      expect(api.ledger.all()).toHaveLength(before);
    });
  });

  describe('GET /churches/:id/balance', () => {
    it('is 0 for a church with no activity', () => {
      expect(balance('church_unknown')).toEqual({ churchId: 'church_unknown', balance: 0 });
    });

    it('URL-decodes the church id', () => {
      give({ churchId: 'first baptist' });
      expect(balance('first%20baptist').balance).toBe(2397);
    });
  });

  describe('routing', () => {
    it('404 for unknown routes', () => {
      const response = api.handle({ method: 'GET', path: '/nope' });
      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe('NOT_FOUND');
    });

    it('404 for a known path with the wrong method', () => {
      expect(api.handle({ method: 'GET', path: '/donations' }).status).toBe(404);
    });
  });
});
