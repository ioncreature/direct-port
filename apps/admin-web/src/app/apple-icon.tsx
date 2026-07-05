import { ImageResponse } from 'next/og';

// Иконка совпадает с лендингом (apps/landing/src/app/icon.svg):
// ink-подложка + абстрактные формы «d|p» бренда direct_port.
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
          backgroundColor: '#0B2536',
        }}
      >
        <svg viewBox="0 0 64 64" width="180" height="180">
          <circle cx="24.5" cy="37" r="9.5" fill="none" stroke="#F6F4EF" strokeWidth="7" />
          <rect x="33" y="14" width="7" height="36" rx="3.5" fill="#F6F4EF" />
          <rect x="47" y="14" width="9" height="36" rx="2.5" fill="#E8622A" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
