# Global Traffic — бренд-ассеты

Логотип и favicon для сайта Global Traffic (международная логистика).

## Логотип (шапка сайта)

| Файл | Назначение |
|---|---|
| `logo/global-traffic.svg` | Горизонтальный логотип для светлого фона |
| `logo/global-traffic-dark.svg` | То же для тёмного фона (светлый вордмарк) |

```html
<img src="/global-traffic.svg" alt="Global Traffic" height="32">
```

## Favicon

| Файл | Назначение |
|---|---|
| `favicon/favicon.svg` | Векторный favicon (масштабируемый, для крупных размеров) |
| `favicon/favicon.ico` | 16 / 32 / 48 px, запасной для старых браузеров |
| `favicon/favicon-16.png` … `favicon-64.png` | Растровые размеры (на 16/32 px орбита утолщена под мелкий размер) |
| `favicon/apple-touch-icon.png` | 180×180, белый фон (iOS не поддерживает прозрачность) |
| `favicon/icon-192.png`, `favicon/icon-512.png` | Иконки приложения для PWA-манифеста (прозрачный фон) |

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

`site.webmanifest` (для PWA):

```json
{ "icons": [
  { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
] }
```

## Дизайн

- **Планета** — радиальный градиент (`#4F80E8` блик → `#1D4ED8` тело → `#0F2456` тень по краю), объёмная сфера со смещённым сверху-слева бликом; сетка меридианов и параллелей.
- **Орбита + спутник** — янтарный (`#F59E0B` / `#FBBF24`), слоёная: планета перекрывает дальнюю дугу кольца.
- **Вордмарк** — Quicksand 700, переведён в векторные контуры (шрифт на стороне зрителя не требуется).
- На favicon 16/32 px орбита утолщена (`stroke 3.6` против `2.6` на крупных) для читаемости.

Все SVG самодостаточны — без внешних шрифтов и скриптов, проходят строгий SVG-санитайзер. Растровые иконки отрендерены из той же марки.
