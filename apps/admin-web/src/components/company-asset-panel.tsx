'use client';

import { extractApiError } from '@/lib/api-error';
import api from '@/lib/api';
import { btnLink, primaryLink } from '@/lib/table-styles';
import { useEffect, useRef, useState } from 'react';

/**
 * Брендинговый ассет компании — логотип или favicon (super_admin): превью, загрузка/замена, снятие.
 * Логотип заменяет марку DirectPort в шапке/на входе, favicon — иконку вкладки браузера. Растровые
 * нормализуются на бэке в PNG, SVG — санитайзится. Превью грузим через api (с JWT) как blob —
 * <img src> к защищённому эндпоинту не пошлёт токен. `hash` в зависимостях перезагружает превью
 * после замены/снятия.
 */
export function CompanyAssetPanel({
  companyId,
  asset,
  title,
  hint,
  hash,
  onChange,
}: {
  companyId: string;
  asset: 'logo' | 'favicon';
  title: string;
  hint: string;
  hash: string | null;
  onChange: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const endpoint = `/companies/${companyId}/assets/${asset}`;

  useEffect(() => {
    if (!hash) {
      setPreview(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .get(endpoint, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data as Blob);
        setPreview(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endpoint, hash]);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.put(endpoint, form);
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!confirm(`Убрать ${title.toLowerCase()}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(endpoint);
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, maxWidth: 640 }}>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div
          style={{
            width: 96,
            height: 96,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            overflow: 'hidden',
          }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt={title}
              style={{ maxWidth: '84%', maxHeight: '84%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-subtle)' }}>нет</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              style={primaryLink}
            >
              {busy ? 'Загрузка...' : hash ? 'Заменить' : 'Загрузить'}
            </button>
            {hash && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                style={{ ...btnLink, color: 'var(--danger)' }}
              >
                Убрать
              </button>
            )}
          </div>
        </div>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>{hint}</p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
