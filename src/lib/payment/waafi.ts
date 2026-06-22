/**
 * WaafiPay Payment Gateway Integration
 * Docs: https://docs.waafipay.com/
 *
 * API_PURCHASE sends an STK push to the customer's phone and blocks until they
 * approve (PIN) or timeout (~90s). The response is the authoritative payment result.
 *
 * Env vars:
 *   WAAFI_API_URL        — https://api.waafipay.net/asm (production)
 *                          https://sandbox.waafipay.com/asm (sandbox)
 *   WAAFI_MERCHANT_UID   — merchantUid (e.g. M0914298)
 *   WAAFI_API_USER_ID    — apiUserId (e.g. 1008971)
 *   WAAFI_API_KEY        — apiKey
 *
 * NEVER enable fake/test approval in production — subscriptions must only activate
 * after a real APPROVED response with a provider transactionId.
 */

const WAAFI_PRODUCTION_URL = 'https://api.waafipay.net/asm';
const WAAFI_SANDBOX_URL = 'https://sandbox.waafipay.com/asm';

const WAAFI_API_URL = process.env.WAAFI_API_URL ?? WAAFI_PRODUCTION_URL;

const WAAFI_MERCHANT_UID = process.env.WAAFI_MERCHANT_UID ?? '';
const WAAFI_API_USER_ID = process.env.WAAFI_API_USER_ID ?? '';
const WAAFI_API_KEY = process.env.WAAFI_API_KEY ?? '';

const EVC_MERCHANT_UID = process.env.EVC_MERCHANT_UID ?? WAAFI_MERCHANT_UID;
const EVC_API_USER_ID = process.env.EVC_API_USER_ID ?? WAAFI_API_USER_ID;
const EVC_API_KEY = process.env.EVC_API_KEY ?? WAAFI_API_KEY;

export { WAAFI_PRODUCTION_URL, WAAFI_SANDBOX_URL };

export type PaymentProvider = 'waafi' | 'evc' | 'sahal' | 'zaad';

export interface WaafiPurchaseResult {
  /** True only when WAAFI returned responseCode 2001 AND state APPROVED with transactionId */
  approved: boolean;
  state: string;
  transactionId?: string;
  issuerTransactionId?: string;
  referenceId?: string;
  amountCharged?: number;
  responseCode?: string;
  responseMsg?: string;
  error?: string;
  rawResponse?: Record<string, unknown>;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('252')) return digits;
  if (digits.startsWith('0')) return '252' + digits.slice(1);
  return '252' + digits;
}

function getCredentials(provider: PaymentProvider) {
  if (provider === 'evc') {
    return { merchantUid: EVC_MERCHANT_UID, apiUserId: EVC_API_USER_ID, apiKey: EVC_API_KEY };
  }
  return { merchantUid: WAAFI_MERCHANT_UID, apiUserId: WAAFI_API_USER_ID, apiKey: WAAFI_API_KEY };
}

function waafiTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

interface WaafiApiResponse {
  schemaVersion?: string;
  responseCode?: string;
  errorCode?: string;
  responseMsg?: string;
  params?: {
    state?: string;
    transactionId?: string;
    issuerTransactionId?: string;
    referenceId?: string;
    txAmount?: string;
    accountNo?: string;
  };
}

/**
 * Calls WaafiPay API_PURCHASE — sends mobile popup and waits for customer PIN.
 * This is the ONLY source of payment truth. Never simulate approval.
 */
export async function callWaafiPurchase(params: {
  provider: PaymentProvider;
  phone: string;
  amountUsd: number;
  merchantReference: string;
  description?: string;
}): Promise<WaafiPurchaseResult> {
  const { provider, phone, amountUsd, merchantReference, description } = params;
  const { merchantUid, apiUserId, apiKey } = getCredentials(provider);

  if (!merchantUid || !apiUserId || !apiKey) {
    return {
      approved: false,
      state: 'FAILED',
      error: `${provider.toUpperCase()} payment credentials not configured.`,
    };
  }

  const payload = {
    schemaVersion: '1.0',
    requestId: crypto.randomUUID(),
    timestamp: waafiTimestamp(),
    channelName: 'WEB',
    serviceName: 'API_PURCHASE',
    serviceParams: {
      merchantUid,
      apiUserId,
      apiKey,
      paymentMethod: 'MWALLET_ACCOUNT',
      payerInfo: { accountNo: normalizePhone(phone) },
      transactionInfo: {
        referenceId: merchantReference,
        invoiceId: merchantReference,
        amount: amountUsd.toFixed(2),
        currency: 'USD',
        description: description ?? 'KULMIS ERP Subscription',
      },
    },
  };

  let response: Response;
  try {
    response = await fetch(WAAFI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WAAFI] Network error (${WAAFI_API_URL}):`, msg);
    return { approved: false, state: 'FAILED', error: `Cannot reach WaafiPay gateway: ${msg}` };
  }

  if (!response.ok) {
    return { approved: false, state: 'FAILED', error: `WaafiPay returned HTTP ${response.status}` };
  }

  let json: WaafiApiResponse;
  try {
    json = (await response.json()) as WaafiApiResponse;
  } catch {
    return { approved: false, state: 'FAILED', error: 'Invalid JSON from WaafiPay gateway' };
  }

  const state = (json.params?.state ?? '').toUpperCase();
  const responseCode = json.responseCode ?? '';
  const transactionId = json.params?.transactionId?.trim();
  const referenceId = json.params?.referenceId?.trim();
  const amountCharged = json.params?.txAmount ? parseFloat(json.params.txAmount) : undefined;

  // Strict approval: must have gateway success code, APPROVED state, real transactionId
  const approved =
    responseCode === '2001' &&
    state === 'APPROVED' &&
    !!transactionId &&
    transactionId.length > 0 &&
    !transactionId.startsWith('TEST-');

  // Merchant reference must match what we sent
  if (approved && referenceId && referenceId !== merchantReference) {
    return {
      approved: false,
      state: 'FAILED',
      transactionId,
      responseCode,
      responseMsg: json.responseMsg,
      error: 'Merchant reference mismatch — payment rejected for security',
      rawResponse: json as Record<string, unknown>,
    };
  }

  return {
    approved,
    state: state || 'FAILED',
    transactionId,
    issuerTransactionId: json.params?.issuerTransactionId,
    referenceId: referenceId ?? merchantReference,
    amountCharged,
    responseCode,
    responseMsg: json.responseMsg,
    error: approved ? undefined : (json.responseMsg ?? `Payment ${state || 'not approved'}`),
    rawResponse: json as Record<string, unknown>,
  };
}

/** Map WaafiPay state/response to our normalized payment status */
export function mapWaafiStateToStatus(state: string, responseCode?: string): string {
  const s = state.toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (['CANCELLED', 'USER_REJECTED'].includes(s) || responseCode === '5306') return 'cancelled';
  if (['TIMEOUT', 'EXPIRED'].includes(s) || responseCode === '5309') return 'expired';
  if (s === 'PENDING') return 'pending';
  return 'failed';
}
