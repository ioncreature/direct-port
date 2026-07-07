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
import {
  defaultLocale,
  isLocale,
  localeMeta,
  localePath,
  locales,
  type Locale,
} from '../i18n/config';

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
        <PainPoints dict={dict} />
        <HowItWorks dict={dict} />
        <Deliverables dict={dict} />
        <Pricing dict={dict} />
        <WhyAccurate dict={dict} />
        <WhatIsCalculated dict={dict} />
        <Guarantee dict={dict} />
        <Faq dict={dict} />
        <FinalCta dict={dict} />
      </main>
      <Footer dict={dict} locale={locale} />
    </div>
  );
}

function LangSwitch({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <div className="lang-switch" role="group" aria-label={dict.langSwitch.label}>
      {locales.map((l) => (
        <a
          key={l}
          href={localePath(l)}
          hrefLang={localeMeta[l].htmlLang}
          className={`lang-opt${l === locale ? ' lang-opt-active' : ''}`}
          aria-current={l === locale ? 'true' : undefined}
        >
          {localeMeta[l].short}
        </a>
      ))}
    </div>
  );
}

function Header({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <header className="header">
      <div className="container header-inner">
        <a href={localePath(locale)} className="logo" aria-label={BRAND_NAME}>
          <LogoMark />
          <Wordmark />
        </a>
        <div className="header-right">
          <nav className="nav-links" aria-label={dict.nav.ariaLabel}>
            <a href="#how">{dict.nav.how}</a>
            <a href="#deliver">{dict.nav.deliver}</a>
            <a href="#pricing">{dict.nav.pricing}</a>
            <a href="#why">{dict.nav.why}</a>
            <a href="#guarantee">{dict.nav.guarantee}</a>
          </nav>
          <LangSwitch dict={dict} locale={locale} />
          <div className="header-cta">
            <a
              href={CONTACT_EMAIL_HREF}
              className="icon-btn"
              aria-label={dict.header.emailLabel}
              title={dict.header.emailLabel}
            >
              <IconMail />
            </a>
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn icon-btn-primary"
              aria-label={dict.header.telegramLabel}
              title={dict.header.telegramLabel}
            >
              <IconTelegram />
            </a>
            <a
              href={CONTACT_PHONE_HREF}
              className="icon-btn"
              aria-label={`${dict.header.phoneLabel} ${CONTACT_PHONE}`}
              title={CONTACT_PHONE}
            >
              <IconPhone />
            </a>
          </div>
        </div>
      </div>
    </header>
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
          <p className="hero-cta-alt">
            {dict.hero.ctaAltPrefix} <a href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>
            <span aria-hidden="true"> · </span>
            <a href={CONTACT_PHONE_HREF}>{CONTACT_PHONE}</a>
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
    <section className="section" id="how">
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
    <section className="section section-alt" id="deliver">
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
    <section className="section section-alt" id="why">
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

function Footer({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <LogoMark />
          <span className="footer-copy">
            {BRAND_NAME} &copy; {new Date().getFullYear()}
          </span>
        </div>
        <LangSwitch dict={dict} locale={locale} />
        <div className="footer-links">
          <a href={CONTACT_PHONE_HREF}>{CONTACT_PHONE}</a>
          <a href={CONTACT_EMAIL_HREF}>{CONTACT_EMAIL}</a>
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
        </div>
      </div>
    </footer>
  );
}

function LogoMark() {
  return (
    <svg
      className="logo-mark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width="32"
      height="32"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#0B2536" />
      <circle cx="24.5" cy="37" r="9.5" fill="none" stroke="#F6F4EF" strokeWidth="7" />
      <rect x="33" y="14" width="7" height="36" rx="3.5" fill="#F6F4EF" />
      <rect x="47" y="14" width="9" height="36" rx="2.5" fill="#E8622A" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="wm">
      <span className="wm-d">direct</span>
      <span className="wm-u">_</span>
      <span className="wm-p">port</span>
    </span>
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
