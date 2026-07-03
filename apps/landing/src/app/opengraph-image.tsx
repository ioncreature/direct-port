import { ImageResponse } from 'next/og';
import { BRAND_INK, BRAND_ORANGE, BRAND_PETROL } from './_brand';
import { ru } from './i18n/dictionaries/ru';

// Общая OG-картинка на дефолтной локали (ru): Satori не имеет фолбэка на
// системные шрифты, поэтому CJK-глифы в изображении не рендерятся. Заголовок,
// описание и meta HTML-страниц локализованы отдельно (см. [lang]/layout).
const HEADLINE_PRIMARY = ru.hero.headlinePrimary;
const HEADLINE_ACCENT = ru.hero.headlineAccent;
const TAGLINE = ru.hero.tagline;

export const alt = ru.meta.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MARK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
      "<rect width='64' height='64' rx='14' fill='#0B2536'/>" +
      "<circle cx='24.5' cy='37' r='9.5' fill='none' stroke='#F6F4EF' stroke-width='7'/>" +
      "<rect x='33' y='14' width='7' height='36' rx='3.5' fill='#F6F4EF'/>" +
      "<rect x='47' y='14' width='9' height='36' rx='2.5' fill='#E8622A'/>" +
      '</svg>',
  );

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
          backgroundColor: '#fbfaf6',
          backgroundImage:
            'radial-gradient(circle at 100% 0%, rgba(15,110,124,0.10) 0%, transparent 42%), radial-gradient(circle at 0% 100%, rgba(232,98,42,0.10) 0%, transparent 42%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={MARK} width={72} height={72} alt="" />
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>
            <span style={{ color: BRAND_INK }}>direct</span>
            <span style={{ color: BRAND_ORANGE }}>_</span>
            <span style={{ color: BRAND_PETROL }}>port</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              alignItems: 'center',
              padding: '10px 22px',
              backgroundColor: 'rgba(15,110,124,0.1)',
              color: BRAND_PETROL,
              borderRadius: 10,
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
              fontSize: 82,
              fontWeight: 800,
              color: BRAND_INK,
              letterSpacing: '-0.03em',
              lineHeight: 1.06,
            }}
          >
            <div style={{ display: 'flex' }}>{HEADLINE_PRIMARY}</div>
            <div style={{ display: 'flex', color: BRAND_ORANGE }}>{HEADLINE_ACCENT}</div>
          </div>

          <div
            style={{
              display: 'flex',
              fontSize: 28,
              color: '#33454f',
              lineHeight: 1.4,
              marginTop: 28,
              maxWidth: 980,
            }}
          >
            {ru.meta.ogSubtitle}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 22, color: '#33454f' }}>
          {ru.meta.ogPills.map((pill) => (
            <Pill key={pill}>{pill}</Pill>
          ))}
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
        border: '1px solid #e2ddd2',
        borderRadius: 999,
        fontWeight: 600,
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: BRAND_ORANGE }} />
      {children}
    </div>
  );
}
