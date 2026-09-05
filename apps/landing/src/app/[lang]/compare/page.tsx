import type { Metadata } from 'next';
import { TELEGRAM_BOT_URL } from '../../_brand';
import { getDictionary, type Dictionary } from '../../i18n/dictionaries';
import { defaultLocale, isLocale, pageMetadata, type Locale } from '../../i18n/config';
import { Footer, Header, IconCheck, IconTelegram } from '../site-chrome';
import { CompareTable } from '../compare-table';

const SUB_PATH = 'compare';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return pageMetadata(lang, SUB_PATH, getDictionary(lang).comparePage);
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const locale: Locale = isLocale(lang) ? lang : defaultLocale;
  const dict: Dictionary = getDictionary(locale);
  const page = dict.comparePage;

  return (
    <div className="page">
      <Header dict={dict} locale={locale} subPath={SUB_PATH} />
      <main>
        <section className="section compare-page">
          <div className="container">
            <div className="section-head">
              <span className="label">{dict.compare.label}</span>
              <h1 className="heading-2">{page.heading}</h1>
              <p>{page.intro}</p>
            </div>

            <div className="compare-card">
              <CompareTable
                data={page}
                cornerLabel={page.criterionLabel}
                caption={page.tableCaption}
                className="compare-table-full"
              />
            </div>

            <div className="compare-sections">
              {page.sections.map((section) => (
                <article key={section.title} className="card compare-section">
                  <h2>{section.title}</h2>
                  <p className="compare-who">{section.who}</p>
                  <dl className="compare-facets">
                    <dt className="compare-facet-good" aria-hidden="true">
                      +
                    </dt>
                    <dd>{section.good}</dd>
                    <dt className="compare-facet-limit" aria-hidden="true">
                      −
                    </dt>
                    <dd>{section.limit}</dd>
                  </dl>
                  <p className="compare-us-note">
                    <IconCheck />
                    <span>{section.us}</span>
                  </p>
                </article>
              ))}
            </div>

            <div className="compare-disclaimer">
              <h2>{page.disclaimerTitle}</h2>
              <p>{page.disclaimer}</p>
              <h3>{page.sourcesTitle}</h3>
              <ul className="compare-sources">
                {page.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="nofollow noopener noreferrer">
                      {source.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="compare-cta">
              <h2>{page.ctaHeading}</h2>
              <p>{page.ctaText}</p>
              <a href={TELEGRAM_BOT_URL} className="btn btn-primary btn-lg" rel="noopener noreferrer">
                <IconTelegram />
                {dict.finalCta.ctaTelegram}
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer dict={dict} locale={locale} subPath={SUB_PATH} />
    </div>
  );
}
