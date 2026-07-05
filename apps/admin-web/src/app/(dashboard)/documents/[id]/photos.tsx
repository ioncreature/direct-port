'use client';

import api from '@/lib/api';
import type { DocumentPhotoRow } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

/**
 * Миниатюра фото строки (data-URI из GET /documents/:id/photos) либо плейсхолдер.
 * Клик открывает полноразмерный просмотр (PhotoLightbox); stopPropagation — строки
 * таблицы результатов раскрываются по клику на всю строку.
 */
export function PhotoThumb({
  photo,
  size,
  onOpen,
}: {
  photo?: DocumentPhotoRow;
  size: number;
  onOpen?: (photo: DocumentPhotoRow) => void;
}) {
  if (!photo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: 'var(--bg)',
          borderRadius: size > 60 ? 6 : 4,
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-subtle)',
          fontSize: size > 60 ? 13 : 11,
        }}
      >
        {size > 60 ? 'Нет фото' : 'img'}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {/* data-URI миниатюра, next/image не даст здесь ничего */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumb}
        alt={`Фото строки ${photo.rowIndex + 1}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.(photo);
        }}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: size > 60 ? 6 : 4,
          border: '1px solid var(--border)',
          background: '#fff',
          cursor: onOpen ? 'zoom-in' : 'default',
          display: 'block',
        }}
      />
      {photo.photoIds.length > 1 && (
        <span
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {photo.photoIds.length}
        </span>
      )}
    </div>
  );
}

/**
 * Модалка полноразмерного (≤1024px) фото. Байты грузятся blob'ом через api-клиент
 * (иначе <img src> не пошлёт JWT) — повторные показы закрывает HTTP-кэш браузера
 * (endpoint отдаёт ETag + immutable). При нескольких фото строки — листание ←/→.
 */
export function PhotoLightbox({
  documentId,
  photo,
  onClose,
}: {
  documentId: string;
  photo: DocumentPhotoRow;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const photoId = photo.photoIds[idx];

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    api
      .get<Blob>(`/documents/${documentId}/photos/${photoId}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, photoId]);

  const prev = useCallback(
    () => setIdx((i) => (i - 1 + photo.photoIds.length) % photo.photoIds.length),
    [photo.photoIds.length],
  );
  const next = useCallback(
    () => setIdx((i) => (i + 1) % photo.photoIds.length),
    [photo.photoIds.length],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (photo.photoIds.length > 1) {
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, prev, next, photo.photoIds.length]);

  const navBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 22,
    width: 40,
    height: 40,
    borderRadius: '50%',
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
      }}
    >
      {photo.photoIds.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          aria-label="Предыдущее фото"
          style={navBtn}
        >
          &#8592;
        </button>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          maxWidth: '85vw',
        }}
      >
        {error ? (
          <div style={{ color: '#fff', fontSize: 14 }}>Не удалось загрузить фото</div>
        ) : url ? (
          // blob objectURL, next/image неприменим
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Фото строки ${photo.rowIndex + 1}`}
            style={{
              maxWidth: '85vw',
              maxHeight: '80vh',
              borderRadius: 8,
              background: '#fff',
            }}
          />
        ) : (
          <div style={{ color: '#fff', fontSize: 14 }}>Загрузка...</div>
        )}
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
          Строка {photo.rowIndex + 1}
          {photo.photoIds.length > 1 && ` — фото ${idx + 1} / ${photo.photoIds.length}`}
        </div>
      </div>

      {photo.photoIds.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          aria-label="Следующее фото"
          style={navBtn}
        >
          &#8594;
        </button>
      )}

      <button
        onClick={onClose}
        aria-label="Закрыть"
        style={{
          position: 'absolute',
          top: 16,
          right: 20,
          background: 'none',
          border: 'none',
          color: '#fff',
          fontSize: 28,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        &times;
      </button>
    </div>
  );
}
