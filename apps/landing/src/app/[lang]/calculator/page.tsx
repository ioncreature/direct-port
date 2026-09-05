import type { Metadata } from 'next';
import { TELEGRAM_BOT_URL } from '../../_brand';
import { getDictionary, type Dictionary } from '../../i18n/dictionaries';
import { defaultLocale, isLocale, pageMetadata, type Locale } from '../../i18n/config';
import { MiniCalculator } from '../mini-calculator';
import { Footer, Header, IconCheck } from '../site-chrome';

const SUB_PATH = 'calculator';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return pageMetadata(lang, SUB_PATH, getDictionary(lang).miniCalc.page);
}

export default async function CalculatorPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale: Locale = isLocale(lang) ? lang : defaultLocale;
  const dict: Dictionary = getDictionary(locale);
  const page = dict.miniCalc.page;

  return (
    <div className="page">
      <Header dict={dict} locale={locale} subPath={SUB_PATH} />
      <main>
        <section className="section calc-page">
          <div className="container">
            <div className="section-head">
              <span className="label">{dict.miniCalc.label}</span>
              <h1 className="heading-2">{page.heading}</h1>
              <p>{page.intro}</p>
            </div>
            <MiniCalculator dict={dict.miniCalc} locale={locale} botUrl={TELEGRAM_BOT_URL} />
            <ul className="calc-page-points">
              {page.points.map((p) => (
                <li key={p}>
                  <IconCheck /> {p}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer dict={dict} locale={locale} subPath={SUB_PATH} />
    </div>
  );
}
