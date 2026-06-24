import {
  BRAND_MARK,
  BRAND_NAME,
  HEADLINE_ACCENT,
  HEADLINE_PRIMARY,
  SITE_URL,
  TAGLINE,
} from './_brand';

const TELEGRAM_BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || 'https://t.me/direct_port_bot';
const CONTACT_EMAIL = 'hello@directport.ru';
const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;
const CONTACT_PHONE = '+7 909 760 7380';
const CONTACT_PHONE_HREF = `tel:${CONTACT_PHONE.replace(/[^+\d]/g, '')}`;

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Это готовая таможенная декларация?',
    a: 'Нет. DirectPort даёт точный расчёт пошлин, НДС, акцизов и логистики по всему прайсу — чтобы оценить себестоимость ввоза и рентабельность сделки ещё до отгрузки. Подача декларации на таможне — отдельный шаг, его делает ваш брокер или таможенный представитель, опираясь на наш расчёт.',
  },
  {
    q: 'Насколько можно доверять кодам ТН ВЭД?',
    a: 'Коды подбираются по официальному справочнику ФТС и проходят AI-верификацию. Однозначные помечаются зелёным, спорные — жёлтым «проверить» и разбираются вручную, наугад мы их не выдаём. Если в коде или ставке всё же окажется ошибка — пересчитаем бесплатно.',
  },
  {
    q: 'Что с конфиденциальностью прайса?',
    a: 'Файл используется только для расчёта вашего заказа. Мы не передаём прайсы, закупочные цены и контрагентов третьим лицам и нигде их не публикуем.',
  },
  {
    q: 'Нужно регистрироваться или ставить программу?',
    a: 'Нет. Всё происходит в Telegram: пишете боту, отправляете прайс, менеджер ведёт вас до готового файла. Ни личного кабинета, ни установки софта.',
  },
  {
    q: 'Сколько занимает расчёт?',
    a: 'Сам расчёт — около 10 минут на весь прайс, будь в нём 10 позиций или 500. Общий срок зависит от того, насколько готов файл и нужны ли уточнения по отдельным товарам.',
  },
  {
    q: 'Как и за что я плачу?',
    a: 'Пополняете баланс через менеджера — $1 за позицию. Списываем только за успешно обработанные строки, спорные и нераспознанные не тарифицируются. Без подписок и абонплаты, сумму видно до старта.',
  },
  {
    q: 'В каком виде присылать прайс?',
    a: 'Excel или CSV на любом языке (часто китайском) и в любой валюте. AI сам находит нужные колонки в любом порядке, переводит наименования и определяет валюту — переформатировать файл вручную не нужно.',
  },
];

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      email: CONTACT_EMAIL,
      telephone: CONTACT_PHONE,
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((it) => ({
        '@type': 'Question',
        name: it.q,
        acceptedAnswer: { '@type': 'Answer', text: it.a },
      })),
    },
  ],
};

export default function LandingPage() {
  return (
    <div className="page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <Header />
      <main>
        <Hero />
        <PainPoints />
        <HowItWorks />
        <Pricing />
        <WhyAccurate />
        <WhatIsCalculated />
        <Guarantee />
        <Faq />
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
          <a href="#pricing">Цена</a>
          <a href="#why">Почему точно</a>
          <a href="#guarantee">Гарантия</a>
        </nav>
        <div className="header-cta">
          <a
            href={CONTACT_EMAIL_HREF}
            className="icon-btn"
            aria-label="Написать на email"
            title="Написать на email"
          >
            <IconMail />
          </a>
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn icon-btn-primary"
            aria-label="Написать менеджеру в Telegram"
            title="Написать менеджеру в Telegram"
          >
            <IconTelegram />
          </a>
          <a
            href={CONTACT_PHONE_HREF}
            className="icon-btn"
            aria-label={`Позвонить ${CONTACT_PHONE}`}
            title={CONTACT_PHONE}
          >
            <IconPhone />
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
            Оформление одной позиции у брокера — час-полтора, а контейнер на десятки
            видов товара растягивается на недели. Мы считаем пошлины, НДС, акцизы и
            логистику по всему прайсу за 10 минут — хоть 10 позиций, хоть 500. Берите
            сборные грузы, за которые другие не берутся, и отвечайте клиенту точной
            сметой в тот же день.
          </p>
          <div className="hero-ctas">
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              <IconTelegram />
              Написать менеджеру в Telegram
            </a>
          </div>
          <p className="hero-cta-alt">
            или <a href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>
            <span aria-hidden="true"> · </span>
            <a href={CONTACT_PHONE_HREF}>{CONTACT_PHONE}</a>
          </p>
          <div className="hero-trust">
            <span><IconCheck /> 10 минут на весь прайс</span>
            <span><IconCheck /> $1 за позицию</span>
            <span><IconCheck /> до 500 позиций в файле</span>
            <span><IconCheck /> коды ТН ВЭД из справочника ФТС</span>
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

function PainPoints() {
  const items = [
    {
      icon: <IconLayers />,
      title: 'Десятки SKU в одном контейнере',
      text: 'Сборный груз — это не один товар, а десятки разных позиций. Для каждой нужен свой код ТН ВЭД и свой расчёт.',
    },
    {
      icon: <IconClock />,
      title: 'Час-полтора на позицию',
      text: 'Брокер вручную подбирает код, сверяет ставки и считает пошлину, НДС и акциз по каждой строке прайса.',
    },
    {
      icon: <IconCalendar />,
      title: 'Недели работы — и отказы',
      text: 'Сотня позиций растягивается на дни и недели. За такие грузы берётся мало кто, а клиенты уходят к тем, кто успевает.',
    },
  ];
  return (
    <section className="section section-alt" id="pain">
      <div className="container">
        <div className="section-head">
          <span className="label">Знакомая ситуация</span>
          <h2>Чем больше номенклатура — тем дороже и дольше оформление</h2>
          <p>
            На каком-то объёме ручное оформление перестаёт окупаться, и заявку проще
            отклонить, чем разбирать неделями. Это и есть потолок, в который упираются
            небольшие логистические компании.
          </p>
        </div>
        <div className="grid grid-3">
          {items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${i + 1}`}>
              <span className="icon-wrap icon-wrap-warn">{it.icon}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
        <div className="pain-resolve fade-up">
          <IconBolt />
          <span>
            DirectPort снимает этот потолок: число позиций больше не упирается
            в человеко-часы — весь прайс считается за 10 минут, будь в нём 10 строк или 500.
          </span>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      num: 1,
      icon: <IconTelegram />,
      title: 'Пишете боту в Telegram',
      text: 'Открываете бота — отвечает менеджер. Рассказываете, что за груз, без регистраций и установки софта.',
    },
    {
      num: 2,
      icon: <IconUpload />,
      title: 'Отправляете прайс',
      text: 'Excel или CSV на любом языке и в любой валюте. Менеджер пополняет ваш баланс — $1 за позицию. Списываем только за успешно обработанные строки.',
    },
    {
      num: 3,
      icon: <IconSparkles />,
      title: 'Считаем весь прайс',
      text: 'AI определяет коды ТН ВЭД по справочнику ФТС, интерпретирует ставки и считает пошлины, НДС, акцизы и логистику по каждой строке.',
    },
    {
      num: 4,
      icon: <IconDownload />,
      title: 'Готовый Excel за 10 минут',
      text: 'Менеджер присылает файл: код, ставки и итог по каждой позиции — в исходной валюте и в рублях, с разрешительными требованиями.',
    },
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head">
          <span className="label">Как это работает</span>
          <h2>От сообщения в Telegram до готового расчёта</h2>
          <p>
            Никакого личного кабинета и обучения. Менеджер ведёт вас по всему процессу —
            от файла до результата.
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

function Pricing() {
  const includes = [
    'Код ТН ВЭД из справочника ФТС с AI-верификацией',
    'Пошлина, НДС и акциз по каждой позиции',
    'Конвертация валют по курсу ЦБ РФ',
    'Фрахт до границы в таможенной стоимости',
    'Логистика по вашей формуле доставки',
    'Разрешительные требования: сертификация, маркировка, утильсбор',
    'Готовый Excel — в исходной валюте и в рублях',
  ];
  const tiers = [
    { count: 'Первые 50', price: 'Бесплатно', sub: 'проверяете качество без оплаты', free: true },
    { count: '100', price: '$100', sub: '$1 за позицию' },
    { count: '500', price: '$450', sub: '$0,90 за позицию', discount: '−10%' },
    { count: '5 000', price: '$4 000', sub: '$0,80 за позицию', discount: '−20%' },
  ];
  return (
    <section className="section section-alt" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="label">Цена</span>
          <h2>$1 за позицию.</h2>
          <p>
            Без подписок и абонплаты. Платите только за обработанные позиции — сумму
            видно до старта, а на объёме цена за позицию ниже.
          </p>
        </div>
        <div className="pricing">
          <div className="card pricing-card fade-up">
            <ul className="price-tiers">
              {tiers.map((t) => (
                <li key={t.count} className={`price-tier${t.free ? ' price-tier-free' : ''}`}>
                  <div className="price-tier-info">
                    <span className="price-tier-count">
                      {t.count} <span className="price-tier-unit">позиций</span>
                    </span>
                    <span className="price-tier-sub">{t.sub}</span>
                  </div>
                  <div className="price-tier-amount">
                    {t.discount && <span className="price-tier-badge">{t.discount}</span>}
                    <span className="price-tier-value">{t.price}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="price-note">
              Пополняете баланс у менеджера — списываем только за успешно обработанные позиции
            </p>
            <ul className="price-includes">
              {includes.map((it) => (
                <li key={it}>
                  <IconCheck />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyAccurate() {
  const items = [
    {
      icon: <IconColumns />,
      title: 'Структура таблицы и валюта',
      text: 'Сам находит колонки с наименованием, ценой, весом и количеством — в любом порядке и с любыми заголовками. Определяет валюту документа.',
    },
    {
      icon: <IconTranslate />,
      title: 'Перевод наименований',
      text: 'Китайские и английские названия переводит на русский — без точного описания не бывает точного кода ТН ВЭД.',
    },
    {
      icon: <IconGlobe />,
      title: 'Страна происхождения',
      text: 'Определяет страну, даже если в файле она явно не указана. При необходимости меняете вручную — пересчёт за один клик.',
    },
    {
      icon: <IconHash />,
      title: 'Код ТН ВЭД',
      text: 'Поиск в справочнике ФТС + AI-верификация в одном запросе. Спорные коды помечаются жёлтым «проверить».',
    },
    {
      icon: <IconEye />,
      title: 'Распознавание по фото',
      text: 'Если в xlsx встроены фото товаров и код под сомнением — vision-модель смотрит на товар и подтверждает или исправляет код.',
    },
    {
      icon: <IconShield />,
      title: 'Разрешительные требования',
      text: 'Сертификация ТР ТС/ЕАЭС, лицензии, маркировка «Честный знак», утильсбор и страновые запреты — сводкой по каждой позиции.',
    },
  ];
  return (
    <section className="section" id="why">
      <div className="container">
        <div className="section-head">
          <span className="label">Почему расчёту можно доверять</span>
          <h2>Сервис разбирает прайс так же дотошно, как опытный брокер</h2>
          <p>
            Чтобы код и ставки были верными, нужно правильно прочитать файл и понять,
            что за товар. Это берёт на себя AI — а спорные позиции честно помечает
            на проверку, а не выдаёт наугад.
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
      icon: <IconShip />,
      title: 'Фрахт до границы',
      text: 'Стоимость доставки до границы распределяется по позициям пропорционально весу и входит в таможенную стоимость — то есть в базу пошлины, акциза и НДС, как требует ТК ЕАЭС.',
    },
    {
      icon: <IconTruck />,
      title: 'Логистика',
      text: 'Настраиваемая формула: процент от стоимости, ставка за килограмм и фиксированная доставка. Под вашу схему работы.',
    },
  ];
  return (
    <section className="section section-alt" id="calc">
      <div className="container">
        <div className="section-head">
          <span className="label">Что внутри расчёта</span>
          <h2>Считает то, что легко упустить вручную</h2>
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

function Guarantee() {
  const items = [
    {
      icon: <IconShield />,
      title: 'Наугад не выдаём',
      text: 'Однозначные коды помечаем зелёным, спорные — жёлтым «проверить» и разбираем вручную. В расчёте сразу видно, где всё точно, а где нужна доп. проверка.',
    },
    {
      icon: <IconBook />,
      title: 'Ставки — из справочника ФТС',
      text: 'Каждый код и ставка берутся из официального справочника ФТС, а не из «памяти» AI. Источник тот же, по которому работает таможня.',
    },
    {
      icon: <IconRefresh />,
      title: 'Ошиблись — пересчёт за наш счёт',
      text: 'Нашли ошибку в коде или ставке — пересчитаем бесплатно и дадим скидку 50% на следующие 100 позиций. За результат отвечаем деньгами.',
    },
  ];
  return (
    <section className="section" id="guarantee">
      <div className="container">
        <div className="section-head">
          <span className="label">Гарантия точности</span>
          <h2>Отвечаем за каждый код</h2>
          <p>
            Точность в классификации ТН ВЭД нельзя обещать на словах — поэтому мы
            подкрепляем её процессом и обязательством: помечаем спорное, опираемся на
            официальный справочник и исправляем ошибки за свой счёт.
          </p>
        </div>
        <div className="grid grid-3 guarantee-panel fade-up">
          {items.map((it) => (
            <div key={it.title} className="guarantee-item">
              <span className="icon-wrap icon-wrap-trust">{it.icon}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="section section-alt" id="faq">
      <div className="container">
        <div className="section-head">
          <span className="label">Вопросы</span>
          <h2>Коротко о главном</h2>
        </div>
        <div className="faq">
          {FAQ_ITEMS.map((it) => (
            <details key={it.q} className="faq-item">
              <summary>
                <span>{it.q}</span>
                <IconChevron />
              </summary>
              <p>{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <h2>Посчитаем ваш контейнер за 10 минут</h2>
        <p>
          Напишите менеджеру в Telegram, пришлите прайс — и получите готовый расчёт
          по каждой позиции. $1 за позицию, без подписок.
        </p>
        <div className="cta-buttons">
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-on-dark btn-lg"
          >
            <IconTelegram />
            Написать менеджеру в Telegram
          </a>
          <a href={CONTACT_EMAIL_HREF} className="btn btn-ghost-on-dark btn-lg">
            <IconMail />
            Написать на email
          </a>
          <a href={CONTACT_PHONE_HREF} className="btn btn-ghost-on-dark btn-lg">
            <IconPhone />
            {CONTACT_PHONE}
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
          <a href={CONTACT_PHONE_HREF}>{CONTACT_PHONE}</a>
          <a href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">Telegram</a>
        </div>
      </div>
    </footer>
  );
}

function IconRefresh() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function IconPhone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
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

function IconDownload() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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

function IconShip() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.4 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.9 5.3 2.8 7.8" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
      <path d="M12 10v4M12 2v3" />
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

function IconTranslate() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h10M9 3v2c0 5-2 9-6 12M5 9c0 4 4 8 10 9" />
      <path d="M14 22l4-9 4 9M16 18h4" />
    </svg>
  );
}

