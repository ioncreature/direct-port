import {
  BRAND_MARK,
  BRAND_NAME,
  HEADLINE_ACCENT,
  HEADLINE_PRIMARY,
  TAGLINE,
} from './_brand';

const TELEGRAM_BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || 'https://t.me/DirectPortBot';
const CONTACT_EMAIL = 'hello@directport.ru';
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;

export default function LandingPage() {
  return (
    <div className="page">
      <Header />
      <main>
        <Hero />
        <HowItWorks />
        <WhatWeDetect />
        <WhatIsCalculated />
        <TnVed />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href="#top" className="logo">
          <span className="logo-mark">{BRAND_MARK}</span>
          <span>{BRAND_NAME}</span>
        </a>
        <nav className="nav-links" aria-label="Основная навигация">
          <a href="#how">Как работает</a>
          <a href="#detect">Что определяем</a>
          <a href="#calc">Расчёт</a>
          <a href="#tnved">Справочник</a>
        </nav>
        <div className="header-cta">
          <a href={CONTACT_EMAIL_HREF} className="btn btn-secondary">
            Связаться
          </a>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Открыть бота
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero-inner">
        <div className="fade-up">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            {TAGLINE}
          </span>
          <h1>
            {HEADLINE_PRIMARY} <span className="accent">{HEADLINE_ACCENT}</span>
          </h1>
          <p className="lede">
            Загрузите прайс-лист — на любом языке и в любой валюте. Получите готовый Excel
            с пошлинами, НДС, акцизами, логистикой и разрешительными требованиями
            по каждой позиции.
          </p>
          <div className="hero-ctas">
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              <IconTelegram />
              Открыть бота в Telegram
            </a>
            <a href={CONTACT_EMAIL_HREF} className="btn btn-secondary btn-lg">
              <IconMail />
              {CONTACT_EMAIL}
            </a>
          </div>
          <div className="hero-trust">
            <span><IconCheck /> AI на базе Claude</span>
            <span><IconCheck /> ТН ВЭД из справочника ФТС</span>
            <span><IconCheck /> Курсы ЦБ РФ</span>
            <span><IconCheck /> ru / zh / en</span>
          </div>
        </div>
        <div className="preview-wrap fade-up delay-2" aria-hidden="true">
          <div className="preview">
            <div className="preview-header">
              <span className="dot dot-r" />
              <span className="dot dot-y" />
              <span className="dot dot-g" />
              <span className="preview-title">расчёт-пошлин.xlsx</span>
            </div>
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>ТН ВЭД</th>
                  <th>Пошлина</th>
                  <th style={{ textAlign: 'right' }}>Итого, ₽</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Светильник LED 12W</td>
                  <td className="code">9405 41</td>
                  <td>5%</td>
                  <td className="num">119 400</td>
                  <td><span className="tag tag-green">Точно</span></td>
                </tr>
                <tr>
                  <td>Кружка керамическая</td>
                  <td className="code">6911 10</td>
                  <td>12%</td>
                  <td className="num">56 600</td>
                  <td><span className="tag tag-green">Точно</span></td>
                </tr>
                <tr>
                  <td>Кроссовки беговые</td>
                  <td className="code">6403 99</td>
                  <td>15% / 1.4€/пара</td>
                  <td className="num">482 100</td>
                  <td><span className="tag tag-yellow">Проверить</span></td>
                </tr>
                <tr>
                  <td>Косметика для лица</td>
                  <td className="code">3304 99</td>
                  <td>6.5%</td>
                  <td className="num">208 750</td>
                  <td><span className="tag tag-green">Точно</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: 1,
      icon: <IconUpload />,
      title: 'Загрузите прайс',
      text: 'Excel или CSV с любыми колонками — структура определяется автоматически. Рубли, юани, доллары, евро — валюта роли не играет.',
    },
    {
      num: 2,
      icon: <IconSparkles />,
      title: 'AI парсит и переводит',
      text: 'Claude извлекает наименования, цены, вес и количество. Переводит названия с китайского или английского на русский для классификации.',
    },
    {
      num: 3,
      icon: <IconChart />,
      title: 'Классификация ТН ВЭД',
      text: 'Поиск кодов в справочнике ФТС через TKS API + AI-верификация в один заход. При сомнениях AI смотрит на фото товара из xlsx и подтверждает код.',
    },
    {
      num: 4,
      icon: <IconDownload />,
      title: 'Готовый Excel',
      text: 'Пошлины, НДС, акцизы, логистика, разрешительные требования и итог — в исходной валюте и в рублях.',
    },
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head">
          <span className="label">Как это работает</span>
          <h2>От прайса до готового расчёта — четыре шага</h2>
          <p>
            Pipeline полностью автоматизирован: парсинг, классификация, интерпретация правил
            пошлин и расчёт — без участия оператора.
          </p>
        </div>
        <div className="grid grid-2">
          {steps.map((s, i) => (
            <div key={s.num} className={`card step-card fade-up delay-${i + 1}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="step-num">{s.num}</span>
                <span className="icon-wrap">{s.icon}</span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatWeDetect() {
  const items = [
    {
      icon: <IconColumns />,
      title: 'Структура таблицы и валюта',
      text: 'Какие колонки — наименование, цена, вес, количество. Любой порядок, любые заголовки.',
      signals: ['Содержимое первых строк', 'Типы данных в колонках', 'Символы валют (¥, $, €) и коды (CNY, USD)'],
    },
    {
      icon: <IconTranslate />,
      title: 'Язык и перевод наименований',
      text: 'Китайские и английские названия переводятся на русский — без точного описания нет точного кода ТН ВЭД.',
      signals: ['Исходный язык по символам и словарю', 'Доменные сокращения и единицы измерения'],
    },
    {
      icon: <IconGlobe />,
      title: 'Страна происхождения',
      text: 'Определяется, даже если в файле явно не указана. При желании выбирается вручную и пересчёт за один клик.',
      signals: [
        'Явное указание в строке',
        'Язык наименований (китайский → Китай)',
        'Валюта документа',
        'Дефолт — Китай',
      ],
    },
    {
      icon: <IconHash />,
      title: 'Код ТН ВЭД',
      text: 'Поиск в справочнике ФТС через TKS API + AI-верификация в одном запросе Claude. Спорные коды помечаются жёлтым.',
      signals: [
        'Переведённое наименование',
        'Единица измерения и категория',
        'Контекст партии',
      ],
    },
    {
      icon: <IconEye />,
      title: 'Распознавание по фото',
      text: 'Если в xlsx встроены изображения товаров и уверенность в коде низкая — vision-модель Claude смотрит на товар и подтверждает или корректирует код.',
      signals: ['Изображения, привязанные к строкам прайса', 'Сравнение с описанием и текущим кодом'],
    },
    {
      icon: <IconShield />,
      title: 'Разрешительные требования',
      text: 'Сертификация ТР ТС/ЕАЭС, лицензии, маркировка «Честный знак», утильсбор, страновые запреты — компактной сводкой в Excel.',
      signals: [
        'Флаги PRIZNAK в карточке кода ФТС',
        'Тексты NOTE про техрегламенты',
        'Страна происхождения',
      ],
    },
  ];
  return (
    <section className="section section-alt" id="detect">
      <div className="container">
        <div className="section-head">
          <span className="label">Что определяем по вашему файлу</span>
          <h2>Шесть слоёв распознавания — и видно, по каким признакам</h2>
          <p>
            На вход — обычный прайс-лист. Дальше pipeline извлекает всё, что нужно для
            таможенного расчёта, и показывает, на чём основано каждое решение.
          </p>
        </div>
        <div className="grid grid-3">
          {items.map((it, i) => (
            <div key={it.title} className={`card detect-card fade-up delay-${(i % 3) + 1}`}>
              <span className="icon-wrap">{it.icon}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
              <div className="detect-signals">
                <span className="detect-signals-label">Признаки</span>
                <ul>
                  {it.signals.map((s) => (
                    <li key={s}>
                      <IconCheckSmall />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatIsCalculated() {
  const items = [
    {
      icon: <IconLayers />,
      title: 'Комбинированные ставки',
      text: 'Например, max(15% от стоимости, 1.4 EUR за пару). AI интерпретирует текст из справочника и применяет правильную формулу.',
    },
    {
      icon: <IconBadge />,
      title: 'Акцизы',
      text: 'Для подакцизных товаров — отдельная строка в расчёте. Учитывается в базе для НДС.',
    },
    {
      icon: <IconPercent />,
      title: 'НДС с базы',
      text: 'НДС считается на сумму товара, пошлины и акциза вместе — как требует таможня. Без перепутанной базы.',
    },
    {
      icon: <IconBook />,
      title: 'Условные правила',
      text: 'Ставки, которые меняются в зависимости от страны происхождения или подакцизного признака, AI распознаёт и применяет автоматически.',
    },
    {
      icon: <IconCurrency />,
      title: 'Любая валюта',
      text: 'Юани, доллары, евро и десятки других — конвертация по курсу ЦБ РФ. В Excel суммы в исходной валюте и в рублях.',
    },
    {
      icon: <IconTruck />,
      title: 'Логистика',
      text: 'Настраиваемая формула: процент от стоимости, ставка за килограмм и фиксированная доставка. Под вашу схему работы.',
    },
  ];
  return (
    <section className="section" id="calc">
      <div className="container">
        <div className="section-head">
          <span className="label">Что внутри расчёта</span>
          <h2>Шесть факторов, которые легко упустить вручную</h2>
          <p>
            Сложные ставки и многоступенчатый НДС — основные источники ошибок при импорте.
            Сервис закрывает их по умолчанию.
          </p>
        </div>
        <div className="grid grid-3">
          {items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${(i % 3) + 1}`}>
              <span className="icon-wrap">{it.icon}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TnVed() {
  return (
    <section className="section section-alt" id="tnved">
      <div className="container tnved">
        <div className="fade-up">
          <span className="label">Бонус</span>
          <h2 className="heading-2">Полноценный справочник ТН ВЭД</h2>
          <p className="lede">
            Не только pipeline — отдельный инструмент для повседневной работы:
            найдите код, проверьте ставки, посчитайте пошлину для конкретной партии.
          </p>
          <div className="tnved-list">
            <div className="tnved-item">
              <span className="icon-wrap"><IconSearch /></span>
              <div>
                <h4>Поиск по описанию или коду</h4>
                <p>Прямой запрос в справочник ФТС через TKS API. Кликабельные коды, копирование одной кнопкой.</p>
              </div>
            </div>
            <div className="tnved-item">
              <span className="icon-wrap"><IconTranslate /></span>
              <div>
                <h4>Перевод запросов</h4>
                <p>Введите название на китайском или английском — Claude переведёт его на русский для точного поиска.</p>
              </div>
            </div>
            <div className="tnved-item">
              <span className="icon-wrap"><IconCalculator /></span>
              <div>
                <h4>Калькулятор пошлин</h4>
                <p>Любая единица измерения: килограммы, литры, м², м³, штуки. Видны и ввозная пошлина, и НДС, и акциз.</p>
              </div>
            </div>
            <div className="tnved-item">
              <span className="icon-wrap"><IconShield /></span>
              <div>
                <h4>Разрешительные документы</h4>
                <p>Сертификаты, лицензии, маркировка, утильсбор и страновые запреты — со сводкой и AI-выжимкой по каждой записи.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="preview-wrap fade-up delay-2" aria-hidden="true">
          <div className="preview">
            <div className="preview-header">
              <span className="dot dot-r" />
              <span className="dot dot-y" />
              <span className="dot dot-g" />
              <span className="preview-title">Справочник ТН ВЭД</span>
            </div>
            <div className="tnved-mock-body">
              <div className="tnved-mock-search">
                <IconSearch />
                <span>беспроводные наушники с шумоподавлением</span>
              </div>
              <div className="tnved-mock-card">
                <div className="tnved-mock-card-head">
                  <span className="tnved-mock-code">8518 30 200 0</span>
                  <span className="tag tag-green">Найдено</span>
                </div>
                <div className="tnved-mock-desc">
                  Наушники, в том числе совмещённые с микрофоном
                </div>
                <div className="tnved-mock-rates">
                  <span><strong>Пошлина:</strong> 5%</span>
                  <span><strong>НДС:</strong> 20%</span>
                  <span><strong>Акциз:</strong> —</span>
                </div>
              </div>
              <div className="tnved-mock-card">
                <div className="tnved-mock-label">Калькулятор</div>
                <div className="tnved-mock-calc">
                  <span>Стоимость:</span><span className="right">$1 200</span>
                  <span>Количество:</span><span className="right">50 шт</span>
                  <span className="total">Итого с пошлинами:</span>
                  <span className="total-value">137 280 ₽</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <h2>Готовы попробовать?</h2>
        <p>
          Первый файл — бесплатно. Регистрация не нужна — откройте бот в Telegram
          или напишите нам на {CONTACT_EMAIL}.
        </p>
        <div className="cta-buttons">
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-on-dark btn-lg"
          >
            <IconTelegram />
            Открыть бота в Telegram
          </a>
          <a href={CONTACT_EMAIL_HREF} className="btn btn-ghost-on-dark btn-lg">
            <IconMail />
            Написать на email
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>{BRAND_NAME} &copy; {new Date().getFullYear()}</span>
        <div className="footer-links">
          <a href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">Telegram</a>
        </div>
      </div>
    </footer>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

function IconCheckSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

function IconTelegram() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 3.7c-.3-.2-.7-.3-1-.2L2.5 10.4c-.6.2-1 .8-1 1.5s.4 1.2 1 1.4l4 1.4 1.6 5.1c.1.3.4.5.7.6h.2c.3 0 .5-.1.7-.3l2.7-2.7 4.7 3.4c.2.1.5.2.7.2.1 0 .3 0 .4-.1.4-.1.7-.5.8-.9L22 5c.1-.5-.1-1-.6-1.3zM10 14.6l-1 3-1-3.4 9.5-5.6L10 14.6z" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <rect x="7" y="13" width="3" height="6" rx="0.5" />
      <rect x="12" y="9" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="14" rx="0.5" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconBadge() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="6" />
      <polyline points="9 14 7 22 12 19 17 22 15 14" />
    </svg>
  );
}

function IconPercent() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
    </svg>
  );
}

function IconCurrency() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M16 8.5C16 7 14 6 12 6s-4 1-4 2.8c0 4 8 2.2 8 6.4 0 1.8-2 2.8-4 2.8s-4-1-4-2.5" />
      <line x1="12" y1="4" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="20" />
    </svg>
  );
}

function IconTruck() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="6" width="13" height="11" rx="1" />
      <path d="M14 9h4l3 3v5h-7" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="17" cy="19" r="2" />
    </svg>
  );
}

function IconColumns() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function IconHash() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2V5z" />
      <line x1="8" y1="7" x2="15" y2="7" />
      <line x1="8" y1="11" x2="15" y2="11" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function IconTranslate() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h10M9 3v2c0 5-2 9-6 12M5 9c0 4 4 8 10 9" />
      <path d="M14 22l4-9 4 9M16 18h4" />
    </svg>
  );
}

function IconCalculator() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="11" x2="9" y2="11" />
      <line x1="12" y1="11" x2="12" y2="11" />
      <line x1="16" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="9" y2="15" />
      <line x1="12" y1="15" x2="12" y2="15" />
      <line x1="16" y1="15" x2="16" y2="15" />
      <line x1="8" y1="19" x2="9" y2="19" />
      <line x1="12" y1="19" x2="12" y2="19" />
      <line x1="16" y1="19" x2="16" y2="19" />
    </svg>
  );
}
