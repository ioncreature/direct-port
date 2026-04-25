import { ImageResponse } from 'next/og';
import {
  BRAND_GRADIENT,
  BRAND_MARK,
  BRAND_NAME,
  BRAND_PRIMARY,
  HEADLINE_ACCENT,
  HEADLINE_PRIMARY,
  SITE_TITLE,
  TAGLINE,
} from './_brand';

export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          backgroundColor: '#ffffff',
          backgroundImage:
            'radial-gradient(circle at 100% 0%, #dbe4ff 0%, transparent 45%), radial-gradient(circle at 0% 100%, #e9e4ff 0%, transparent 45%), linear-gradient(180deg, #f5f8ff 0%, #ffffff 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              backgroundImage: BRAND_GRADIENT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: '-0.04em',
              boxShadow: '0 12px 24px -8px rgba(26, 86, 219, 0.5)',
            }}
          >
            {BRAND_MARK}
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              color: '#0f172a',
              letterSpacing: '-0.02em',
              display: 'flex',
            }}
          >
            {BRAND_NAME}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              padding: '10px 22px',
              backgroundColor: 'rgba(26, 86, 219, 0.1)',
              color: BRAND_PRIMARY,
              borderRadius: 999,
              fontSize: 24,
              fontWeight: 600,
              marginBottom: 28,
            }}
          >
            {TAGLINE}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 86,
              fontWeight: 800,
              color: '#0f172a',
              letterSpacing: '-0.03em',
              lineHeight: 1.05,
            }}
          >
            <div style={{ display: 'flex' }}>{HEADLINE_PRIMARY}</div>
            <div
              style={{
                display: 'flex',
                backgroundImage: BRAND_GRADIENT,
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {HEADLINE_ACCENT}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              fontSize: 28,
              color: '#475569',
              lineHeight: 1.4,
              marginTop: 28,
              maxWidth: 980,
            }}
          >
            Загрузите прайс — получите готовый Excel с пошлинами, НДС, акцизами и логистикой по каждой позиции.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            fontSize: 22,
            color: '#475569',
          }}
        >
          <Pill>Claude AI</Pill>
          <Pill>Справочник ФТС</Pill>
          <Pill>Курсы ЦБ РФ</Pill>
          <Pill>ru / zh / en</Pill>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 18px',
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 999,
        fontWeight: 600,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          backgroundColor: BRAND_PRIMARY,
        }}
      />
      {children}
    </div>
  );
}
