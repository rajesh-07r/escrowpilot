// Exercises the Gemini code paths against a mocked HTTP layer (no API calls, no cost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleGenAI } from '@google/genai';

process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_MODEL = 'gemini-3.5-flash';
const { setGeminiClient } = await import('../server/agents/gemini.js');
const { plan } = await import('../server/agents/planner.js');
const { negotiate } = await import('../server/agents/negotiator.js');
const { verifyDelivery } = await import('../server/agents/verifier.js');
const { DEFAULT_POLICY } = await import('../server/policy.js');

function mock(script) {
  const reqs = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    reqs.push({ url: String(url), body });
    const parts = script(body, reqs.length);
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, modelVersion: 'gemini-3.5-flash' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  setGeminiClient(new GoogleGenAI({ apiKey: 'test-key', httpOptions: { fetch } }));
  return reqs;
}

test('gemini planner: JSON schema request, parsed + normalised plan', async () => {
  const reqs = mock(() => [{ text: JSON.stringify({ summary: 's', items: [{ category: 'gps_trackers', description: 'x', quantity: 12, maxBudget: 1600, neededByDays: 7 }], milestones: [{ name: 'Delivery', pct: 70, acceptanceCriteria: 'a' }, { name: 'Install', pct: 20, acceptanceCriteria: 'b' }], notes: '' }) }]);
  const r = await plan('12 trackers');
  assert.equal(r.engine, 'gemini');
  assert.equal(r.plan.milestones.reduce((s, m) => s + m.pct, 0), 100);
  assert.match(reqs[0].url, /gemini-3\.5-flash:generateContent/);
  const cfg = reqs[0].body.generationConfig;
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.ok(cfg.responseJsonSchema?.properties?.items, 'schema sent');
  assert.equal(cfg.responseJsonSchema.$schema, undefined);
});

test('gemini negotiator: function-calling loop, vendor-confirmed price', async () => {
  const reqs = mock((body, n) => {
    if (n === 1) return [{ functionCall: { id: 'c1', name: 'get_quotes', args: {} } }];
    if (n === 2) return [{ functionCall: { id: 'c2', name: 'counter_offer', args: { vendor_id: 'v_northwind', sku: 'NW-LT-14', unit_price: 780, rationale: 'competing quote' } } }];
    return [{ text: 'Picking Northwind.' }, { functionCall: { id: 'c3', name: 'select_offer', args: { vendor_id: 'v_northwind', sku: 'NW-LT-14', rationale: 'best', confidence: 0.9, scores: { price: 0.8, delivery: 0.9, reliability: 0.9 } } } }];
  });
  const deal = { item: { category: 'laptops', quantity: 3, description: 'laptops', maxBudget: 3000, neededByDays: 7 } };
  const r = await negotiate({ deal, policy: DEFAULT_POLICY });
  assert.equal(r.engine, 'gemini');
  assert.equal(r.selected.vendorId, 'v_northwind');
  assert.ok(r.selected.unitPrice >= 809 && r.selected.unitPrice < 899);
  assert.equal(reqs.length, 3);
  const last = reqs[2].body.contents;
  assert.equal(last.at(-2).role, 'model', 'model turn preserved');
  assert.ok(last.at(-1).parts[0].functionResponse, 'function response sent back');
  assert.ok(reqs[0].body.tools[0].functionDeclarations.some((f) => f.name === 'select_offer'));
});

test('gemini verifier: clamps values', async () => {
  mock(() => [{ text: JSON.stringify({ verdict: 'release', releasePct: 150, confidence: 2, findings: ['ok'], summary: 'fine' }) }]);
  const deal = { id: 'po_1', selected: { name: 'x', sku: 's', quantity: 10, vendorName: 'v' } };
  const v = await verifyDelivery({ deal, milestone: { name: 'D', acceptanceCriteria: 'all', amount: 100 }, proof: 'Delivered 10 units' });
  assert.equal(v.engine, 'gemini');
  assert.equal(v.releasePct, 100);
  assert.equal(v.confidence, 1);
});
