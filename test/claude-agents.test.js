// Exercises the Claude code paths (planner, negotiator tool loop, verifier) against a
// mocked HTTP layer: verifies request shape and the agent loop without spending tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';

process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.AI_PROVIDER = 'claude';
const { setClaudeClient } = await import('../server/agents/llm.js');
const { plan } = await import('../server/agents/planner.js');
const { negotiate } = await import('../server/agents/negotiator.js');
const { verifyDelivery } = await import('../server/agents/verifier.js');
const { DEFAULT_POLICY } = await import('../server/policy.js');

function mockClient(script) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body, headers: init.headers });
    const content = script(body, requests.length);
    const msg = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 5 } };
    return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  setClaudeClient(new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }));
  return requests;
}
const hdr = (r, k) => (r.headers instanceof Headers ? r.headers.get(k) : r.headers[k]);

test('planner sends structured-output request and parses result', async () => {
  const reqs = mockClient(() => [{ type: 'text', text: JSON.stringify({ summary: 's', items: [{ category: 'laptops', description: 'x', quantity: 3, maxBudget: 3000, neededByDays: 5 }], milestones: [{ name: 'Delivery', pct: 60, acceptanceCriteria: 'a' }, { name: 'Setup', pct: 30, acceptanceCriteria: 'b' }], notes: '' }) }]);
  const { plan: p, engine } = await plan('3 laptops');
  assert.equal(engine, 'claude');
  assert.equal(p.milestones.reduce((s, m) => s + m.pct, 0), 100, 'milestones normalised to 100');
  const b = reqs[0].body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.match(hdr(reqs[0], 'anthropic-beta'), /server-side-fallback-2026-07-01/);
});

test('negotiator runs a multi-turn tool loop and uses vendor-confirmed price', async () => {
  const deal = { item: { category: 'laptops', quantity: 3, description: 'laptops', maxBudget: 3000, neededByDays: 7 } };
  const reqs = mockClient((body, n) => {
    if (n === 1) return [{ type: 'tool_use', id: 't1', name: 'get_quotes', input: {} }];
    if (n === 2) return [{ type: 'tool_use', id: 't2', name: 'counter_offer', input: { vendor_id: 'v_northwind', sku: 'NW-LT-14', unit_price: 780, rationale: 'competing quote' } }];
    // Agent claims an absurd price in rationale – server must ignore it and use the negotiated one.
    return [{ type: 'text', text: 'Selecting Northwind.' }, { type: 'tool_use', id: 't3', name: 'select_offer', input: { vendor_id: 'v_northwind', sku: 'NW-LT-14', rationale: 'price $1', confidence: 0.9, scores: { price: 0.8, delivery: 0.9, reliability: 0.9 } } }];
  });
  const r = await negotiate({ deal, policy: DEFAULT_POLICY });
  assert.equal(r.engine, 'claude');
  assert.equal(r.selected.vendorId, 'v_northwind');
  assert.ok(r.selected.unitPrice >= 809 && r.selected.unitPrice < 899, `negotiated ${r.selected.unitPrice}`);
  assert.equal(reqs.length, 3);
  // tool results returned in a single user message, assistant content preserved
  const last = reqs[2].body.messages;
  assert.equal(last.at(-1).role, 'user');
  assert.equal(last.at(-1).content[0].type, 'tool_result');
  assert.ok(reqs[0].body.tools.every((t) => t.strict === true));
});

test('verifier parses verdict and clamps values', async () => {
  mockClient(() => [{ type: 'text', text: JSON.stringify({ verdict: 'partial', releasePct: 140, confidence: 1.4, findings: ['short by 2'], summary: 'ok' }) }]);
  const deal = { id: 'po_1', selected: { name: 'x', sku: 's', quantity: 10, vendorName: 'v' } };
  const v = await verifyDelivery({ deal, milestone: { name: 'Delivery', acceptanceCriteria: 'all', amount: 100 }, proof: 'Delivered 8 units' });
  assert.equal(v.releasePct, 100);
  assert.equal(v.confidence, 1);
});

test('refusal surfaces as an error (orchestrator then falls back)', async () => {
  const fetch = async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  setClaudeClient(new Anthropic({ apiKey: 'k', fetch, maxRetries: 0 }));
  await assert.rejects(plan('3 laptops'), /declined/);
});
