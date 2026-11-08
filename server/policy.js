/**
 * Deterministic spending guardrails. The LLM *proposes*; this module *disposes*.
 * Nothing here calls a model – so a prompt-injected or hallucinating agent
 * can never move money outside the policy.
 */
export const DEFAULT_POLICY = {
  currency: 'USD',
  monthlyBudget: 25000,
  perOrderCap: 6000,
  requireHumanAbove: 1500,
  minVendorRating: 4.0,
  maxDeliveryDays: 10,
  minVerifierConfidence: 0.75,
  allowedCategories: ['laptops', 'monitors', 'office_chairs', 'iot_gateways', 'gps_trackers', 'safety_gear'],
  blockedVendors: [],
};

const COMMITTED = new Set(['AWAITING_APPROVAL', 'APPROVED', 'ESCROW_HELD', 'DELIVERY_SUBMITTED', 'IN_REVIEW', 'PARTIALLY_RELEASED', 'RELEASED']);

/** Spend already committed (escrowed or released) in the deal's calendar month. */
export function committedSpend(deals, month = new Date().toISOString().slice(0, 7), excludeId) {
  return deals
    .filter((d) => d.id !== excludeId && COMMITTED.has(d.status) && (d.createdAt || '').startsWith(month))
    .reduce((s, d) => s + (d.selected?.total || 0), 0);
}

/**
 * @returns {{ decision: 'allow'|'needs_human'|'block', checks: Array<{rule:string, pass:boolean, detail:string, severity:'block'|'human'}> }}
 */
export function evaluatePolicy(policy, deal, allDeals) {
  const s = deal.selected;
  const checks = [];
  const add = (rule, pass, detail, severity = 'block') => checks.push({ rule, pass, detail, severity });

  if (!s) {
    add('has_selection', false, 'No vendor offer was selected');
    return { decision: 'block', checks };
  }

  add('allowed_category', policy.allowedCategories.includes(deal.item.category), `category=${deal.item.category}`);
  add('vendor_not_blocked', !policy.blockedVendors.includes(s.vendorId), `vendor=${s.vendorName}`);
  add('vendor_rating', s.vendorRating >= policy.minVendorRating, `${s.vendorRating} >= ${policy.minVendorRating}`);
  add('delivery_window', s.deliveryDays <= policy.maxDeliveryDays, `${s.deliveryDays}d <= ${policy.maxDeliveryDays}d`);
  add('per_order_cap', s.total <= policy.perOrderCap, `$${s.total} <= $${policy.perOrderCap}`);

  if (deal.item.maxBudget != null) {
    add('request_budget', s.total <= deal.item.maxBudget, `$${s.total} <= requested max $${deal.item.maxBudget}`);
  }

  const committed = committedSpend(allDeals, (deal.createdAt || '').slice(0, 7) || undefined, deal.id);
  add(
    'monthly_budget',
    committed + s.total <= policy.monthlyBudget,
    `$${committed} committed + $${s.total} <= $${policy.monthlyBudget}`,
  );

  // Price sanity: the negotiated price must never exceed the vendor's list price.
  add('price_not_above_list', s.unitPrice <= s.listUnitPrice, `$${s.unitPrice} <= list $${s.listUnitPrice}`);

  add('human_threshold', s.total <= policy.requireHumanAbove, `$${s.total} <= auto-approve limit $${policy.requireHumanAbove}`, 'human');

  const blocked = checks.some((c) => !c.pass && c.severity === 'block');
  const human = checks.some((c) => !c.pass && c.severity === 'human');
  return { decision: blocked ? 'block' : human ? 'needs_human' : 'allow', checks };
}

/** Split a total into milestone amounts that sum exactly to the total (cents-safe). */
export function milestoneAmounts(total, milestones) {
  const cents = Math.round(total * 100);
  let allocated = 0;
  return milestones.map((m, i) => {
    const c = i === milestones.length - 1 ? cents - allocated : Math.round((cents * m.pct) / 100);
    allocated += c;
    return { ...m, amount: c / 100 };
  });
}
