'use client';

import { extractApiError } from '@/lib/api-error';
import api from '@/lib/api';
import { btnLink, primaryLink } from '@/lib/table-styles';
import { useEffect, useRef, useState } from 'react';

/**
 * Логотип компании (super_admin): превью, загрузка/замена, снятие. Логотип заменяет марку
 * DirectPort в шапке и на входе admin-web для тенанта. Растровые нормализуются на бэке в PNG,
 * SVG — санитайзится. Превью грузим через api (с JWT) как blob — <img src> к защищённому
 * эндпоинту не пошлёт токен. `logoHash` в зависимостях перезагружает превью после замены/снятия.
 */
export function CompanyLogoPanel({
  companyId,
  logoHash,
  onChange,
}: {
  companyId: string;
  logoHash: string | null;
  onChange: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!logoHash) {
      setPreview(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    api
      .get(`/companies/${companyId}/logo`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data as Blob);
        setPreview(url);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [companyId, logoHash]);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      await api.put(`/companies/${companyId}/logo`, form);
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!confirm('Убрать логотип компании?')) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/companies/${companyId}/logo`);
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, maxWidth: 640 }}>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
        Логотип компании
      </div>
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
              alt="Логотип компании"
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
              {busy ? 'Загрузка...' : logoHash ? 'Заменить' : 'Загрузить'}
            </button>
            {logoHash && (
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
      <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>
        PNG, JPEG, WebP или SVG, до 2 МБ. Заменяет марку DirectPort в шапке и на странице входа для
        этого тенанта.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
    </div>
  );
}
