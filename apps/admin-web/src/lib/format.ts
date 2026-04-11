export function fmt(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
