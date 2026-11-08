import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { store, bus } from './store.js';
import { VENDORS, CATEGORIES } from './catalog.js';
import * as flow from './orchestrator.js';
import { verifyWebhook } from './paypal/webhooks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ─── Read APIs ───
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) =>
  res.json({
    aiMode: config.ai.mode,
    aiModel: config.ai.mode === 'claude' ? config.ai.model : null,
    paypalMode: config.paypal.mode,
    paypalClientId: config.paypal.mode === 'mock' ? null : config.paypal.clientId, // public client id only
    categories: CATEGORIES,
  }),
);

app.get('/api/state', (_req, res) =>
  res.json({
    policy: store.policy,
    requests: store.listRequests().slice(0, 50),
    deals: store.listDeals(),
    audit: store.listAudit().slice(0, 1000),
  }),
);

app.get('/api/vendors', (_req, res) =>
  res.json(VENDORS.map(({ floorPct, paypalEmail, ...v }) => v)), // never leak the hidden floor
);

// Server-sent events: the UI re-fetches state on change (debounced client side).
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  bus.on('change', send);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('change', send);
  });
});

// ─── Commands ───
app.post('/api/requests', (req, res) => {
  const body = z.object({ text: z.string(), requestedBy: z.string().max(80).optional() }).parse(req.body);
  res.status(202).json(flow.submitRequest(body));
});

const PolicyPatch = z
  .object({
    monthlyBudget: z.number().positive(),
    perOrderCap: z.number().positive(),
    requireHumanAbove: z.number().nonnegative(),
    minVendorRating: z.number().min(0).max(5),
    maxDeliveryDays: z.number().int().positive(),
    minVerifierConfidence: z.number().min(0).max(1),
    allowedCategories: z.array(z.enum(CATEGORIES)),
    blockedVendors: z.array(z.string()),
  })
  .partial()
  .strict();
app.put('/api/policy', (req, res) => {
  const patch = PolicyPatch.parse(req.body);
  const p = store.setPolicy(patch);
  store.audit({ agent: 'human', action: 'policy_updated', detail: JSON.stringify(patch), actor: 'admin' });
  res.json(p);
});

const Actor = z.object({ by: z.string().max(80).optional(), note: z.string().max(500).optional() });
app.post('/api/deals/:id/approve', (req, res) => res.json(flow.approveDeal(req.params.id, Actor.parse(req.body ?? {}))));
app.post('/api/deals/:id/reject', (req, res) => res.json(flow.rejectDeal(req.params.id, Actor.parse(req.body ?? {}))));

app.post('/api/deals/:id/paypal/order', ah(async (req, res) => res.json(await flow.createPaypalOrder(req.params.id))));
app.post(
  '/api/deals/:id/paypal/authorize',
  ah(async (req, res) => {
    const { orderId } = z.object({ orderId: z.string() }).parse(req.body);
    res.json(await flow.authorizeEscrow(req.params.id, orderId));
  }),
);

app.post(
  '/api/deals/:id/delivery',
  ah(async (req, res) => {
    const body = z
      .object({
        proof: z.string().max(5000),
        submittedBy: z.string().max(80).optional(),
        image: z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']), data: z.string().max(5_500_000) }).optional(),
      })
      .parse(req.body);
    res.json(await flow.submitDelivery(req.params.id, body));
  }),
);

app.post(
  '/api/deals/:id/review',
  ah(async (req, res) => {
    const body = z.object({ decision: z.enum(['release', 'partial', 'reject']), releasePct: z.number().optional(), by: z.string().optional() }).parse(req.body);
    res.json(await flow.resolveReview(req.params.id, body));
  }),
);

// PayPal webhooks (configure in the PayPal developer dashboard → your app → Webhooks).
app.post(
  '/api/webhooks/paypal',
  ah(async (req, res) => {
    const ok = await verifyWebhook(req.headers, req.body);
    if (!ok) {
      store.audit({ agent: 'webhook', action: 'signature_rejected', detail: `Unverified event ${req.body?.event_type ?? '?'} dropped` });
      return res.status(400).json({ error: 'invalid signature' });
    }
    res.json(flow.applyWebhook(req.body));
  }),
);

app.post('/api/demo/reset', (_req, res) => {
  store.reset();
  res.json({ ok: true });
});

// ─── Static frontend (production build) ───
const dist = path.resolve(here, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('/{*splat}', (req, res, next) => (req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html'))));
}

// ─── Errors ───
app.use((err, _req, res, _next) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, debugId: err.debugId });
});

app.listen(config.port, () => {
  console.log(`EscrowPilot API on http://localhost:${config.port}  (AI: ${config.ai.mode}, PayPal: ${config.paypal.mode})`);
});
