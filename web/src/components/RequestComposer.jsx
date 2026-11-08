import React, { useState } from 'react';

const EXAMPLES = [
  'We need 12 AIS-140 GPS trackers for the mining fleet, installed and commissioned within 7 days. Budget under $1,600.',
  'Buy 3 business laptops and 3 27-inch monitors for the new analysts, total budget $4,000, needed in 5 days.',
  'Order 40 site safety kits for the fertilizer plant contractors – cheapest certified option, under $2,600.',
  'Two industrial IoT gateways for the dairy chilling centre with Modbus support, deployed and reporting data. Max $1,100.',
];

export default function RequestComposer({ onSubmit, busy }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSubmit(text.trim());
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="card" onSubmit={send}>
      <h2>New purchase request</h2>
      <p className="dim small">Describe it in plain English. The planner agent structures it, the negotiator haggles with vendor agents, and policy decides whether it can go to escrow.</p>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
        placeholder="e.g. 10 GPS trackers for our delivery vans, installed within a week, max $1,500"
        aria-label="Purchase request"
      />
      <button className="primary" type="submit" disabled={!text.trim() || sending}>
        {sending ? 'Sending…' : busy ? 'Queue for agents' : 'Let the agents buy it'}
      </button>
      <div className="examples">
        <span className="dim small">Try:</span>
        {EXAMPLES.map((ex) => (
          <button type="button" key={ex} className="chip" onClick={() => setText(ex)} title={ex}>
            {ex.slice(0, 46)}…
          </button>
        ))}
      </div>
    </form>
  );
}
