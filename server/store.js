import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { DEFAULT_POLICY } from './policy.js';

/**
 * Minimal JSON-file store. Good enough for a hackathon demo and a single
 * Render instance; swap for Postgres when going multi-instance.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

const empty = () => ({ policy: { ...DEFAULT_POLICY }, requests: [], deals: [], audit: [], webhooks: [] });

let db = load();

function load() {
  try {
    const raw = fs.readFileSync(config.dataFile, 'utf8');
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, config.dataFile);
  }, 50);
}

export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

export const store = {
  get policy() {
    return db.policy;
  },
  setPolicy(patch) {
    db.policy = { ...db.policy, ...patch };
    persist();
    bus.emit('change', { type: 'policy' });
    return db.policy;
  },

  listDeals: () => db.deals,
  getDeal: (dealId) => db.deals.find((d) => d.id === dealId),
  findDealBy: (pred) => db.deals.find(pred),
  addDeal(deal) {
    db.deals.unshift(deal);
    persist();
    bus.emit('change', { type: 'deal', id: deal.id });
    return deal;
  },
  updateDeal(dealId, patch) {
    const deal = db.deals.find((d) => d.id === dealId);
    if (!deal) throw new Error(`Deal ${dealId} not found`);
    Object.assign(deal, typeof patch === 'function' ? patch(deal) : patch, { updatedAt: now() });
    persist();
    bus.emit('change', { type: 'deal', id: dealId });
    return deal;
  },

  listRequests: () => db.requests,
  addRequest(req) {
    db.requests.unshift(req);
    persist();
    return req;
  },
  updateRequest(reqId, patch) {
    const r = db.requests.find((x) => x.id === reqId);
    if (r) Object.assign(r, patch);
    persist();
    bus.emit('change', { type: 'request', id: reqId });
    return r;
  },

  listAudit: () => db.audit,
  /** Append-only audit trail of every agent / policy / payment decision. */
  audit(entry) {
    const row = { id: id('evt'), ts: now(), confidence: null, ...entry };
    db.audit.unshift(row);
    if (db.audit.length > 5000) db.audit.length = 5000;
    persist();
    bus.emit('change', { type: 'audit', id: row.id });
    return row;
  },

  addWebhook(evt) {
    db.webhooks.unshift(evt);
    if (db.webhooks.length > 500) db.webhooks.length = 500;
    persist();
  },
  hasWebhook: (eventId) => db.webhooks.some((w) => w.id === eventId),

  reset() {
    db = empty();
    persist();
    bus.emit('change', { type: 'reset' });
  },
};
