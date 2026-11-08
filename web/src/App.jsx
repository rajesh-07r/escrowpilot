import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, usd } from './api.js';
import RequestComposer from './components/RequestComposer.jsx';
import PolicyPanel from './components/PolicyPanel.jsx';
import DealsGrid from './components/DealsGrid.jsx';
import AuditGrid from './components/AuditGrid.jsx';
import DealDrawer from './components/DealDrawer.jsx';

const HELD = new Set(['ESCROW_HELD', 'PARTIALLY_RELEASED', 'IN_REVIEW']);
const ACTION = new Set(['AWAITING_APPROVAL', 'APPROVED', 'IN_REVIEW']);

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [state, setState] = useState({ deals: [], audit: [], requests: [], policy: null });
  const [tab, setTab] = useState('deals');
  // Deep-linkable drawer: #po_xxxx opens that deal (handy for demos and support links).
  const [selectedId, setSelectedIdRaw] = useState(() => window.location.hash.slice(1) || null);
  const setSelectedId = useCallback((v) => {
    setSelectedIdRaw(v);
    history.replaceState(null, '', v ? `#${v}` : window.location.pathname);
  }, []);
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const refresh = useCallback(() => api.state().then(setState).catch((e) => setToast({ kind: 'error', msg: e.message })), []);

  useEffect(() => {
    api.config().then(setCfg);
    refresh();
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 120);
    };
    return () => es.close();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = useCallback(
    async (fn, okMsg) => {
      try {
        const r = await fn();
        if (okMsg) setToast({ kind: 'ok', msg: okMsg });
        refresh();
        return r;
      } catch (e) {
        setToast({ kind: 'error', msg: e.message });
        throw e;
      }
    },
    [refresh],
  );

  const kpis = useMemo(() => {
    const d = state.deals;
    return {
      held: d.filter((x) => HELD.has(x.status)).reduce((s, x) => s + (x.selected?.total || 0) - (x.paypal?.captured || 0), 0),
      released: d.reduce((s, x) => s + (x.paypal?.captured || 0), 0),
      savings: d.filter((x) => x.selected && !['BLOCKED', 'CANCELLED'].includes(x.status)).reduce((s, x) => s + (x.selected.savings || 0), 0),
      action: d.filter((x) => ACTION.has(x.status)).length,
      blocked: d.filter((x) => x.status === 'BLOCKED').length,
    };
  }, [state.deals]);

  const selected = state.deals.find((d) => d.id === selectedId);
  const pending = state.requests.filter((r) => ['PLANNING', 'NEGOTIATING'].includes(r.status));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="8" fill="currentColor" />
              <path d="M9 17l5 5 9-11" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1>EscrowPilot</h1>
            <p>Agents negotiate. PayPal holds the money. Delivery releases it.</p>
          </div>
        </div>
        <div className="modes">
          {cfg && (
            <>
              <span className={`badge ${cfg.aiMode !== 'heuristic' ? 'good' : 'muted'}`} title="Agent engine">
                AI: {cfg.aiMode !== 'heuristic' ? cfg.aiModel : 'heuristic (offline)'}
              </span>
              <span className={`badge ${cfg.paypalMode === 'mock' ? 'muted' : 'good'}`} title="PayPal environment">
                PayPal: {cfg.paypalMode}
              </span>
            </>
          )}
          <button className="ghost small" onClick={() => confirm('Clear all demo data?') && run(api.reset, 'Demo data cleared')}>
            Reset demo
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="side">
          <RequestComposer onSubmit={(t) => run(() => api.submit(t), 'Request sent to the agents')} busy={pending.length > 0} />
          {state.policy && <PolicyPanel policy={state.policy} categories={cfg?.categories || []} onSave={(p) => run(() => api.policy(p), 'Guardrails updated')} />}
        </aside>

        <main className="main">
          <section className="kpis">
            <Kpi label="Held in PayPal escrow" value={usd(kpis.held)} accent />
            <Kpi label="Released to vendors" value={usd(kpis.released)} />
            <Kpi label="Negotiated savings" value={usd(kpis.savings)} />
            <Kpi label="Need your action" value={kpis.action} />
            <Kpi label="Blocked by policy" value={kpis.blocked} />
          </section>

          {pending.length > 0 && (
            <div className="working" role="status">
              <span className="spinner" /> Agents working on: “{pending[0].text.slice(0, 90)}{pending[0].text.length > 90 ? '…' : ''}” — {pending[0].status.toLowerCase()}
            </div>
          )}

          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'deals'} className={tab === 'deals' ? 'on' : ''} onClick={() => setTab('deals')}>
              Escrow ledger <span className="count">{state.deals.length}</span>
            </button>
            <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>
              Agent audit trail <span className="count">{state.audit.length}</span>
            </button>
          </nav>

          <section className="grid-wrap">
            {tab === 'deals' ? (
              <DealsGrid deals={state.deals} onOpen={setSelectedId} />
            ) : (
              <AuditGrid audit={state.audit} onOpenDeal={(id) => id && setSelectedId(id)} />
            )}
          </section>
        </main>
      </div>

      {selected && <DealDrawer deal={selected} audit={state.audit.filter((a) => a.dealId === selected.id)} cfg={cfg} run={run} onClose={() => setSelectedId(null)} />}

      {toast && (
        <div className={`toast ${toast.kind}`} role="alert" onClick={() => setToast(null)}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }) {
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <div className="kpi-v">{value}</div>
      <div className="kpi-l">{label}</div>
    </div>
  );
}
