'use client';

import { TabsNav } from '@/components/tabs-nav';
import { statusColors, statusLabels } from '@/lib/documents';
import { btnLink, cardSurface, primaryLink } from '@/lib/table-styles';
import type { DocumentStatus } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const TAB_IDS = ['overview', 'documents', 'result', 'calc', 'tnved', 'glossary'] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Обзор',
  documents: 'Документы',
  result: 'Результат и Excel',
  calc: 'Параметры расчёта',
  tnved: 'Справочник ТН ВЭД',
  glossary: 'Термины',
};

function isTabId(v: string): v is TabId {
  return (TAB_IDS as readonly string[]).includes(v);
}

export default function ReferenceGuide() {
  const [active, setActive] = useState<TabId>('overview');

  // Активная вкладка отражается в URL-хеше — на неё можно дать прямую ссылку.
  // Стартуем с 'overview' (SSR-безопасно), затем синхронизируемся с хешем на клиенте.
  useEffect(() => {
    const onHashChange = () => {
      const h = window.location.hash.replace('#', '');
      if (isTabId(h)) setActive(h);
    };
    onHashChange();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = useCallback((id: TabId) => {
    setActive(id);
    history.replaceState(null, '', `#${id}`);
  }, []);

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 8 }}>Справочник</h1>
      <p style={{ ...lead, marginBottom: 20 }}>
        Как устроен сервис и как с ним работать — от загрузки прайса поставщика до готового
        расчёта таможенных платежей и пакета документов к декларации. Если вы здесь впервые,
        начните с вкладки <b>«Обзор»</b>.
      </p>

      <TabsNav tabs={TAB_IDS} active={active} onChange={go} labels={TAB_LABELS} />

      {active === 'overview' && <OverviewTab go={go} />}
      {active === 'documents' && <DocumentsTab go={go} />}
      {active === 'result' && <ResultTab go={go} />}
      {active === 'calc' && <CalcTab />}
      {active === 'tnved' && <TnVedTab />}
      {active === 'glossary' && <GlossaryTab />}
    </div>
  );
}

// ─────────────────────────────────────────── Вкладка «Обзор»

function OverviewTab({ go }: { go: (id: TabId) => void }) {
  return (
    <>
      <Section title="Что делает DirectPort">
        <P>
          Сервис рассчитывает таможенные платежи при ввозе товаров в Россию. Вы загружаете
          таблицу товаров от поставщика (прайс или инвойс), а система:
        </P>
        <UL>
          <li>распознаёт структуру файла и переводит наименования на русский;</li>
          <li>подбирает и проверяет код ТН ВЭД для каждой позиции;</li>
          <li>
            считает ввозную пошлину, НДС и акциз с учётом страны происхождения, фрахта и условий
            поставки;
          </li>
          <li>
            собирает черновик декларации (<b>Проект ДТ</b>) и чек-лист разрешительных документов к
            поставке.
          </li>
        </UL>
        <P style={{ marginBottom: 0 }}>
          Наименования могут быть на любом языке (часто — китайском), цены — в любой валюте.
          Результат выгружается в Excel, готовый к импорту в декларантское ПО (Контур, Альта,
          СТМ).
        </P>
      </Section>

      <Section title="Ваша роль — декларант">
        <P>
          В меню слева вам доступны пять разделов. Вот чем занимается каждый:
        </P>
        <NavGuide />
        <P style={{ margin: '12px 0 0' }}>
          Разделы «Пользователи», «AI-расходы», «Компании» и «Настройки» доступны только
          администраторам — если вы их не видите, это нормально.
        </P>
      </Section>

      <Section title="Маршрут работы: от файла до декларации">
        <Steps
          items={[
            <>
              <b>Загрузите файл.</b> Раздел <TabLink go={go} to="documents">Документы</TabLink> →
              кнопка «Загрузить». Укажите фрахт и условия поставки, если они известны.
            </>,
            <>
              <b>Дождитесь обработки.</b> Обычно 1–15 минут. Статус документа меняется от
              «Распознавание…» до «Обработан».
            </>,
            <>
              <b>Проверьте, если система попросит.</b> Статусы «На проверку» и «Проверка кодов»
              требуют вашего решения — см. вкладку{' '}
              <TabLink go={go} to="result">Результат и Excel</TabLink>.
            </>,
            <>
              <b>Скачайте результат.</b> Excel с тремя листами: построчный расчёт, черновик
              декларации и чек-лист документов к поставке.
            </>,
          ]}
        />
        <div style={{ marginTop: 16 }}>
          <ActionLink href="/documents/upload">Загрузить документ →</ActionLink>
        </div>
      </Section>

      <Callout tone="warning">
        Расчёт — предварительная оценка на основе справочника ТН ВЭД и курсов ЦБ РФ. Итоговый код,
        ставки и перечень разрешительных документов подтверждайте у таможенного брокера или в
        органе по сертификации. Система прямо помечает позиции, требующие ручной проверки.
      </Callout>
    </>
  );
}

function NavGuide() {
  const items: { label: string; href: string; desc: string }[] = [
    { label: 'Дашборд', href: '/', desc: 'Сводка: документы по статусам, обработанные позиции, суммы платежей.' },
    { label: 'Telegram', href: '/telegram-users', desc: 'Клиенты, приславшие файлы через бота, их документы и переписка.' },
    { label: 'Документы', href: '/documents', desc: 'Основной раздел: загрузка файлов, обработка, проверка и скачивание результата.' },
    { label: 'ТН ВЭД', href: '/tn-ved', desc: 'Справочник кодов: поиск, ставки, калькулятор пошлин, разрешительные документы.' },
    { label: 'Справочник', href: '/reference', desc: 'Эта справка — как устроен сервис и как считается расчёт.' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it) => (
        <div key={it.href} style={{ ...subtleCard, display: 'flex', gap: 12, padding: '10px 12px' }}>
          <Link
            href={it.href}
            style={{
              flexShrink: 0,
              width: 96,
              color: 'var(--accent)',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {it.label}
          </Link>
          <span style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>{it.desc}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────── Вкладка «Документы»

function DocumentsTab({ go }: { go: (id: TabId) => void }) {
  return (
    <>
      <Section title="Как загрузить документ">
        <P>
          Откройте раздел <ActionLink href="/documents" inline>Документы</ActionLink> и нажмите{' '}
          <b>«Загрузить»</b>. На странице «Загрузка документа» выберите файл и при желании укажите:
        </P>
        <UL>
          <li>
            <b>Стоимость доставки до границы (фрахт)</b> и валюту — если известна. Оставьте пустым,
            если неизвестна.
          </li>
          <li>
            <b>Условия поставки (Инкотермс)</b> — базис EXW…DDP. По нему система проверяет
            корректность структуры таможенной стоимости.
          </li>
        </UL>
        <P style={{ marginBottom: 0 }}>
          Эти параметры можно не задавать при загрузке и добавить позже кнопкой «Пересчитать».
          Подробнее — на вкладке{' '}
          <TabLink go={go} to="calc">Параметры расчёта</TabLink>.
        </P>
      </Section>

      <Section title="Требования к файлу">
        <UL>
          <li>Формат — <b>.xlsx</b> или <b>.csv</b> (разделитель определяется автоматически).</li>
          <li>
            Нужны четыре колонки: <b>наименование, цена, вес, количество</b>. Какие именно столбцы
            за что отвечают, система определяет сама — заголовки и порядок могут быть любыми.
          </li>
          <li>Наименования — на любом языке; переводятся на русский автоматически.</li>
          <li>Цены — в любой валюте (одна валюта на весь документ); определяется автоматически.</li>
          <li>
            Необязательно, но помогает точности: отдельная колонка <b>страны происхождения</b>{' '}
            (перекрывает страну документа для конкретной строки), колонка <b>веса брутто</b> (для
            распределения фрахта), <b>фото товаров</b> прямо в ячейках xlsx.
          </li>
        </UL>
        <Callout tone="info" compact>
          Готовый пример входного файла есть в репозитории: <code>examples/in_1.xlsx</code>{' '}
          (китайские наименования, цены в юанях).
        </Callout>
      </Section>

      <Section title="Что происходит после загрузки">
        <P>
          Файл обрабатывается автоматически в несколько этапов. Как правило это занимает от одной
          до пятнадцати минут:
        </P>
        <Steps
          items={[
            <><b>Распознавание.</b> Определяются колонки и валюта, наименования переводятся, извлекаются данные, определяется страна происхождения.</>,
            <><b>Классификация.</b> Для каждой позиции подбирается и проверяется код ТН ВЭД; если у товара есть фото, спорные коды перепроверяются по изображению.</>,
            <><b>Расчёт.</b> Считаются пошлина, акциз и НДС, суммы конвертируются в рубли по курсу ЦБ РФ.</>,
            <><b>Готово.</b> Формируется результат и Excel; при необходимости система запрашивает вашу проверку.</>,
          ]}
        />
        <P style={{ marginBottom: 0 }}>
          Если этап сбоит из-за временной ошибки, он повторяется автоматически. Документ, который
          «завис» дольше часа, система сама переводит в «Сбой обработки» — его можно перезапустить
          кнопкой «Переобработать».
        </P>
      </Section>

      <Section title="Статусы документа">
        <P>
          Статус показан бейджем в списке документов и на странице документа. Красным отмечены
          статусы, где нужно ваше действие.
        </P>
        <StatusTable
          rows={[
            { status: 'parsing', meaning: 'Идёт распознавание файла.', action: 'Подождите.' },
            { status: 'pending', meaning: 'В очереди на расчёт.', action: 'Подождите.' },
            { status: 'processing', meaning: 'Идёт классификация и расчёт.', action: 'Подождите.' },
            { status: 'processed', meaning: 'Полностью обработан.', action: 'Скачайте Excel.' },
            { status: 'processed_with_errors', meaning: 'Обработан, но часть строк не классифицирована или не посчитана.', action: 'Excel доступен; проверьте проблемные строки.' },
            { status: 'requires_review', meaning: 'Система не уверена в распознанных данных.', action: 'Проверьте и поправьте исходные данные.' },
            { status: 'code_review_required', meaning: 'Не найдено уверенного кода ТН ВЭД.', action: 'Проверьте предложенные коды.' },
            { status: 'failed', meaning: 'Невосстановимая ошибка обработки.', action: 'Нажмите «Переобработать».' },
            { status: 'rejected', meaning: 'Документ отклонён оператором.', action: 'Действий не требуется.' },
            { status: 'intake', meaning: 'Получен от клиента через бота, ожидает запуска.', action: 'Запускает менеджер.' },
          ]}
        />
      </Section>
    </>
  );
}

function StatusTable({ rows }: { rows: { status: DocumentStatus; meaning: string; action: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.status}
          style={{
            ...subtleCard,
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            gap: 12,
            alignItems: 'start',
            padding: '10px 12px',
          }}
        >
          <div>
            <StatusBadge status={r.status} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {r.meaning} <b style={{ color: 'var(--text)' }}>{r.action}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const color = statusColors[status];
  return (
    <span style={{ ...pillBadge(color), display: 'inline-block', padding: '3px 9px' }}>
      {statusLabels[status]}
    </span>
  );
}

// ─────────────────────────────────────────── Вкладка «Результат и Excel»

function ResultTab({ go }: { go: (id: TabId) => void }) {
  return (
    <>
      <Section title="Когда нужна ваша проверка">
        <P>
          Два статуса требуют вашего решения. Откройте документ из раздела{' '}
          <ActionLink href="/documents" inline>Документы</ActionLink> и действуйте по ситуации:
        </P>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ReviewCase
            status="requires_review"
            title="Система не уверена в распознанных данных"
            body={
              <>
                Проверьте таблицу <b>«Исходные данные (проверка)»</b> — наименования, цены, вес,
                количество. Поправьте неверные ячейки. Затем: <b>«Переобработать»</b> (запустить
                расчёт с исправлениями) или <b>«Отклонить»</b> (если файл непригоден).
              </>
            }
          />
          <ReviewCase
            status="code_review_required"
            title="Нет уверенного кода ТН ВЭД"
            body={
              <>
                Раскройте <b>«Строки с низкой уверенностью»</b> и сверьте предложенные коды. Если
                код неверный — введите свой в поле <b>«Свой код»</b>. Сомневаетесь — проверьте код в{' '}
                <ActionLink href="/tn-ved" inline>справочнике ТН ВЭД</ActionLink>.
              </>
            }
          />
        </div>
      </Section>

      <Section title="Как читать результат на странице документа">
        <P>Таблица результата показывает по каждой позиции:</P>
        <UL>
          <li>наименование (переведённое) и, при наличии, миниатюру фото — клик открывает полноразмерный просмотр;</li>
          <li>код ТН ВЭД, описание кода и ставки пошлины / НДС / акциза;</li>
          <li>суммы — таможенную стоимость, пошлину, НДС, акциз и итог — в валюте документа и в рублях;</li>
          <li>
            статус проверки: <StatusDot color="var(--success)" /> зелёный — точное совпадение;{' '}
            <StatusDot color="var(--warning)" /> жёлтый — требует ручной проверки;
          </li>
          <li>замечания — предупреждения по позиции (например, о возможном занижении таможенной стоимости).</li>
        </UL>
      </Section>

      <Section title="Пересчёт без повторной загрузки">
        <P style={{ marginBottom: 0 }}>
          Кнопка <b>«Пересчитать»</b> на странице документа повторяет классификацию и расчёт с
          новыми параметрами — <b>страной происхождения</b>, <b>фрахтом</b> или <b>Инкотермс</b> —
          не разбирая файл заново. Что задаёт каждый параметр, разобрано на вкладке{' '}
          <TabLink go={go} to="calc">Параметры расчёта</TabLink>.
        </P>
      </Section>

      <Section title="Excel: три листа">
        <P>Кнопка <b>«Скачать Excel»</b> доступна для обработанных документов. В файле три листа:</P>
        <SheetCard
          n="1"
          title="Результат"
          desc="Построчный расчёт: исходные данные, код и описание ТН ВЭД, ставки, суммы товара / пошлины / НДС / акциза / итог в валюте и в рублях, сводка по разрешительным документам, номер товара ДТ (по нему декларантское ПО группирует строки)."
        />
        <SheetCard
          n="2"
          title="Проект ДТ"
          desc="Черновик декларации: строки сгруппированы в товары ДТ по коду и стране происхождения, агрегаты приведены в терминах граф (31 — описание, 33/34 — код и страна, 35/38 — вес брутто/нетто, 41 — доп. единица, 42 — цена, 45 — таможенная стоимость, 46 — статистическая стоимость, 47 — платежи). Плюс подсказки по документам графы 44, предупреждения (маркировка, антидемпинг, страновые запреты), сбор за таможенные операции и порог ДТС-1."
        />
        <SheetCard
          n="3"
          title="Документы к поставке"
          desc="Чек-лист документов, сгруппированный по моменту получения: «До заказа / производства» → «К отгрузке» → «К подаче декларации» → «На случай запроса таможни». По каждому пункту — код графы 44, статус уверенности, основание (норма) и пояснение (кто оформляет и когда)."
        />
        <Callout tone="info" compact>
          Для клиента, писавшего боту не на русском, в Excel добавляется колонка с переведёнными
          замечаниями.
        </Callout>
      </Section>
    </>
  );
}

function ReviewCase({ status, title, body }: { status: DocumentStatus; title: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--warning-soft)',
        border: '1px solid var(--warning-soft-border)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <StatusBadge status={status} />
        <b style={{ fontSize: 14, color: 'var(--text)' }}>{title}</b>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function SheetCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div style={{ ...subtleCard, display: 'flex', gap: 12, padding: '12px 14px', marginBottom: 8 }}>
      <span
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-soft)',
          color: 'var(--accent-soft-text)',
          fontWeight: 700,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>«{title}»</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>{desc}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── Вкладка «Параметры расчёта»

function CalcTab() {
  return (
    <>
      <P style={{ ...lead, marginBottom: 20 }}>
        Три параметра управляют базой расчёта: <b>страна происхождения</b> задаёт ставки,{' '}
        <b>фрахт</b> — размер таможенной стоимости, <b>Инкотермс</b> — корректность её структуры.
        Изменив любой из них, нажмите на странице документа <b>«Пересчитать»</b> — суммы обновятся
        без повторного разбора файла.
      </P>

      <Section title="Как формируется расчёт">
        <P>
          Базой для пошлины, акциза и НДС служит <b>таможенная стоимость</b> позиции — цена товара
          плюс приходящаяся на него доля фрахта до границы. Схема расчёта:
        </P>
        <div style={formula}>
          <div>Таможенная стоимость = Сумма товара + доля фрахта</div>
          <div>Пошлина = Таможенная стоимость × ставка пошлины</div>
          <div>Акциз = Таможенная стоимость × ставка акциза</div>
          <div>НДС = (Таможенная стоимость + Пошлина + Акциз) × ставка НДС</div>
          <div>Итого = Тамож. стоимость + Пошлина + Акциз + НДС</div>
        </div>
        <P style={{ marginBottom: 0 }}>
          Для комбинированных ставок (например «15%, но не менее 0,5 EUR/кг») берётся большее из
          адвалорной и специфической части.
        </P>
      </Section>

      <Section title="Страна происхождения">
        <P>
          Страна, где товар <b>произведён</b> (не откуда отгружен). По ней таможня применяет
          тарифные и нетарифные меры. Система определяет её автоматически при разборе файла — по
          явному указанию в таблице, языку описаний или валюте цен; если признаков нет, по
          умолчанию подставляется Китай. Текущий источник показан под полем (AI, вручную, по
          умолчанию). Страну можно задать и построчно — колонка в файле перекрывает страну
          документа для конкретной позиции.
        </P>
        <Influence>На что влияет:</Influence>
        <UL>
          <li>
            <b>Ставку ввозной пошлины:</b> базовую ставку, тарифные преференции для развивающихся и
            наименее развитых стран, а также антидемпинговые, специальные и компенсационные пошлины
            по отдельным странам.
          </li>
          <li>Графу 34 ДТ и группировку товаров на листе «Проект ДТ».</li>
          <li>Страновые запреты и ограничения (санкционные и ответные меры).</li>
          <li>
            Необходимость сертификата происхождения (форма СТ-1, А) — при преференциях или
            антидемпинговых мерах.
          </li>
        </UL>
      </Section>

      <Section title="Фрахт до границы">
        <P>
          Стоимость транспортировки партии до пункта пропуска на границе ЕАЭС (морской,
          автомобильный или ж/д фрахт) в валюте USD, CNY, RUB или EUR. Сумма конвертируется в
          валюту документа по курсу ЦБ РФ и распределяется между позициями пропорционально весу
          брутто × количество (Решение Коллегии ЕЭК № 83); доля включается в таможенную стоимость
          каждой позиции.
        </P>
        <Influence>На что влияет:</Influence>
        <UL>
          <li>Увеличивает <b>таможенную стоимость</b>, а через неё — базу пошлины, акциза и НДС.</li>
          <li>
            Указывайте расходы <b>только до границы ЕАЭС</b> — перевозка по территории РФ в
            таможенную стоимость не входит.
          </li>
          <li>
            Если условия поставки уже включают доставку (CIF, CIP, DAP и т. п.), повторно добавлять
            фрахт не нужно — иначе стоимость будет задвоена (система предупредит).
          </li>
        </UL>
        <P style={{ marginBottom: 0 }}>
          Чтобы сбросить ранее заданный фрахт, введите <b>0</b> или очистите поле и пересчитайте.
        </P>
      </Section>

      <Section title="Инкотермс (условия поставки)">
        <P>
          Базис поставки по Incoterms 2020 (EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU, DDP).
          Определяет, до какого момента расходы и риски несёт продавец, и попадает в графу 20 ДТ.
          Система не меняет суммы автоматически, но по значению проверяет корректность структуры
          таможенной стоимости и выдаёт предупреждения:
        </P>
        <UL>
          <li>
            <b>EXW, FCA, FAS, FOB</b> — доставка не входит в цену. Если фрахт не задан, таможенная
            стоимость может быть <b>занижена</b> — добавьте фрахт.
          </li>
          <li>
            <b>CFR, CIF, CPT, CIP, DAP, DPU, DDP</b> — доставка уже в цене. Отдельно заданный фрахт
            грозит <b>двойным счётом</b>.
          </li>
          <li><b>CIF, CIP</b> — в цену входит ещё и страхование, оно учитывается в таможенной стоимости.</li>
        </UL>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────── Вкладка «Справочник ТН ВЭД»

function TnVedTab() {
  return (
    <>
      <P style={{ ...lead, marginBottom: 20 }}>
        Раздел <ActionLink href="/tn-ved" inline>ТН ВЭД</ActionLink> — отдельный инструмент, чтобы
        вручную найти код, посмотреть ставки и прикинуть платежи по одной позиции. Он не связан с
        загруженным документом и полезен, когда нужно проверить код или сориентироваться в мерах
        регулирования.
      </P>

      <Section title="Поиск по коду и по названию">
        <P>Одно поле работает в двух режимах — режим определяется автоматически по вводу:</P>
        <UL>
          <li><b>4–10 цифр</b> — открывается карточка конкретного кода.</li>
          <li><b>Название товара</b> — таблица подходящих кодов с частотой, ставками и описанием.</li>
        </UL>
        <P>
          Искать можно на <b>русском, английском или китайском</b> — неславянский запрос система
          переводит на русский (показывает строку «Перевод запроса»). Код в любой таблице
          кликабелен — клик проваливает вас в его карточку. Рядом с кодом есть кнопка{' '}
          <b>«Копировать»</b> — копируется чистый 10-значный код без пробелов.
        </P>
      </Section>

      <Section title="Карточка кода и калькулятор">
        <P>В карточке кода показаны:</P>
        <UL>
          <li>ставки <b>пошлины, НДС и акциза</b>; расширенные ставки — антидемпинговая, компенсационная, временная, дополнительная; доп. единицы измерения; даты действия и примечания;</li>
          <li><b>страновые пошлины</b> (антидемпинговые / компенсационные / преференциальные) и условные ставки акциза с периодами и ссылками на нормативку;</li>
          <li>примеры реальных наименований, задекларированных по коду, и похожие коды.</li>
        </UL>
        <P style={{ marginBottom: 0 }}>
          Встроенный <b>калькулятор</b> считает пошлину, акциз, НДС и итог по цене и количеству
          (для специфических ставок появляется поле физической величины — вес, объём и т. п.).
          Курс валют он не подтягивает: если ставка в валюте, отличной от цены, калькулятор честно
          пометит, что для точности нужен курс.
        </P>
      </Section>

      <Section title="Разрешительные документы и ограничения">
        <P>
          Отдельный блок карточки показывает нетарифные меры по коду: подтверждение соответствия
          (ТР ТС/ЕАЭС), разрешения и лицензии, обязательную маркировку («Честный знак»),
          прослеживаемость, утилизационный сбор, меры по стратегическим товарам и страновые
          запреты. У каждой меры — бейдж точности применимости:
        </P>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <PrecisionRow color="var(--success)" label="Точное совпадение" desc="мера привязана к 8–10-значному коду — применяется к нему." />
          <PrecisionRow color="var(--warning)" label="Применима к позиции" desc="мера задана на 4–7 знаков — вероятна, но проверьте." />
          <PrecisionRow color="var(--danger)" label="Возможно применимо" desc="мера на уровне группы (≤3 знака) — перепроверьте у брокера." />
        </div>
        <P style={{ marginBottom: 0 }}>
          Сводки по мерам можно расширить AI-выжимкой (бейдж «AI») и раскрыть исходный текст из
          источника. Это справочные данные из таможенного справочника — финально сверяйте в органе
          по сертификации.
        </P>
      </Section>
    </>
  );
}

function PrecisionRow({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 14, lineHeight: 1.5 }}>
      <span style={{ ...pillBadge(color), flexShrink: 0, padding: '2px 8px' }}>
        {label}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{desc}</span>
    </div>
  );
}

// ─────────────────────────────────────────── Вкладка «Термины»

function GlossaryTab() {
  return (
    <>
      <P style={{ ...lead, marginBottom: 20 }}>
        Короткий словарь терминов, которые встречаются в интерфейсе, расчёте и выгрузке.
      </P>
      <Section title="Основные термины">
        <Term name="ТН ВЭД">
          Товарная номенклатура внешнеэкономической деятельности — 10-значный код товара. Задаёт
          ставки пошлины, НДС, акциза и перечень разрешительных мер.
        </Term>
        <Term name="ДТ">
          Декларация на товары — основной таможенный документ при импорте. Сервис формирует её
          черновик на листе «Проект ДТ».
        </Term>
        <Term name="Таможенная стоимость (ТС)">
          База для начисления платежей: цена товара плюс доля фрахта до границы ЕАЭС. От неё
          считаются пошлина, акциз и НДС.
        </Term>
        <Term name="Адвалорная / специфическая / комбинированная ставка">
          Адвалорная — процент от стоимости (10%). Специфическая — сумма за единицу физической
          величины (0,5 EUR/кг). Комбинированная — «процент, но не менее суммы за единицу».
        </Term>
        <Term name="Страна происхождения">
          Страна, где товар произведён. Определяет ставку пошлины (в т. ч. преференции и
          антидемпинг) и попадает в графу 34 ДТ.
        </Term>
        <Term name="Инкотермс">
          Условия поставки Incoterms 2020 (EXW…DDP) — до какого момента расходы и риски несёт
          продавец. Графа 20 ДТ.
        </Term>
        <Term name="Антидемпинговая / специальная / компенсационная пошлина">
          Дополнительные ввозные пошлины по отдельным странам и товарам — сверх базовой ставки.
        </Term>
        <Term name="Разрешительные документы (ТР ТС / ЕАЭС)">
          Подтверждение соответствия техрегламентам (декларация, сертификат, госрегистрация),
          лицензии и разрешения, нужные для ввоза.
        </Term>
        <Term name="«Честный знак»">
          Национальная система обязательной маркировки товаров. Для попадающих под неё категорий
          нужна регистрация и коды маркировки.
        </Term>
        <Term name="Утилизационный сбор">
          Разовый платёж за отдельные категории (транспорт, техника, упаковка) — считается по
          отдельным ставкам, не входит в пошлину.
        </Term>
        <Term name="Графы ДТ (31, 33, 41, 44, 45, 47…)">
          Пронумерованные поля декларации: 31 — описание, 33 — код ТН ВЭД, 41 — доп. единица, 44 —
          документы, 45 — таможенная стоимость, 47 — платежи. Ими оперирует лист «Проект ДТ».
        </Term>
        <Term name="Доп. единица измерения (графа 41)">
          Дополнительная единица кода ТН ВЭД (пара, штука, литр) помимо веса — требуется для
          отдельных кодов.
        </Term>
        <Term name="ДТС-1">
          Декларация таможенной стоимости — подаётся, когда стоимость партии превышает порог
          (Решение ЕЭК № 160). Система подсказывает превышение на листе «Проект ДТ».
        </Term>
        <Term name="Сбор за таможенные операции">
          Фиксированный сбор за оформление ДТ по «лестнице» ставок в зависимости от таможенной
          стоимости. Итог считается на листе «Проект ДТ».
        </Term>
        <Term name="ИТС (индекс таможенной стоимости)">
          Ориентир стоимости за килограмм нетто ($/кг) — используется таможней для оценки рисков
          занижения.
        </Term>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────── Общие блоки и стили

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...cardSurface, padding: 20, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ ...para, ...style }}>{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul style={list}>{children}</ul>;
}

function Influence({ children }: { children: React.ReactNode }) {
  return <p style={influence}>{children}</p>;
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol style={{ ...list, listStyle: 'none', paddingLeft: 0, gap: 10, counterReset: 'step' }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--accent-soft)',
              color: 'var(--accent-soft-text)',
              fontWeight: 700,
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({
  tone,
  compact,
  children,
}: {
  tone: 'info' | 'warning' | 'success';
  compact?: boolean;
  children: React.ReactNode;
}) {
  const map = {
    info: { bg: 'var(--accent-soft)', border: 'var(--accent-soft)', text: 'var(--accent-soft-text)' },
    warning: { bg: 'var(--warning-soft)', border: 'var(--warning-soft-border)', text: 'var(--warning-strong)' },
    success: { bg: 'var(--success-soft)', border: 'var(--success)', text: 'var(--success-strong)' },
  }[tone];
  return (
    <div
      style={{
        padding: compact ? '10px 14px' : '14px 16px',
        marginBottom: 16,
        marginTop: compact ? 4 : 0,
        background: map.bg,
        border: `1px solid ${map.border}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: 14,
        lineHeight: 1.6,
        color: map.text,
      }}
    >
      {children}
    </div>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, color: 'var(--text)' }}>{name}</div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
        marginRight: 2,
        verticalAlign: 'middle',
      }}
    />
  );
}

function TabLink({ go, to, children }: { go: (id: TabId) => void; to: TabId; children: React.ReactNode }) {
  return (
    <button
      onClick={() => go(to)}
      style={tabLink}
      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
    >
      {children}
    </button>
  );
}

function ActionLink({ href, children, inline }: { href: string; children: React.ReactNode; inline?: boolean }) {
  if (inline) {
    return (
      <Link href={href} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
        {children}
      </Link>
    );
  }
  return (
    <Link href={href} style={primaryLink}>
      {children}
    </Link>
  );
}

const lead: React.CSSProperties = { fontSize: 15, lineHeight: 1.6, color: 'var(--text-muted)' };
const para: React.CSSProperties = { margin: '0 0 12px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' };
const influence: React.CSSProperties = { margin: '0 0 6px', fontSize: 14, fontWeight: 600, color: 'var(--text)' };
const list: React.CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 20,
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--text-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const formula: React.CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 14px',
  margin: '0 0 12px',
  fontSize: 13,
  lineHeight: 1.9,
  color: 'var(--text)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  overflowX: 'auto',
};
/** Текстовая ссылка-кнопка для переходов между вкладками — жирнее базового btnLink. */
const tabLink: React.CSSProperties = { ...btnLink, fontWeight: 600 };

/** Приглушённая карточка-строка (пункт навигации, статус, лист Excel). */
const subtleCard: React.CSSProperties = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
};

/** Пилюля-бейдж с цветной рамкой (статус документа, точность меры). */
const pillBadge = (color: string): React.CSSProperties => ({
  borderRadius: 'var(--radius-pill)',
  border: `1px solid ${color}`,
  color,
  background: 'var(--surface)',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
});
