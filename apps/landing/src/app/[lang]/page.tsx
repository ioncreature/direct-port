import {
  BRAND_NAME,
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  CONTACT_PHONE,
  CONTACT_PHONE_HREF,
  SITE_URL,
  TELEGRAM_BOT_URL,
} from '../_brand';
import { getDictionary, type Dictionary } from '../i18n/dictionaries';
import { defaultLocale, isLocale, pagePath, type Locale } from '../i18n/config';
import { Footer, Header, IconCheck, IconMail, IconPhone, IconTelegram } from './site-chrome';
import { CompareTable } from './compare-table';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale: Locale = isLocale(lang) ? lang : defaultLocale;
  const dict = getDictionary(locale);

  const structuredData = {
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
        mainEntity: dict.faq.items.map((it) => ({
          '@type': 'Question',
          name: it.q,
          acceptedAnswer: { '@type': 'Answer', text: it.a },
        })),
      },
    ],
  };

  return (
    <div className="page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Header dict={dict} locale={locale} />
      <main>
        <Hero dict={dict} />
        <CalcTeaser dict={dict} locale={locale} />
        <PainPoints dict={dict} />
        <Audience dict={dict} />
        <HowItWorks dict={dict} />
        <Deliverables dict={dict} />
        <ReportExample dict={dict} />
        <Pricing dict={dict} />
        <CompareTeaser dict={dict} locale={locale} />
        <WhyAccurate dict={dict} />
        <Limits dict={dict} />
        <WhatIsCalculated dict={dict} />
        <Guarantee dict={dict} />
        <Faq dict={dict} />
        <FinalCta dict={dict} />
      </main>
      <Footer dict={dict} locale={locale} />
    </div>
  );
}

function Hero({ dict }: { dict: Dictionary }) {
  const term = dict.hero.terminal;
  return (
    <section className="hero" id="top">
      <div className="container hero-inner">
        <div className="fade-up">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            {dict.hero.tagline}
          </span>
          <h1>
            {dict.hero.headlinePrimary} <span className="accent">{dict.hero.headlineAccent}</span>
            <span className="cur" aria-hidden="true" />
          </h1>
          <p className="lede">{dict.hero.lede}</p>
          <div className="hero-ctas">
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-lg"
            >
              <IconTelegram />
              {dict.hero.ctaTelegram}
            </a>
          </div>
          <p className="hero-free-note">
            <IconCheck /> {dict.hero.ctaNote}
          </p>
          <div className="hero-trust">
            {dict.hero.trust.map((t) => (
              <span key={t}>
                <IconCheck /> {t}
              </span>
            ))}
          </div>
        </div>
        <div className="fade-up delay-2" aria-hidden="true">
          <div className="term">
            <div className="term-bar">
              <span className="dot dot-r" />
              <span className="dot dot-y" />
              <span className="dot dot-g" />
              <span className="term-title">{term.fileName}</span>
            </div>
            <div className="term-body">
              {term.rows.map((row, i) => (
                <div className="ln" key={row.code}>
                  <span className="g">{String(i + 1).padStart(2, '0')}</span>
                  <span className="code">{row.code}</span>
                  <span className="desc">{row.desc}</span>
                  <span className="rate">{row.rate}</span>
                  <span className="sum">{row.sum}</span>
                  <span className={`st${row.warn ? ' st-w' : ''}`}>
                    {row.warn ? term.checkLabel : term.okLabel}
                  </span>
                </div>
              ))}
              <div className="ln ln-total">
                <span className="g">~</span>
                <span className="code">{term.totalLabel}</span>
                <span className="desc">{term.totalDesc}</span>
                <span className="rate" />
                <span className="sum">{term.totalSum}</span>
                <span className="st" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Тизер мини-калькулятора: сам калькулятор живёт на отдельной странице
 * /calculator (SEO-цель под запрос «калькулятор таможенных платежей»),
 * главная лишь анонсирует его и ведёт туда.
 */
function CalcTeaser({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.miniCalc.teaser;
  return (
    <section className="section" id="calculator">
      <div className="container">
        <div className="calc-teaser fade-up">
          <div className="calc-teaser-text">
            <span className="label">{dict.miniCalc.label}</span>
            <h2 className="heading-2">{t.heading}</h2>
            <p>{t.text}</p>
          </div>
          <div className="calc-teaser-action">
            <a href={pagePath(locale, 'calculator')} className="btn btn-primary btn-lg">
              {t.cta}
            </a>
            <p className="calc-teaser-note">
              <IconCheck /> {t.note}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PainPoints({ dict }: { dict: Dictionary }) {
  const icons = [<IconLayers key="l" />, <IconClock key="c" />, <IconCalendar key="cal" />];
  return (
    <section className="section section-alt" id="pain">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.pain.label}</span>
          <h2>{dict.pain.heading}</h2>
          <p>{dict.pain.intro}</p>
        </div>
        <div className="grid grid-3">
          {dict.pain.items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${i + 1}`}>
              <span className="icon-wrap icon-wrap-warn">{icons[i]}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
        <div className="pain-resolve fade-up">
          <IconBolt />
          <span>{dict.pain.resolve}</span>
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ dict }: { dict: Dictionary }) {
  const icons = [
    <IconTelegram key="t" />,
    <IconUpload key="u" />,
    <IconSparkles key="s" />,
    <IconDownload key="d" />,
  ];
  return (
    <section className="section section-alt" id="how">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.how.label}</span>
          <h2>{dict.how.heading}</h2>
          <p>{dict.how.intro}</p>
        </div>
        <div className="grid grid-2">
          {dict.how.steps.map((s, i) => (
            <div key={s.title} className={`card step-card fade-up delay-${i + 1}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="step-num">{i + 1}</span>
                <span className="icon-wrap">{icons[i]}</span>
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

function Deliverables({ dict }: { dict: Dictionary }) {
  const icons = [
    <IconColumns key="col" />,
    <IconLayers key="l" />,
    <IconBook key="bk" />,
    <IconDownload key="d" />,
  ];
  return (
    <section className="section" id="deliver">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.deliver.label}</span>
          <h2>{dict.deliver.heading}</h2>
          <p>{dict.deliver.intro}</p>
        </div>
        <div className="grid grid-2">
          {dict.deliver.items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${(i % 2) + 1}`}>
              <div className="deliver-card-top">
                <span className="icon-wrap">{icons[i]}</span>
                <span className="sheet-tag">{it.tag}</span>
              </div>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
        <div className="deliver-note fade-up">
          <IconRefresh />
          <span>{dict.deliver.catalogNote}</span>
        </div>
      </div>
    </section>
  );
}

function Pricing({ dict }: { dict: Dictionary }) {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.pricing.label}</span>
          <h2>
            {dict.pricing.priceMain}
            <sup className="footnote-ref">*</sup>
            {dict.pricing.priceUnit}
          </h2>
          <p>{dict.pricing.intro}</p>
        </div>
        <div className="pricing">
          <div className="card pricing-card fade-up">
            <ul className="price-tiers">
              {dict.pricing.tiers.map((t) => (
                <li key={t.count} className={`price-tier${t.free ? ' price-tier-free' : ''}`}>
                  <div className="price-tier-info">
                    <span className="price-tier-count">
                      {t.count} <span className="price-tier-unit">{dict.pricing.unit}</span>
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
            <p className="price-note">{dict.pricing.note}</p>
            <a href="#guarantee" className="price-guarantee">
              <IconShield />
              <span>{dict.pricing.guaranteeLine}</span>
            </a>
            <ul className="price-includes">
              {dict.pricing.includes.map((it) => (
                <li key={it}>
                  <IconCheck />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="price-footnote">{dict.pricing.footnote}</p>
      </div>
    </section>
  );
}

function WhyAccurate({ dict }: { dict: Dictionary }) {
  const icons = [
    <IconColumns key="col" />,
    <IconTranslate key="tr" />,
    <IconGlobe key="gl" />,
    <IconHash key="h" />,
    <IconEye key="e" />,
    <IconShield key="sh" />,
  ];
  return (
    <section className="section" id="why">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.why.label}</span>
          <h2>{dict.why.heading}</h2>
          <p>{dict.why.intro}</p>
        </div>
        <div className="grid grid-3">
          {dict.why.items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${(i % 3) + 1}`}>
              <span className="icon-wrap">{icons[i]}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatIsCalculated({ dict }: { dict: Dictionary }) {
  const icons = [
    <IconLayers key="l" />,
    <IconBadge key="b" />,
    <IconPercent key="p" />,
    <IconBook key="bk" />,
    <IconCurrency key="cu" />,
    <IconShip key="sp" />,
    <IconRoute key="rt" />,
    <IconTruck key="tk" />,
  ];
  return (
    <section className="section" id="calc">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.calc.label}</span>
          <h2>{dict.calc.heading}</h2>
          <p>{dict.calc.intro}</p>
        </div>
        <div className="grid grid-3">
          {dict.calc.items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${(i % 3) + 1}`}>
              <span className="icon-wrap">{icons[i]}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Guarantee({ dict }: { dict: Dictionary }) {
  const icons = [<IconShield key="sh" />, <IconBook key="bk" />, <IconRefresh key="rf" />];
  return (
    <section className="section section-alt" id="guarantee">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.guarantee.label}</span>
          <h2>{dict.guarantee.heading}</h2>
          <p>{dict.guarantee.intro}</p>
        </div>
        <div className="grid grid-3 guarantee-panel fade-up">
          {dict.guarantee.items.map((it, i) => (
            <div key={it.title} className="guarantee-item">
              <span className="icon-wrap icon-wrap-trust">{icons[i]}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ dict }: { dict: Dictionary }) {
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.faq.label}</span>
          <h2>{dict.faq.heading}</h2>
        </div>
        <div className="faq">
          {dict.faq.items.map((it) => (
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

function FinalCta({ dict }: { dict: Dictionary }) {
  return (
    <section className="cta-section">
      <div className="container cta-inner">
        <h2>{dict.finalCta.heading}</h2>
        <p>{dict.finalCta.text}</p>
        <div className="cta-buttons">
          <a
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-on-dark btn-lg"
          >
            <IconTelegram />
            {dict.finalCta.ctaTelegram}
          </a>
          <a href={CONTACT_EMAIL_HREF} className="btn btn-ghost-on-dark btn-lg">
            <IconMail />
            {dict.finalCta.ctaEmail}
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

function Audience({ dict }: { dict: Dictionary }) {
  const icons = [
    <IconBadge key="bd" />,
    <IconTruck key="tr" />,
    <IconShip key="sh" />,
    <IconBook key="bk" />,
  ];
  return (
    <section className="section" id="audience">
      <div className="container">
        <div className="section-head">
          <span className="label">{dict.audience.label}</span>
          <h2>{dict.audience.heading}</h2>
          <p>{dict.audience.intro}</p>
        </div>
        <div className="grid grid-2">
          {dict.audience.items.map((it, i) => (
            <div key={it.title} className={`card fade-up delay-${(i % 2) + 1}`}>
              <span className="icon-wrap">{icons[i]}</span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const NUMERIC_CELL = /^[\d\s.,%–—-]+$/;

/**
 * Числовые колонки прижимаем вправо — как в самом Excel. Тип определяет колонка
 * целиком (по первой строке), иначе одна нетипичная ячейка рвёт выравнивание.
 */
function numericColumns(sheet: Dictionary['report']['sheets'][number]): boolean[] {
  return sheet.columns.map((_, i) => NUMERIC_CELL.test(sheet.rows[0]?.[i] ?? ''));
}

function ReportExample({ dict }: { dict: Dictionary }) {
  const report = dict.report;
  return (
    <section className="section section-alt" id="report">
      <div className="container">
        <div className="section-head">
          <span className="label">{report.label}</span>
          <h2>{report.heading}</h2>
          <p>{report.intro}</p>
        </div>
        <div className="report-sheets">
          {report.sheets.map((sheet) => {
            const numeric = numericColumns(sheet);
            return (
            <article key={sheet.title} className="report-sheet fade-up">
              <header className="report-sheet-head">
                <div className="report-sheet-title">
                  <span className="sheet-tag">{sheet.tag}</span>
                  <h3>{sheet.title}</h3>
                </div>
                <p>{sheet.note}</p>
              </header>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      {sheet.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((row) => (
                      <tr key={row.join('|')}>
                        {row.map((cell, ci) => (
                          <td
                            key={sheet.columns[ci]}
                            className={numeric[ci] ? 'report-num' : undefined}
                          >
                            {cell === 'ok' || cell === 'warn' ? (
                              <span className={`report-badge report-badge-${cell}`}>
                                {report.statusLabels[cell]}
                              </span>
                            ) : (
                              cell
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            );
          })}
        </div>
        <div className="report-totals fade-up">
          <span className="report-totals-label">{report.totals.label}</span>
          <ul>
            {report.totals.items.map((it) => (
              <li key={it.name}>
                <span className="report-totals-name">{it.name}</span>
                <span className="report-totals-value">{it.value}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="report-footer">{report.footer}</p>
        <div className="report-cta">
          <a href={TELEGRAM_BOT_URL} className="btn btn-primary" rel="noopener noreferrer">
            <IconTelegram />
            {report.cta}
          </a>
        </div>
      </div>
    </section>
  );
}

function CompareTeaser({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const compare = dict.compare;
  return (
    <section className="section section-alt" id="compare">
      <div className="container">
        <div className="section-head">
          <span className="label">{compare.label}</span>
          <h2>{compare.heading}</h2>
          <p>{compare.intro}</p>
        </div>
        <div className="compare-card fade-up">
          <CompareTable data={compare} />
          <div className="compare-foot">
            <a href={pagePath(locale, 'compare')} className="btn btn-secondary">
              {compare.cta}
              <IconArrowRight />
            </a>
            <span className="compare-note">{compare.note}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Limits({ dict }: { dict: Dictionary }) {
  const limits = dict.limits;
  return (
    <section className="section section-alt" id="limits">
      <div className="container">
        <div className="section-head">
          <span className="label">{limits.label}</span>
          <h2>{limits.heading}</h2>
          <p>{limits.intro}</p>
        </div>
        <div className="grid grid-2">
          {(
            [
              ['enough', limits.enough, <IconCheck key="check" />],
              ['human', limits.human, <IconPerson key="person" />],
            ] as const
          ).map(([kind, block, icon], i) => (
            <div key={kind} className={`card limits-card limits-${kind} fade-up delay-${i + 1}`}>
              <h3>{block.title}</h3>
              <ul className="limits-list">
                {block.items.map((it) => (
                  <li key={it}>
                    {icon}
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="limits-note">{limits.note}</p>
      </div>
    </section>
  );
}

function IconArrowRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
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

function IconRoute() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
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
