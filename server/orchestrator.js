/**
 * Deal lifecycle orchestrator.
 *
 *  request ──planner──▶ deal(s) ──negotiator──▶ PROPOSED ──policy──▶ BLOCKED
 *                                                            │
 *                                   AWAITING_APPROVAL ◀──────┤ (above human threshold)
 *                                            │ human         │
 *                                            ▼               ▼
 *                                         APPROVED ──PayPal checkout (AUTHORIZE)──▶ ESCROW_HELD
 *                                                                                      │ vendor proof
 *                                         verifier ──(low confidence)──▶ IN_REVIEW ──human──┐
 *                                            │                                              │
 *                                            ▼                                              ▼
 *                                  capture milestone ──▶ PARTIALLY_RELEASED … ──▶ RELEASED / VOIDED
 */
import { store, id, now } from './store.js';
import { plan } from './agents/planner.js';
import { negotiate } from './agents/negotiator.js';
import { verifyDelivery } from './agents/verifier.js';
import { heuristicPlan, heuristicVerify } from './agents/heuristics.js';
import { evaluatePolicy, milestoneAmounts } from './policy.js';
import * as paypal from './paypal/client.js';

export class FlowError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

// Per-deal mutex so double-clicks / webhook races can never double-capture.
const locks = new Set();
async function withLock(dealId, fn) {
  if (locks.has(dealId)) throw new FlowError('Another operation on this deal is in progress', 423);
  locks.add(dealId);
  try {
    return await fn();
  } finally {
    locks.delete(dealId);
  }
}

const mustGet = (dealId) => {
  const d = store.getDeal(dealId);
  if (!d) throw new FlowError(`Deal ${dealId} not found`, 404);
  return d;
};
const expect = (deal, ...statuses) => {
  if (!statuses.includes(deal.status)) throw new FlowError(`Deal ${deal.id} is ${deal.status}; expected ${statuses.join(' or ')}`);
};

// ───────────────────────────── 1. Intake + planning ─────────────────────────────
export function submitRequest({ text, requestedBy = 'buyer' }) {
  if (!text || text.trim().length < 5) throw new FlowError('Describe what you want to buy', 400);
  if (text.length > 4000) throw new FlowError('Request too long (max 4000 chars)', 400);
  const req = store.addRequest({ id: id('req'), text: text.trim(), requestedBy, status: 'PLANNING', createdAt: now(), dealIds: [] });
  store.audit({ agent: 'human', requestId: req.id, action: 'request_submitted', detail: req.text, actor: requestedBy });
  // Run the agent pipeline in the background; the UI follows along over SSE.
  runPipeline(req).catch((e) => {
    store.updateRequest(req.id, { status: 'FAILED', error: e.message });
    store.audit({ agent: 'system', requestId: req.id, action: 'pipeline_error', detail: e.message });
  });
  return req;
}

async function runPipeline(req) {
  let planned;
  try {
    planned = await plan(req.text);
  } catch (e) {
    store.audit({ agent: 'planner', requestId: req.id, action: 'fallback', detail: `AI planner failed (${e.message}); using heuristic planner` });
    planned = { plan: heuristicPlan(req.text), engine: 'heuristic' };
  }
  const p = planned.plan;
  store.audit({
    agent: 'planner',
    requestId: req.id,
    action: 'plan_created',
    detail: `${p.summary}. Milestones: ${p.milestones.map((m) => `${m.name} ${m.pct}%`).join(' / ')}${p.notes ? ` — ${p.notes}` : ''}`,
    engine: planned.engine,
    data: { plan: p, usage: planned.usage },
  });
  if (!p.items.length) {
    store.updateRequest(req.id, { status: 'NO_ITEMS', plan: p });
    return;
  }

  const deals = p.items.map((item) =>
    store.addDeal({
      id: id('po'),
      requestId: req.id,
      createdAt: now(),
      updatedAt: now(),
      status: 'NEGOTIATING',
      item,
      milestones: p.milestones.map((m) => ({ ...m, status: 'pending', captured: 0 })),
      transcript: [],
      approvals: [],
      paypal: {},
      engine: {},
    }),
  );
  store.updateRequest(req.id, { status: 'NEGOTIATING', plan: p, dealIds: deals.map((d) => d.id) });

  // Negotiate line items one at a time: keeps within LLM rate limits (free tiers)
  // and keeps the audit trail readable.
  for (const d of deals) await negotiateDeal(d.id);
  store.updateRequest(req.id, { status: 'DONE' });
}

// ───────────────────────────── 2. Negotiation + policy ─────────────────────────────
async function negotiateDeal(dealId) {
  const deal = store.getDeal(dealId);
  const onEvent = (e) => store.audit({ agent: 'negotiator', dealId, requestId: deal.requestId, ...e });
  let result;
  try {
    result = await negotiate({ deal, policy: store.policy, onEvent });
  } catch (e) {
    onEvent({ action: 'fallback', detail: `AI negotiator failed (${e.message}); retrying with heuristic negotiator` });
    result = await negotiate({ deal, policy: store.policy, onEvent, heuristic: true });
  }

  if (!result.selected) {
    store.updateDeal(dealId, { status: 'BLOCKED', blockReason: result.note || 'No offer selected', engine: { negotiator: result.engine } });
    store.audit({ agent: 'negotiator', dealId, action: 'no_offer', detail: result.note || 'No offer selected' });
    return;
  }

  const s = result.selected;
  store.updateDeal(dealId, (d) => ({
    selected: s,
    transcript: result.transcript,
    milestones: milestoneAmounts(s.total, d.milestones),
    engine: { ...d.engine, negotiator: result.engine },
  }));
  store.audit({
    agent: 'negotiator',
    dealId,
    action: 'offer_selected',
    detail: `${s.vendorName} · ${s.quantity}× ${s.name} @ $${s.unitPrice} = $${s.total} (saved $${s.savings}). ${s.rationale}`,
    confidence: s.confidence,
    engine: result.engine,
    data: { scores: s.scores, usage: result.usage },
  });

  applyPolicy(dealId);
}

function applyPolicy(dealId) {
  const deal = store.getDeal(dealId);
  const res = evaluatePolicy(store.policy, deal, store.listDeals());
  const failed = res.checks.filter((c) => !c.pass);
  const status = { allow: 'APPROVED', needs_human: 'AWAITING_APPROVAL', block: 'BLOCKED' }[res.decision];
  store.updateDeal(dealId, { status, policyResult: res, blockReason: res.decision === 'block' ? failed.filter((c) => c.severity === 'block').map((c) => c.rule).join(', ') : undefined });
  store.audit({
    agent: 'policy',
    dealId,
    action: `policy_${res.decision}`,
    detail: failed.length ? `Failed: ${failed.map((c) => `${c.rule} (${c.detail})`).join('; ')}` : 'All guardrails passed',
    confidence: 1,
    engine: 'deterministic',
    data: res,
  });
  return res;
}

// ───────────────────────────── 3. Human gate ─────────────────────────────
export function approveDeal(dealId, { by = 'manager', note = '' } = {}) {
  const deal = mustGet(dealId);
  expect(deal, 'AWAITING_APPROVAL');
  store.updateDeal(dealId, (d) => ({ status: 'APPROVED', approvals: [...d.approvals, { by, note, at: now(), decision: 'approve' }] }));
  store.audit({ agent: 'human', dealId, action: 'approved', detail: note || 'Approved above auto-approve threshold', actor: by });
  return store.getDeal(dealId);
}

export function rejectDeal(dealId, { by = 'manager', note = '' } = {}) {
  const deal = mustGet(dealId);
  expect(deal, 'AWAITING_APPROVAL', 'APPROVED', 'BLOCKED');
  store.updateDeal(dealId, (d) => ({ status: 'CANCELLED', approvals: [...d.approvals, { by, note, at: now(), decision: 'reject' }] }));
  store.audit({ agent: 'human', dealId, action: 'cancelled', detail: note || 'Cancelled by approver', actor: by });
  return store.getDeal(dealId);
}

// ───────────────────────────── 4. PayPal escrow ─────────────────────────────
export function createPaypalOrder(dealId) {
  return withLock(dealId, async () => {
    const deal = mustGet(dealId);
    expect(deal, 'APPROVED');
    // Re-check guardrails at payment time: budgets may have moved since negotiation.
    const res = evaluatePolicy(store.policy, deal, store.listDeals());
    if (res.decision === 'block') {
      applyPolicy(dealId);
      throw new FlowError('Policy re-check failed at payment time; deal blocked');
    }
    if (deal.paypal.orderId && !deal.paypal.authorizationId) return { orderId: deal.paypal.orderId, mode: paypal.paypalMode() };

    const order = await paypal.createEscrowOrder(deal);
    store.updateDeal(dealId, (d) => ({ paypal: { ...d.paypal, orderId: order.orderId, orderStatus: order.status, mode: paypal.paypalMode() } }));
    store.audit({ agent: 'payments', dealId, action: 'order_created', detail: `PayPal order ${order.orderId} (intent AUTHORIZE) for $${order.amount}`, engine: `paypal:${paypal.paypalMode()}` });
    return { orderId: order.orderId, mode: paypal.paypalMode() };
  });
}

export function authorizeEscrow(dealId, orderId) {
  return withLock(dealId, async () => {
    const deal = mustGet(dealId);
    expect(deal, 'APPROVED');
    if (!orderId || deal.paypal.orderId !== orderId) throw new FlowError('Order id does not match this deal', 400);
    const auth = await paypal.authorizeOrder(orderId);
    store.updateDeal(dealId, (d) => ({
      status: 'ESCROW_HELD',
      paypal: { ...d.paypal, authorizationId: auth.authorizationId, authStatus: auth.status, authExpiresAt: auth.expiresAt, payerEmail: auth.payerEmail, captured: 0 },
    }));
    store.audit({
      agent: 'payments',
      dealId,
      action: 'escrow_held',
      detail: `Authorization ${auth.authorizationId} holds $${deal.selected.total} until delivery is verified (expires ${auth.expiresAt?.slice(0, 10) ?? 'n/a'})`,
      engine: `paypal:${paypal.paypalMode()}`,
    });
    return store.getDeal(dealId);
  });
}

// ───────────────────────────── 5. Delivery verification + release ─────────────────────────────
export function submitDelivery(dealId, { proof, image, submittedBy = 'vendor' }) {
  return withLock(dealId, async () => {
    const deal = mustGet(dealId);
    expect(deal, 'ESCROW_HELD', 'PARTIALLY_RELEASED');
    if (!proof || proof.trim().length < 5) throw new FlowError('Provide delivery evidence text', 400);
    const idx = deal.milestones.findIndex((m) => m.status === 'pending');
    if (idx < 0) throw new FlowError('No pending milestone');
    const milestone = deal.milestones[idx];

    store.audit({ agent: 'human', dealId, action: 'delivery_submitted', detail: `[${milestone.name}] ${proof.slice(0, 300)}${image ? ' (+photo)' : ''}`, actor: submittedBy });

    let v;
    try {
      v = await verifyDelivery({ deal, milestone, proof, image });
    } catch (e) {
      store.audit({ agent: 'verifier', dealId, action: 'fallback', detail: `AI verifier failed (${e.message}); using heuristic` });
      v = { ...heuristicVerify({ deal, milestone, proof }), engine: 'heuristic' };
    }
    store.audit({
      agent: 'verifier',
      dealId,
      action: `verdict_${v.verdict}`,
      detail: `${v.summary} | ${v.findings.join('; ')}`,
      confidence: v.confidence,
      engine: v.engine,
      data: { releasePct: v.releasePct, usage: v.usage },
    });

    if (v.confidence < store.policy.minVerifierConfidence) {
      store.updateDeal(dealId, (d) => ({
        status: 'IN_REVIEW',
        milestones: d.milestones.map((m, i) => (i === idx ? { ...m, status: 'review', verdict: v, proof } : m)),
      }));
      store.audit({ agent: 'policy', dealId, action: 'escalated', detail: `Verifier confidence ${v.confidence} < ${store.policy.minVerifierConfidence}; human review required`, confidence: 1, engine: 'deterministic' });
      return store.getDeal(dealId);
    }
    return settleMilestone(dealId, idx, v.verdict, v.releasePct, { verdict: v, proof, decidedBy: 'verifier-agent' });
  });
}

export function resolveReview(dealId, { decision, releasePct, by = 'manager' }) {
  return withLock(dealId, async () => {
    const deal = mustGet(dealId);
    expect(deal, 'IN_REVIEW');
    const idx = deal.milestones.findIndex((m) => m.status === 'review');
    const pct = decision === 'release' ? 100 : decision === 'reject' ? 0 : Math.max(0, Math.min(100, Number(releasePct) || 0));
    store.audit({ agent: 'human', dealId, action: `review_${decision}`, detail: `Reviewer chose ${decision} (${pct}%)`, actor: by });
    return settleMilestone(dealId, idx, decision, pct, { decidedBy: by });
  });
}

async function settleMilestone(dealId, idx, verdict, pct, meta) {
  const deal = store.getDeal(dealId);
  const m = deal.milestones[idx];
  const isLast = idx === deal.milestones.length - 1;
  const authId = deal.paypal.authorizationId;

  if (verdict === 'reject') {
    // Stop the deal: void what is still held (buyer keeps the money).
    await paypal.voidAuthorization(authId);
    const captured = deal.paypal.captured || 0;
    store.updateDeal(dealId, (d) => ({
      status: captured > 0 ? 'CLOSED' : 'VOIDED',
      milestones: d.milestones.map((x, i) => (i === idx ? { ...x, status: 'rejected', ...meta } : i > idx ? { ...x, status: 'cancelled' } : x)),
      paypal: { ...d.paypal, authStatus: 'VOIDED' },
    }));
    store.audit({ agent: 'payments', dealId, action: 'escrow_voided', detail: `Authorization ${authId} voided; $${round(deal.selected.total - captured)} returned to buyer`, engine: `paypal:${paypal.paypalMode()}` });
    return store.getDeal(dealId);
  }

  const amount = round((m.amount * pct) / 100);
  const cap = await paypal.captureMilestone({
    authorizationId: authId,
    amount,
    finalCapture: isLast,
    requestId: `cap-${dealId}-m${idx}`,
    note: `${m.name} – ${pct}% of milestone`,
  });
  if (amount <= 0 && isLast) await paypal.voidAuthorization(authId);

  const captured = round((deal.paypal.captured || 0) + amount);
  store.updateDeal(dealId, (d) => ({
    status: isLast ? 'RELEASED' : 'PARTIALLY_RELEASED',
    milestones: d.milestones.map((x, i) => (i === idx ? { ...x, status: pct >= 100 ? 'released' : 'partial', releasedPct: pct, captured: amount, captureId: cap.captureId, ...meta } : x)),
    paypal: { ...d.paypal, captured, authStatus: isLast ? 'CAPTURED' : 'PARTIALLY_CAPTURED' },
  }));
  const refund = isLast ? round(deal.selected.total - captured) : 0;
  store.audit({
    agent: 'payments',
    dealId,
    action: 'milestone_captured',
    detail: `Captured $${amount} (${pct}% of "${m.name}") → ${deal.selected.vendorName}${cap.captureId ? ` · capture ${cap.captureId}` : ''}${isLast ? ` · final capture${refund > 0 ? `, $${refund} released back to buyer` : ''}` : ''}`,
    engine: `paypal:${paypal.paypalMode()}`,
  });
  return store.getDeal(dealId);
}

const round = (n) => Math.round(n * 100) / 100;

// ───────────────────────────── 6. Webhooks ─────────────────────────────
export function applyWebhook(evt) {
  if (store.hasWebhook(evt.id)) return { duplicate: true };
  store.addWebhook({ id: evt.id, type: evt.event_type, at: now() });
  const r = evt.resource || {};
  const orderId = r.supplementary_data?.related_ids?.order_id || (evt.event_type.startsWith('CHECKOUT.ORDER') ? r.id : undefined);
  const authId = r.supplementary_data?.related_ids?.authorization_id || (evt.event_type.startsWith('PAYMENT.AUTHORIZATION') ? r.id : undefined);
  const deal = store.findDealBy(
    (d) => (r.custom_id && d.id === r.custom_id) || (orderId && d.paypal.orderId === orderId) || (authId && d.paypal.authorizationId === authId),
  );
  store.audit({
    agent: 'webhook',
    dealId: deal?.id,
    action: evt.event_type,
    detail: `${evt.summary || evt.event_type}${r.amount ? ` · ${r.amount.value} ${r.amount.currency_code}` : ''} · resource ${r.id}`,
    engine: 'paypal',
  });
  if (deal) {
    store.updateDeal(deal.id, (d) => ({ paypal: { ...d.paypal, lastWebhook: evt.event_type, webhookEvents: [...(d.paypal.webhookEvents || []), { type: evt.event_type, id: r.id, at: now() }] } }));
  }
  return { matched: Boolean(deal) };
}
