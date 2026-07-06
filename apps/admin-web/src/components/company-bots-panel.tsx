'use client';

import { extractApiError } from '@/lib/api-error';
import api from '@/lib/api';
import { btnLink, primaryLink } from '@/lib/table-styles';
import type { CompanyBotsStatus } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

type BotKind = 'client' | 'manager';

/**
 * Управление ботами компании (super_admin): токен клиентского и менеджерского ботов.
 * Раскрывается под строкой компании. Токен валидируется на бэкенде через getMe.
 */
export function CompanyBotsPanel({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<CompanyBotsStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<CompanyBotsStatus>(`/companies/${companyId}/bots`);
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div style={{ color: 'var(--text-subtle)' }}>Загрузка ботов...</div>;
  if (!status) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <BotControl
        companyId={companyId}
        kind="client"
        label="Клиентский бот"
        state={status.client}
        onChange={load}
      />
      <BotControl
        companyId={companyId}
        kind="manager"
        label="Менеджерский бот"
        state={status.manager}
        onChange={load}
      />
    </div>
  );
}

function BotControl({
  companyId,
  kind,
  label,
  state,
  onChange,
}: {
  companyId: string;
  kind: BotKind;
  label: string;
  state: CompanyBotsStatus['client'];
  onChange: () => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.put(`/companies/${companyId}/bots/${kind}`, { token: token.trim() });
      setToken('');
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Убрать ${label.toLowerCase()}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/companies/${companyId}/bots/${kind}`);
      await onChange();
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
      {state.configured ? (
        <div style={{ marginBottom: 10 }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>@{state.username}</span>
          <button
            onClick={remove}
            disabled={busy}
            style={{ ...btnLink, color: 'var(--danger)', marginLeft: 12 }}
          >
            Убрать
          </button>
        </div>
      ) : (
        <div style={{ color: 'var(--text-subtle)', fontSize: 13, marginBottom: 10 }}>не настроен</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Токен от @BotFather"
          type="password"
          style={{ flex: 1, padding: 6, boxSizing: 'border-box' }}
        />
        <button onClick={save} disabled={busy || !token.trim()} style={primaryLink}>
          {state.configured ? 'Заменить' : 'Сохранить'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 6 }}>{error}</p>}
    </div>
  );
}
