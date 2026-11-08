import React, { useEffect, useState } from 'react';

const FIELDS = [
  { key: 'requireHumanAbove', label: 'Auto-approve up to', prefix: '$', step: 100 },
  { key: 'perOrderCap', label: 'Per-order cap', prefix: '$', step: 500 },
  { key: 'monthlyBudget', label: 'Monthly budget', prefix: '$', step: 1000 },
  { key: 'minVendorRating', label: 'Min vendor rating', step: 0.1, max: 5 },
  { key: 'maxDeliveryDays', label: 'Max delivery (days)', step: 1 },
  { key: 'minVerifierConfidence', label: 'Min verifier confidence', step: 0.05, max: 1 },
];

export default function PolicyPanel({ policy, categories, onSave }) {
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  const toggleCat = (c) =>
    setDraft((d) => ({ ...d, allowedCategories: d.allowedCategories.includes(c) ? d.allowedCategories.filter((x) => x !== c) : [...d.allowedCategories, c] }));

  return (
    <div className="card">
      <h2>Spending guardrails</h2>
      <p className="dim small">Enforced by deterministic code, not the LLM. The agents can propose anything; only compliant deals reach PayPal.</p>
      <div className="policy-grid">
        {FIELDS.map((f) => (
          <label key={f.key}>
            <span>{f.label}</span>
            <span className="num">
              {f.prefix && <i>{f.prefix}</i>}
              <input
                type="number"
                min={0}
                max={f.max}
                step={f.step}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
              />
            </span>
          </label>
        ))}
      </div>
      <div className="cats">
        {categories.map((c) => (
          <label key={c} className={`chip ${draft.allowedCategories.includes(c) ? 'on' : ''}`}>
            <input type="checkbox" checked={draft.allowedCategories.includes(c)} onChange={() => toggleCat(c)} />
            {c.replace('_', ' ')}
          </label>
        ))}
      </div>
      {dirty && (
        <div className="row">
          <button
            className="primary small"
            onClick={() => {
              const { currency, blockedVendors, ...rest } = draft;
              onSave({ ...rest, blockedVendors });
            }}
          >
            Save guardrails
          </button>
          <button className="ghost small" onClick={() => setDraft(policy)}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
