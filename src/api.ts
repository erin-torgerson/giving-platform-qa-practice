import {
  createDonation,
  settleDonation,
  DonationError,
  InMemoryDonationStore,
  type DonationInput,
  type DonationStore,
} from './donations';
import { calculateFee, type FeeSchedule } from './fees';
import { Ledger, LedgerError } from './ledger';
import { RefundError, RefundService } from './refunds';

export type HttpMethod = 'GET' | 'POST';

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  body?: unknown;
  /** Header names are matched case-insensitively. */
  headers?: Record<string, string | undefined>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface ApiOptions {
  feeSchedule?: FeeSchedule;
  now?: () => Date;
  newId?: () => string;
}

export interface Api {
  handle(request: ApiRequest): ApiResponse;
  /** Exposed for tests and the dev server; production code would not reach in here. */
  readonly donations: DonationStore;
  readonly ledger: Ledger;
}

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = { percent: 2.9, flat: 30 };

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * A tiny in-memory, HTTP-shaped API over the giving modules.
 *
 *   POST /donations                     body { amount, currency, churchId, donorId, recurring? }
 *                                       header Idempotency-Key (optional)
 *   POST /refunds                       body { donationId, amount? }
 *   GET  /churches/:churchId/balance
 *
 * Errors come back as { error: { code, message } } with 400 (validation),
 * 404 (unknown route or donation) or 409 (state conflicts).
 *
 * Idempotency on POST /donations: when the request carries an `Idempotency-Key`, the first
 * successful response is remembered and replaying the same key returns that exact response
 * without creating a second donation. Reusing a key with a different body is rejected with
 * 409 IDEMPOTENCY_CONFLICT. Keys are scoped per church, so two churches may use the same key
 * independently. Only successful responses are remembered — a request that was rejected can
 * be retried under the same key.
 */
export function createApi(options: ApiOptions = {}): Api {
  const feeSchedule = options.feeSchedule ?? DEFAULT_FEE_SCHEDULE;
  const now = options.now ?? (() => new Date());
  const donations = new InMemoryDonationStore();
  const ledger = new Ledger(now);
  const refunds = new RefundService(donations, { now, newId: options.newId });
  const idempotency = new Map<string, { fingerprint: string; response: ApiResponse }>();

  function handle(request: ApiRequest): ApiResponse {
    const headers = normalizeHeaders(request.headers);
    const path = normalizePath(request.path);
    try {
      if (request.method === 'POST' && path === '/donations') {
        return postDonation(request.body, headers['idempotency-key']);
      }
      if (request.method === 'POST' && path === '/refunds') {
        return postRefund(request.body);
      }
      const balance = /^\/churches\/([^/]+)\/balance$/.exec(path);
      if (request.method === 'GET' && balance) {
        return getBalance(decodeURIComponent(balance[1]));
      }
      throw new HttpError(404, 'NOT_FOUND', `no route for ${request.method} ${path}`);
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  function postDonation(body: unknown, idempotencyKey: string | undefined): ApiResponse {
    const input = pickDonationInput(body);
    const fingerprint = stableStringify(input);

    if (idempotencyKey) {
      const previous = idempotency.get(idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw new HttpError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency-Key was already used with a different request body',
          );
        }
        return previous.response;
      }
    }

    const donation = settleDonation(createDonation(input, { now, newId: options.newId }));
    const { fee, net } = calculateFee(donation.amount, feeSchedule);

    donations.save(donation);
    ledger.record({
      id: donation.id,
      churchId: donation.churchId,
      type: 'donation',
      amount: donation.amount,
      occurredAt: donation.createdAt,
    });
    if (fee > 0) {
      ledger.record({
        id: `${donation.id}:fee`,
        churchId: donation.churchId,
        type: 'fee',
        amount: fee,
        occurredAt: donation.createdAt,
      });
    }

    const response: ApiResponse = { status: 201, body: { donation, fee, net } };
    if (idempotencyKey) {
      idempotency.set(idempotencyKey, { fingerprint, response });
    }
    return response;
  }

  function postRefund(body: unknown): ApiResponse {
    const { donationId, amount } = pickRefundInput(body);
    const refund = refunds.refund(donationId, amount);
    // refund() has already verified the donation exists
    const donation = donations.get(donationId)!;
    ledger.record({
      id: refund.id,
      churchId: donation.churchId,
      type: 'refund',
      amount: refund.amount,
      occurredAt: refund.createdAt,
    });
    return { status: 201, body: { refund, donation } };
  }

  function getBalance(churchId: string): ApiResponse {
    return { status: 200, body: { churchId, balance: ledger.balanceFor(churchId) } };
  }

  return { handle, donations, ledger };
}

function pickDonationInput(body: unknown): DonationInput {
  if (!isRecord(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'request body must be a JSON object');
  }
  return {
    amount: body.amount as number,
    currency: body.currency as string,
    churchId: body.churchId as string,
    donorId: body.donorId as string,
    recurring: (body.recurring ?? null) as DonationInput['recurring'],
  };
}

function pickRefundInput(body: unknown): { donationId: string; amount: number | undefined } {
  if (!isRecord(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'request body must be a JSON object');
  }
  if (typeof body.donationId !== 'string' || body.donationId.length === 0) {
    throw new HttpError(400, 'INVALID_BODY', 'donationId is required');
  }
  const amount = body.amount === undefined || body.amount === null ? undefined : (body.amount as number);
  return { donationId: body.donationId, amount };
}

function toErrorResponse(err: unknown): ApiResponse {
  if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
  if (err instanceof DonationError) return errorResponse(400, err.code, err.message);
  if (err instanceof RefundError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'ALREADY_REFUNDED' || err.code === 'NOT_SETTLED' ? 409
      : 400;
    return errorResponse(status, err.code, err.message);
  }
  if (err instanceof LedgerError) return errorResponse(500, err.code, err.message);
  if (err instanceof RangeError) return errorResponse(400, 'INVALID_AMOUNT', err.message);
  return errorResponse(500, 'INTERNAL', err instanceof Error ? err.message : 'unknown error');
}

function errorResponse(status: number, code: string, message: string): ApiResponse {
  const body: ApiErrorBody = { error: { code, message } };
  return { status, body };
}

function normalizeHeaders(headers: ApiRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
  }
  return out;
}

function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? path;
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** JSON.stringify with object keys sorted, so field order does not change the fingerprint. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
