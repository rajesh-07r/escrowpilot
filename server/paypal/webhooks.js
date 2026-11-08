import { config } from '../config.js';

let token = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch(`${config.paypal.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status}`);
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

/**
 * Verify a webhook via PayPal's verify-webhook-signature API.
 * Returns true/false; never throws for a bad signature.
 */
export async function verifyWebhook(headers, event) {
  if (config.paypal.skipWebhookVerify) return true;
  if (config.paypal.mode === 'mock' || !config.paypal.webhookId) return false;
  const res = await fetch(`${config.paypal.apiBase}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  const j = await res.json();
  return j.verification_status === 'SUCCESS';
}
