import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { gridTheme, ConfidenceBar } from './gridTheme.jsx';

const AGENTS = ['all', 'planner', 'negotiator', 'policy', 'payments', 'verifier', 'webhook', 'human', 'system'];

function AgentBadge({ value }) {
  return <span className={`agent a-${value}`}>{value}</span>;
}

export default function AuditGrid({ audit, onOpenDeal }) {
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState('all');

  const rows = useMemo(() => (agent === 'all' ? audit : audit.filter((a) => a.agent === agent)), [audit, agent]);

  const cols = useMemo(
    () => [
      { field: 'ts', headerName: 'Time', width: 110, sort: 'desc', valueFormatter: (p) => new Date(p.value).toLocaleTimeString() },
      { field: 'agent', width: 120, cellRenderer: AgentBadge },
      { field: 'action', width: 190, cellClass: 'mono' },
      { field: 'detail', flex: 3, minWidth: 320, tooltipField: 'detail', wrapText: true, autoHeight: true, cellClass: 'wrap' },
      { field: 'confidence', width: 130, cellRenderer: ConfidenceBar },
      { field: 'engine', width: 150 },
      { field: 'dealId', headerName: 'PO', width: 120, cellClass: 'mono link' },
      { field: 'actor', width: 110 },
    ],
    [],
  );

  const csv = () => {
    const header = ['ts', 'agent', 'action', 'detail', 'confidence', 'engine', 'dealId', 'actor'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => header.map((h) => esc(r[h])).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([header.join(',') + '\n' + body], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `escrowpilot-audit-${Date.now()}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid-card">
      <div className="grid-tools">
        <input type="search" placeholder="Search every agent decision…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit" />
        <div className="seg" role="group" aria-label="Filter by agent">
          {AGENTS.map((a) => (
            <button key={a} className={agent === a ? 'on' : ''} onClick={() => setAgent(a)}>
              {a}
            </button>
          ))}
        </div>
        <button className="ghost small" onClick={csv}>
          Export CSV
        </button>
      </div>
      <div className="grid">
        <AgGridReact
          theme={gridTheme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={q}
          tooltipShowDelay={300}
          onCellClicked={(e) => e.colDef.field === 'dealId' && onOpenDeal(e.value)}
          overlayNoRowsTemplate="<span class='dim'>Every planner, negotiator, policy, payment and verifier decision lands here.</span>"
          pagination
          paginationAutoPageSize
        />
      </div>
    </div>
  );
}
