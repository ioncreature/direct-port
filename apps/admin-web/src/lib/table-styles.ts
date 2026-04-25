export const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #ddd',
};
export const thR: React.CSSProperties = { ...th, textAlign: 'right' };
export const thC: React.CSSProperties = { ...th, textAlign: 'center' };
export const thSortable: React.CSSProperties = { ...th, cursor: 'pointer', userSelect: 'none' };

export const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #eee' };
export const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
export const tdC: React.CSSProperties = { ...td, textAlign: 'center' };
export const tdEmpty: React.CSSProperties = { ...td, textAlign: 'center', color: '#888' };

export const btnOutline: React.CSSProperties = {
  padding: '6px 14px',
  cursor: 'pointer',
  borderRadius: 4,
  border: '1px solid #ddd',
  background: '#fff',
  fontSize: 13,
};
export const btnLink: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};
export const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
export const btnSuccess: React.CSSProperties = {
  padding: '8px 16px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
export const btnWarning: React.CSSProperties = {
  padding: '8px 16px',
  background: '#ca8a04',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
export const btnDanger: React.CSSProperties = {
  padding: '8px 16px',
  background: '#dc2626',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
export const btnDangerOutline: React.CSSProperties = {
  padding: '8px 16px',
  background: '#fff',
  color: '#dc2626',
  border: '1px solid #dc2626',
  borderRadius: 4,
  cursor: 'pointer',
};
