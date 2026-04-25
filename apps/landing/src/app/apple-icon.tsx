import { ImageResponse } from 'next/og';
import { BRAND_GRADIENT, BRAND_MARK } from './_brand';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: BRAND_GRADIENT,
          color: '#ffffff',
          fontSize: 86,
          fontWeight: 800,
          letterSpacing: '-0.05em',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {BRAND_MARK}
      </div>
    ),
    { ...size },
  );
}
