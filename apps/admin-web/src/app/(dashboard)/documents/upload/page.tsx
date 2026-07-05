'use client';

import { useUploadDocument, type FreightCurrency } from '@/hooks/use-upload-document';
import { fmtFileSize } from '@/lib/format';
import { INCOTERMS, type Incoterms } from '@/lib/types';
import { IncotermsHelp } from '@/components/incoterms-help';
import { incotermsFreightPlaceholder, incotermsOptionLabel } from '@/lib/incoterms';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

const FREIGHT_CURRENCIES: FreightCurrency[] = ['USD', 'CNY', 'RUB', 'EUR'];

export default function UploadDocumentPage() {
  const router = useRouter();
  const { upload, uploading, error, progress } = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [freightCost, setFreightCost] = useState('');
  const [freightCurrency, setFreightCurrency] = useState<FreightCurrency>('USD');
  const [incoterms, setIncoterms] = useState<Incoterms | ''>('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const cost = freightCost.trim() ? Number(freightCost.replace(',', '.')) : 0;
    try {
      const doc = await upload(file, {
        freightCost: cost > 0 ? cost : undefined,
        freightCurrency: cost > 0 ? freightCurrency : undefined,
        incoterms: incoterms || undefined,
      });
      router.push(`/documents/${doc.id}`);
    } catch {
      /* noop */
    }
  }

  const freightGiven = freightCost.trim() !== '' && Number(freightCost.replace(',', '.')) > 0;

  return (
    <div style={{ maxWidth: 500 }}>
      <h1>Загрузка документа</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="file" style={{ display: 'block', marginBottom: 4 }}>
            Файл (.xlsx или .csv)
          </label>
          <input
            id="file"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          />
        </div>
        {file && (
          <p style={{ marginBottom: 16, color: file.size > 40 * 1024 * 1024 ? 'var(--danger)' : 'var(--text-muted)' }}>
            {file.name} ({fmtFileSize(file.size)})
            {file.size > 40 * 1024 * 1024 && ' — превышает лимит 40 МБ'}
          </p>
        )}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="freightCost" style={{ display: 'block', marginBottom: 4 }}>
            Стоимость доставки до границы (фрахт)
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="freightCost"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder={incotermsFreightPlaceholder(incoterms)}
              value={freightCost}
              onChange={(e) => setFreightCost(e.target.value)}
              style={{ flex: 1, padding: 8, boxSizing: 'border-box' }}
            />
            <select
              aria-label="Валюта фрахта"
              value={freightCurrency}
              onChange={(e) => setFreightCurrency(e.target.value as FreightCurrency)}
              style={{ padding: 8 }}
            >
              {FREIGHT_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Распределится по позициям пропорционально весу (брутто, либо нетто, если
            брутто не указан) и войдёт в таможенную стоимость для пошлины и НДС.
            Оставьте пустым, если фрахт неизвестен.
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="incoterms" style={{ display: 'block', marginBottom: 4 }}>
            Условия поставки (Инкотермс)
          </label>
          <select
            id="incoterms"
            value={incoterms}
            onChange={(e) => setIncoterms(e.target.value as Incoterms | '')}
            style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
          >
            <option value="">— не указаны —</option>
            {INCOTERMS.map((term) => (
              <option key={term} value={term}>
                {incotermsOptionLabel(term)}
              </option>
            ))}
          </select>
          {incoterms ? (
            <IncotermsHelp term={incoterms} hasFreight={freightGiven} />
          ) : (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
              Выберите базис поставки — под формой появится расшифровка и то, как он влияет на
              таможенную стоимость. При EXW/FCA/FAS/FOB доставку до границы добавляют фрахтом; при
              CFR/CIF/CPT/CIP/DAP/DPU/DDP она обычно уже в цене.
            </p>
          )}
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        {uploading && progress && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height: 8,
                backgroundColor: 'var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  backgroundColor: 'var(--accent)',
                  width: progress.total
                    ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                    : '100%',
                  transition: 'width 0.25s linear',
                  willChange: 'width',
                }}
              />
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              {progress.loaded < progress.total
                ? `Загрузка: ${fmtFileSize(progress.loaded)} из ${fmtFileSize(progress.total)} (${Math.round((progress.loaded / progress.total) * 100)}%)`
                : 'Файл загружен, обрабатывается на сервере...'}
            </p>
          </div>
        )}
        <button
          type="submit"
          disabled={uploading || !file}
          style={{ padding: '10px 24px', cursor: uploading ? 'wait' : 'pointer', marginRight: 8 }}
        >
          {uploading ? 'Загрузка...' : 'Загрузить'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/documents')}
          style={{ padding: '10px 24px', cursor: 'pointer' }}
        >
          Отмена
        </button>
      </form>
    </div>
  );
}
