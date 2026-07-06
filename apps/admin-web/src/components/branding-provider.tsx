'use client';

import { createContext, useContext } from 'react';

/** Брендинг тенанта, доступный клиентским компонентам (шапка, логин). */
export interface Branding {
  /** URL логотипа тенанта для <img>; null — показываем дефолтную марку DirectPort. */
  logoUrl: string | null;
}

const BrandingContext = createContext<Branding>({ logoUrl: null });

/**
 * Прокидывает брендинг тенанта из серверного корневого layout в клиентские компоненты. Значение
 * резолвится по домену запроса (resolveBranding) и приходит уже в SSR-разметке — без вспышки.
 */
export function BrandingProvider({
  value,
  children,
}: {
  value: Branding;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
