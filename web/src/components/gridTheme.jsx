import { themeQuartz, colorSchemeVariable } from 'ag-grid-community';

export const gridTheme = themeQuartz.withPart(colorSchemeVariable).withParams({
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontWeight: 600,
  accentColor: '#0070e0',
  rowHoverColor: 'color-mix(in srgb, #0070e0 7%, transparent)',
  wrapperBorderRadius: 10,
  spacing: 7,
});

export const STATUS_LABEL = {
  NEGOTIATING: 'Negotiating',
  AWAITING_APPROVAL: 'Needs approval',
  APPROVED: 'Ready to fund',
  ESCROW_HELD: 'Escrow held',
  IN_REVIEW: 'In review',
  PARTIALLY_RELEASED: 'Partly released',
  RELEASED: 'Released',
  VOIDED: 'Voided',
  CLOSED: 'Closed',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE = {
  NEGOTIATING: 'info',
  AWAITING_APPROVAL: 'warn',
  APPROVED: 'warn',
  ESCROW_HELD: 'info',
  IN_REVIEW: 'warn',
  PARTIALLY_RELEASED: 'info',
  RELEASED: 'good',
  VOIDED: 'muted',
  CLOSED: 'muted',
  BLOCKED: 'bad',
  CANCELLED: 'muted',
};

export function StatusPill({ value }) {
  return <span className={`pill ${STATUS_TONE[value] || 'muted'}`}>{STATUS_LABEL[value] || value}</span>;
}

export function ConfidenceBar({ value }) {
  if (value == null) return <span className="dim">—</span>;
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? 'good' : value >= 0.6 ? 'warn' : 'bad';
  return (
    <span className="conf" title={`${pct}% confidence`}>
      <span className={`conf-bar ${tone}`} style={{ width: `${pct}%` }} />
      <span className="conf-t">{pct}%</span>
    </span>
  );
}
