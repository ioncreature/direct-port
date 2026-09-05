// Общий «хром» сайта: шапка, подвал, переключатель языков и используемые ими
// иконки/лого. Вынесен из page.tsx, когда появилась вторая страница (/calculator).

import {
  BRAND_NAME,
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  CONTACT_PHONE,
  CONTACT_PHONE_HREF,
  TELEGRAM_BOT_URL,
} from '../_brand';
import type { Dictionary } from '../i18n/dictionaries';
import { localeMeta, localePath, locales, pagePath, type Locale } from '../i18n/config';

/**
 * Переключатель языков. subPath сохраняет текущую страницу при смене локали
 * (например, 'calculator' → /calculator, /en/calculator, /zh/calculator).
 */
export function LangSwitch({
  dict,
  locale,
  subPath,
}: {
  dict: Dictionary;
  locale: Locale;
  subPath?: string;
}) {
  return (
    <div className="lang-switch" role="group" aria-label={dict.langSwitch.label}>
      {locales.map((l) => (
        <a
          key={l}
          href={pagePath(l, subPath)}
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

export function Header({
  dict,
  locale,
  subPath,
}: {
  dict: Dictionary;
  locale: Locale;
  subPath?: string;
}) {
  // Якоря ведут на главную — с внутренней страницы (/calculator) тоже.
  const home = localePath(locale);
  const calcPath = pagePath(locale, 'calculator');
  return (
    <header className="header">
      <div className="container header-inner">
        <a href={home} className="logo" aria-label={BRAND_NAME}>
          <LogoMark />
          <Wordmark />
        </a>
        <div className="header-right">
          <nav className="nav-links" aria-label={dict.nav.ariaLabel}>
            <a href={`${home}#how`}>{dict.nav.how}</a>
            <a href={`${home}#deliver`}>{dict.nav.deliver}</a>
            <a href={`${home}#pricing`}>{dict.nav.pricing}</a>
            <a href={calcPath} aria-current={subPath === 'calculator' ? 'page' : undefined}>
              {dict.nav.calc}
            </a>
          </nav>
          <LangSwitch dict={dict} locale={locale} subPath={subPath} />
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

export function Footer({
  dict,
  locale,
  subPath,
}: {
  dict: Dictionary;
  locale: Locale;
  subPath?: string;
}) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <LogoMark />
          <span className="footer-copy">
            {BRAND_NAME} &copy; {new Date().getFullYear()}
          </span>
        </div>
        <LangSwitch dict={dict} locale={locale} subPath={subPath} />
        <div className="footer-links">
          <a href={pagePath(locale, 'compare')}>{dict.nav.compare}</a>
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

export function LogoMark() {
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

export function Wordmark() {
  return (
    <span className="wm">
      <span className="wm-d">direct</span>
      <span className="wm-u">_</span>
      <span className="wm-p">port</span>
    </span>
  );
}

export function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

export function IconTelegram() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 3.7c-.3-.2-.7-.3-1-.2L2.5 10.4c-.6.2-1 .8-1 1.5s.4 1.2 1 1.4l4 1.4 1.6 5.1c.1.3.4.5.7.6h.2c.3 0 .5-.1.7-.3l2.7-2.7 4.7 3.4c.2.1.5.2.7.2.1 0 .3 0 .4-.1.4-.1.7-.5.8-.9L22 5c.1-.5-.1-1-.6-1.3zM10 14.6l-1 3-1-3.4 9.5-5.6L10 14.6z" />
    </svg>
  );
}

export function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

export function IconPhone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}
