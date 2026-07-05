'use client';

import api from '@/lib/api';
import type { DocumentPhotoRow } from '@/lib/types';
import { useEffect, useState } from 'react';

const EMPTY = new Map<number, DocumentPhotoRow>();

/**
 * Миниатюры фото строк документа одним запросом (base64 в JSON, ~5 КБ на строку).
 * `enabled` включается, когда у документа появились строки (после парсинга) — до
 * этого фото в БД ещё нет. Фото — некритичное украшение: при ошибке загрузки
 * таблицы остаются с плейсхолдерами.
 */
export function useDocumentPhotos(
  documentId: string | null | undefined,
  enabled: boolean,
): Map<number, DocumentPhotoRow> {
  const [byRow, setByRow] = useState<Map<number, DocumentPhotoRow>>(EMPTY);

  useEffect(() => {
    if (!enabled || !documentId) {
      setByRow(EMPTY);
      return;
    }

    const controller = new AbortController();
    api
      .get<{ rows: DocumentPhotoRow[] }>(`/documents/${documentId}/photos`, {
        signal: controller.signal,
      })
      .then(({ data }) => setByRow(new Map(data.rows.map((r) => [r.rowIndex, r]))))
      .catch(() => {
        /* остаёмся с плейсхолдерами */
      });

    return () => controller.abort();
  }, [documentId, enabled]);

  return byRow;
}
