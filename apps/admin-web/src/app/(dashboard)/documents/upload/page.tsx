'use client';

import { useUploadDocument } from '@/hooks/use-upload-document';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024).toFixed(1)} КБ`;
}

export default function UploadDocumentPage() {
  const router = useRouter();
  const { upload, uploading, error, progress } = useUploadDocument();
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
          <p style={{ marginBottom: 16, color: file.size > 25 * 1024 * 1024 ? '#dc2626' : '#555' }}>
            {file.name} ({file.size >= 1024 * 1024
              ? `${(file.size / 1024 / 1024).toFixed(1)} МБ`
              : `${(file.size / 1024).toFixed(1)} КБ`})
            {file.size > 25 * 1024 * 1024 && ' — превышает лимит 25 МБ'}
          </p>
        )}
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        {uploading && progress && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height: 8,
                backgroundColor: '#e5e7eb',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  backgroundColor: '#2563eb',
                  width: progress.total
                    ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                    : '100%',
                  transition: 'width 0.25s linear',
                  willChange: 'width',
                }}
              />
            </div>
            <p style={{ fontSize: 13, color: '#555', margin: 0 }}>
              {progress.loaded < progress.total
                ? `Загрузка: ${formatSize(progress.loaded)} из ${formatSize(progress.total)} (${Math.round((progress.loaded / progress.total) * 100)}%)`
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
