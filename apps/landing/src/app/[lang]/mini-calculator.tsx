'use client';

import { useState, type FormEvent } from 'react';
import type { Dictionary } from '../i18n/dictionaries';
import { localeMeta, type Locale } from '../i18n/config';

// Зеркало PublicEstimateResult из api (apps/api/src/public-calculator).
interface EstimateResult {
  query: string;
  translatedQuery?: string;
  code: string;
  codeDescription: string;
  dutyRateDisplay: string;
  vatRate: number;
  exciseRate: number;
  currency: string;
  exchangeRate: number;
  amounts: {
    goodsRub: number;
    dutyRub: number;
    exciseRub: number;
    vatRub: number;
    paymentsRub: number;
    totalRub: number;
  };
  isEstimate: boolean;
  notes: { message: string; messageLocalized?: string }[];
  alternatives: { code: string; description: string }[];
}

const CURRENCIES = ['USD', 'CNY', 'EUR', 'RUB'] as const;

// Intl.NumberFormat дорог в конструировании, а компонент ре-рендерится на каждый
// keystroke — держим по инстансу на (локаль × точность) на весь срок жизни страницы.
const numberFormats = new Map<string, Intl.NumberFormat>();
function formatNumber(locale: Locale, value: number, maxDigits: number): string {
  const key = `${locale}:${maxDigits}`;
  let fmt = numberFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(localeMeta[locale].htmlLang, { maximumFractionDigits: maxDigits });
    numberFormats.set(key, fmt);
  }
  return fmt.format(value);
}

/** Код ТН ВЭД в принятой записи: 6403 91 300 1 (группы 4-2-3-1). */
function formatTnVed(code: string): string {
  const m = code.match(/^(\d{4})(\d{2})(\d{3})(\d)$/);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : code;
}

export function MiniCalculator({
  dict,
  locale,
  botUrl,
}: {
  dict: Dictionary['miniCalc'];
  locale: Locale;
  botUrl: string;
}) {
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('USD');
  const [weight, setWeight] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EstimateResult | null>(null);

  const fmtRub = (v: number) => `${formatNumber(locale, v, 0)} ₽`;

  const canSubmit = query.trim().length >= 2 && Number(price) > 0 && !loading;

  async function calculate(code?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          ...(code ? { code } : {}),
          price: Number(price),
          currency,
          ...(Number(weight) > 0 ? { weight: Number(weight) } : {}),
          ...(Number.isInteger(Number(quantity)) && Number(quantity) > 0
            ? { quantity: Number(quantity) }
            : {}),
          lang: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Тексты ошибок ключуются кодами API — новый код добавляется только в словари.
        const codeField = (data as { code?: string }).code ?? '';
        setError(dict.errors.byCode[codeField] ?? dict.errors.generic);
        setResult(null);
        return;
      }
      setResult(data as EstimateResult);
    } catch {
      setError(dict.errors.generic);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) void calculate();
  }

  return (
    <div className="mini-calc fade-up">
      <form className="mini-calc-form" onSubmit={onSubmit}>
        <div className="mc-field mc-field-query">
          <label htmlFor="mc-query">{dict.form.queryLabel}</label>
          <input
            id="mc-query"
            type="text"
            value={query}
            maxLength={200}
            placeholder={dict.form.queryPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mc-field">
          <label htmlFor="mc-price">{dict.form.priceLabel}</label>
          <div className="mc-price-group">
            <input
              id="mc-price"
              type="number"
              min="1"
              step="any"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <select
              aria-label="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mc-field">
          <label htmlFor="mc-weight">{dict.form.weightLabel}</label>
          <input
            id="mc-weight"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </div>
        <div className="mc-field">
          <label htmlFor="mc-qty">{dict.form.quantityLabel}</label>
          <input
            id="mc-qty"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary mc-submit" disabled={!canSubmit}>
          {loading ? dict.form.calculating : dict.form.submit}
        </button>
      </form>
      <p className="mc-hint">{dict.form.optionalHint}</p>

      {error && (
        <div className="mc-error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="mc-result" aria-live="polite">
          <div className="mc-code-row">
            <div>
              <span className="mc-code-label">{dict.result.codeLabel}</span>
              <span className="mc-code">{formatTnVed(result.code)}</span>
              {result.isEstimate && <span className="mc-badge">{dict.result.estimateBadge}</span>}
            </div>
            <p className="mc-code-desc">
              {result.codeDescription}
              {result.translatedQuery && (
                <span className="mc-translated">
                  {' '}
                  · {dict.result.searchedAs}: «{result.translatedQuery}»
                </span>
              )}
            </p>
            <div className="mc-rates">
              <span>
                {dict.result.dutyLabel}: <b>{result.dutyRateDisplay}</b>
              </span>
              <span>
                {dict.result.vatLabel}: <b>{result.vatRate}%</b>
              </span>
              {result.exciseRate > 0 && (
                <span>
                  {dict.result.exciseLabel}: <b>{result.exciseRate}%</b>
                </span>
              )}
            </div>
          </div>

          <dl className="mc-amounts">
            <div className="mc-amount">
              <dt>{dict.result.goodsLabel}</dt>
              <dd>{fmtRub(result.amounts.goodsRub)}</dd>
            </div>
            <div className="mc-amount">
              <dt>{dict.result.dutyLabel}</dt>
              <dd>{fmtRub(result.amounts.dutyRub)}</dd>
            </div>
            {result.amounts.exciseRub > 0 && (
              <div className="mc-amount">
                <dt>{dict.result.exciseLabel}</dt>
                <dd>{fmtRub(result.amounts.exciseRub)}</dd>
              </div>
            )}
            <div className="mc-amount">
              <dt>{dict.result.vatLabel}</dt>
              <dd>{fmtRub(result.amounts.vatRub)}</dd>
            </div>
            <div className="mc-amount mc-amount-main">
              <dt>{dict.result.paymentsLabel}</dt>
              <dd>{fmtRub(result.amounts.paymentsRub)}</dd>
            </div>
            <div className="mc-amount">
              <dt>{dict.result.totalLabel}</dt>
              <dd>{fmtRub(result.amounts.totalRub)}</dd>
            </div>
          </dl>

          <p className="mc-meta">
            {dict.result.exchangeRateLabel}: 1 {result.currency} ={' '}
            {formatNumber(locale, result.exchangeRate, 2)} ₽
          </p>

          {result.notes.length > 0 && (
            <ul className="mc-notes">
              {result.notes.map((n) => (
                <li key={n.message}>{n.messageLocalized ?? n.message}</li>
              ))}
            </ul>
          )}

          {result.alternatives.length > 0 && (
            <div className="mc-alternatives">
              <span>{dict.result.alternativesLabel}</span>
              <div className="mc-alt-chips">
                {result.alternatives.map((a) => (
                  <button
                    key={a.code}
                    type="button"
                    className="mc-alt-chip"
                    disabled={loading}
                    title={a.description}
                    onClick={() => void calculate(a.code)}
                  >
                    {formatTnVed(a.code)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mc-cta">
            <p>
              {dict.cta.text} <b>{dict.cta.highlight}</b>
            </p>
            <a href={botUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              {dict.cta.button}
            </a>
          </div>
        </div>
      )}

      <p className="mc-disclaimer">{dict.disclaimer}</p>
    </div>
  );
}
