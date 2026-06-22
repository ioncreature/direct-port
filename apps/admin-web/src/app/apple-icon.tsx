import { ImageResponse } from 'next/og';

// Иконка совпадает с лендингом (apps/landing/src/app/apple-icon.tsx):
// брендовый градиент + монограмма «DP».
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
          backgroundImage: 'linear-gradient(135deg, #1a56db 0%, #6366f1 100%)',
          color: '#ffffff',
          fontSize: 86,
          fontWeight: 800,
          letterSpacing: '-0.05em',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        DP
      </div>
    ),
    { ...size },
  );
}
