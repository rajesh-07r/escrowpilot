/**
 * Deterministic stand-ins for each agent. Used when no ANTHROPIC_API_KEY is
 * configured (so judges can run the demo offline) and as a safety net if a
 * model call fails mid-flow. Same inputs/outputs as the Claude agents.
 */
import { CATEGORIES, VENDORS } from '../catalog.js';

/** Median list price per category – used to split an overall budget by expected cost. */
const typicalPrice = (category) => {
  const prices = VENDORS.flatMap((v) => v.offers.filter((o) => o.category === category).map((o) => o.listPrice)).sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)] ?? 1;
};

const KEYWORDS = {
  laptops: ['laptop', 'notebook', 'macbook', 'thinkpad'],
  monitors: ['monitor', 'display', 'screen'],
  office_chairs: ['chair', 'seating'],
  iot_gateways: ['gateway', 'iot', 'edge device', 'modbus', 'plc'],
  gps_trackers: ['gps', 'tracker', 'ais-140', 'ais 140', 'telematics', 'vts'],
  safety_gear: ['safety', 'helmet', 'ppe', 'vest', 'gloves'],
};

function detectCategory(text) {
  const t = text.toLowerCase();
  return CATEGORIES.find((c) => KEYWORDS[c].some((k) => t.includes(k))) ?? null;
}

function parseMoney(s) {
  const m = s.match(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  return Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
}

export function heuristicPlan(text) {
  const parts = text.split(/\band\b|,|;|\+/i).map((p) => p.trim()).filter(Boolean);
  // Money amounts after a budget keyword – but not "within 7 days" / "under 10 units".
  const budgets = [...text.matchAll(/(?:under|below|max(?:imum)?|budget(?: of)?|within|up to|<=?)\s*(\$?\s?\d[\d,]*(?:\.\d+)?\s*k?)(?!\s*(?:days?|weeks?|hours?|units?|pcs|x\b))/gi)].map((m) => parseMoney(m[1]));
  const totalBudget = budgets[0] ?? null;
  const daysMatch = text.match(/(?:within|in|by)\s+(\d+)\s*days?/i) || text.match(/(?:by|before)\s+(?:next\s+)?(friday|monday|week)/i);
  const neededByDays = daysMatch ? (Number(daysMatch[1]) || 7) : null;

  const items = [];
  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20, fifty: 50, hundred: 100 };
  for (const raw of parts) {
    const p = raw.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|fifty|hundred)\b/gi, (w) => String(WORDS[w.toLowerCase()]));
    const category = detectCategory(p);
    if (!category || items.some((i) => i.category === category)) continue;
    // First bare integer that is not money, a size ("27-inch"), a duration or a model number ("AIS-140").
    const q = p.match(/(?<![$\d.,-])\b(\d{1,4})\b(?![\d,.]|\s*(?:-?\s*inch|"|”|days?|weeks?|hours?|%|k\b))/i);
    const quantity = q ? Math.max(1, Math.min(500, Number(q[1]))) : 1;
    items.push({ category, description: raw.replace(/\s+/g, ' ').slice(0, 120), quantity, maxBudget: null, neededByDays });
  }
  // One budget per item ("trackers under $1,600 … laptops max $2,700") → assign in order.
  if (items.length > 1 && budgets.length === items.length) {
    items.forEach((i, k) => (i.maxBudget = budgets[k]));
  }
  // Otherwise split an overall budget across items in proportion to expected cost (quantity × typical list price).
  else if (totalBudget && items.length) {
    const est = items.map((i) => i.quantity * typicalPrice(i.category));
    const sum = est.reduce((a, b) => a + b, 0);
    items.forEach((i, k) => (i.maxBudget = items.length === 1 ? totalBudget : Math.round((totalBudget * est[k]) / sum)));
  }
  const install = /install|deploy|commission|setup|set up/i.test(text);
  return {
    summary: items.length ? `Procure ${items.map((i) => `${i.quantity}× ${i.category.replace('_', ' ')}`).join(', ')}` : 'No catalog items recognised',
    items,
    milestones: install
      ? [
          { name: 'Delivery received', pct: 70, acceptanceCriteria: 'All units delivered, correct quantity, undamaged' },
          { name: 'Installed & commissioned', pct: 30, acceptanceCriteria: 'Units installed and reporting/operational' },
        ]
      : [{ name: 'Delivery received', pct: 100, acceptanceCriteria: 'All units delivered, correct quantity, undamaged' }],
    notes: 'Deterministic heuristic planner (offline mode or Claude unavailable).',
  };
}

export function scoreQuote(q, maxDeliveryDays = 10) {
  const priceScore = 1 - Math.min(1, q.unitPrice / (q.listUnitPrice || q.unitPrice) - 0.7); // cheaper vs list → higher
  const deliveryScore = 1 - Math.min(1, q.deliveryDays / (maxDeliveryDays * 1.5));
  const reliability = (q.vendorRating - 3) / 2;
  return { price: round(priceScore), delivery: round(deliveryScore), reliability: round(reliability) };
}
const round = (n) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;

export function heuristicVerify({ deal, milestone, proof }) {
  const t = proof.toLowerCase();
  const findings = [];
  let verdict = 'release';
  let releasePct = 100;
  let confidence = 0.86;

  const nums = [...t.matchAll(/(\d+)\s*(?:units?|pcs|pieces|x\b|devices|laptops|monitors|chairs|trackers|kits|gateways)/g)].map((m) => Number(m[1]));
  const qty = deal.item.quantity;
  if (nums.length) {
    const delivered = Math.max(...nums.filter((n) => n <= qty * 2));
    if (Number.isFinite(delivered) && delivered < qty) {
      verdict = 'partial';
      releasePct = Math.floor((delivered / qty) * 100);
      findings.push(`Short shipment: ${delivered}/${qty} units confirmed`);
    } else if (delivered >= qty) findings.push(`Quantity confirmed: ${delivered}/${qty}`);
  } else {
    findings.push('Quantity not stated in proof');
    confidence -= 0.2;
  }
  if (/(?<!un)damag|broken|crack|defect|\bdoa\b|not working/.test(t)) {
    verdict = verdict === 'release' ? 'partial' : verdict;
    releasePct = Math.min(releasePct, 50);
    findings.push('Damage / defect reported');
    confidence -= 0.1;
  }
  if (/not delivered|never arrived|missing|lost|wrong item/.test(t)) {
    verdict = 'reject';
    releasePct = 0;
    findings.push('Non-delivery or wrong item reported');
  }
  if (/(signed|signature|pod|tracking|awb|grn)/.test(t)) findings.push('Proof-of-delivery reference present');
  else confidence -= 0.1;

  return {
    verdict,
    releasePct,
    confidence: Math.max(0.3, Math.round(confidence * 100) / 100),
    findings,
    summary: `Heuristic check of "${milestone.name}": ${verdict} ${releasePct}%`,
  };
}
