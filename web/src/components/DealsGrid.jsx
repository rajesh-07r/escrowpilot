import React, { useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { gridTheme, StatusPill, ConfidenceBar, STATUS_LABEL } from './gridTheme.jsx';
import { usd } from '../api.js';

const money = (p) => usd(p.value);

export default function DealsGrid({ deals, onOpen }) {
  const [q, setQ] = useState('');

  const rows = useMemo(
    () =>
      deals.map((d) => {
        const total = d.selected?.total ?? null;
        const captured = d.paypal?.captured || 0;
        const msDone = d.milestones.filter((m) => !['pending', 'review'].includes(m.status)).length;
        return {
          id: d.id,
          created: d.createdAt,
          status: d.status,
          item: d.selected ? `${d.selected.quantity}× ${d.selected.name}` : `${d.item.quantity}× ${d.item.category.replace('_', ' ')}`,
          vendor: d.selected?.vendorName ?? '—',
          total,
          savings: d.selected?.savings ?? null,
          held: ['ESCROW_HELD', 'PARTIALLY_RELEASED', 'IN_REVIEW'].includes(d.status) ? (total || 0) - captured : 0,
          captured,
          milestones: `${msDone}/${d.milestones.length}`,
          confidence: d.selected?.confidence ?? null,
          engine: d.engine?.negotiator ?? '—',
          orderId: d.paypal?.orderId ?? '',
          authId: d.paypal?.authorizationId ?? '',
          webhook: d.paypal?.lastWebhook ?? '',
          note: d.status === 'BLOCKED' ? `Blocked: ${d.blockReason}` : '',
        };
      }),
    [deals],
  );

  const cols = useMemo(
    () => [
      { field: 'id', headerName: 'PO', width: 120, pinned: 'left', cellClass: 'mono' },
      { field: 'status', width: 150, cellRenderer: StatusPill, filter: 'agTextColumnFilter', filterValueGetter: (p) => STATUS_LABEL[p.data.status] },
      { field: 'item', flex: 2, minWidth: 220, tooltipField: 'item' },
      { field: 'vendor', minWidth: 160, flex: 1 },
      { field: 'total', headerName: 'PO value', width: 120, type: 'rightAligned', valueFormatter: money, filter: 'agNumberColumnFilter' },
      { field: 'held', headerName: 'In escrow', width: 120, type: 'rightAligned', valueFormatter: money, cellClassRules: { strong: (p) => p.value > 0 } },
      { field: 'captured', headerName: 'Released', width: 120, type: 'rightAligned', valueFormatter: money },
      { field: 'savings', headerName: 'Saved', width: 105, type: 'rightAligned', valueFormatter: money, cellClass: 'good-t' },
      { field: 'milestones', headerName: 'Milestones', width: 115 },
      { field: 'confidence', headerName: 'Agent conf.', width: 130, cellRenderer: ConfidenceBar },
      { field: 'engine', headerName: 'Engine', width: 110, hide: false },
      { field: 'orderId', headerName: 'PayPal order', width: 170, cellClass: 'mono' },
      { field: 'authId', headerName: 'Authorization', width: 170, cellClass: 'mono' },
      { field: 'webhook', headerName: 'Last webhook', width: 200, cellClass: 'mono' },
      { field: 'note', headerName: 'Notes', flex: 1, minWidth: 200, tooltipField: 'note' },
      { field: 'created', headerName: 'Created', width: 160, sort: 'desc', valueFormatter: (p) => new Date(p.value).toLocaleString() },
    ],
    [],
  );

  return (
    <div className="grid-card">
      <div className="grid-tools">
        <input type="search" placeholder="Filter ledger… (vendor, status, PO, order id)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter ledger" />
        <span className="dim">Click a row to open the deal · columns are sortable, filterable and resizable</span>
      </div>
      <div className="grid">
        <AgGridReact
          theme={gridTheme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true, filter: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={q}
          animateRows
          tooltipShowDelay={300}
          onRowClicked={(e) => onOpen(e.data.id)}
          rowClass="clickable"
          overlayNoRowsTemplate="<span class='dim'>No deals yet – describe a purchase on the left and let the agents work.</span>"
          pagination
          paginationAutoPageSize
        />
      </div>
    </div>
  );
}
