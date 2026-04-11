'use client';

import { useUploadDocument } from '@/hooks/use-upload-document';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function UploadDocumentPage() {
  const router = useRouter();
  const { upload, uploading, error } = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    try {
      const doc = await upload(file);
      router.push(`/documents/${doc.id}`);
    } catch {
      // error отображается через хук
    }
  }

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
          <p style={{ marginBottom: 16, color: '#555' }}>
            {file.name} ({(file.size / 1024).toFixed(1)} КБ)
          </p>
        )}
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        {uploading && (
          <p style={{ color: '#2563eb', marginBottom: 16 }}>
            Файл загружается и обрабатывается AI-парсером. Это может занять до минуты...
          </p>
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
