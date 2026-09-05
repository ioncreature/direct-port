import type { CompareTableData } from '../i18n/dictionaries/ru';

/**
 * Таблица сравнения — общая для тизера на главной и страницы /compare.
 * Колонка DirectPort выделяется через `:last-child` в CSS, чтобы правило
 * «наша колонка — последняя» жило в одном месте, а не в индексной арифметике.
 */
export function CompareTable({
  data,
  cornerLabel,
  caption,
  className,
}: {
  data: CompareTableData;
  cornerLabel?: string;
  caption?: string;
  className?: string;
}) {
  return (
    <div className="table-scroll">
      <table className={className ? `compare-table ${className}` : 'compare-table'}>
        {caption && <caption className="compare-caption">{caption}</caption>}
        <thead>
          <tr>
            <th>{cornerLabel}</th>
            {data.columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((value, i) => (
                <td key={data.columns[i]}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
