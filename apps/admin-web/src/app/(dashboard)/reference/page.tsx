import { cardSurface } from '@/lib/table-styles';
import Link from 'next/link';

export const metadata = { title: 'Справочник — DirectPort' };

export default function ReferencePage() {
  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ marginBottom: 8 }}>Справочник</h1>
      <p style={{ ...lead, marginBottom: 24 }}>
        Как параметры на странице документа влияют на расчёт пошлин, налогов и таможенной
        стоимости. Изменив любой из них, нажмите <b>«Пересчитать»</b> — классификация и суммы
        обновятся без повторного разбора файла.
      </p>

      <Section title="Как формируется расчёт">
        <p style={para}>
          Базой для пошлины, акциза и НДС служит <b>таможенная стоимость</b> позиции — цена
          товара плюс приходящаяся на него доля фрахта до границы. Схема расчёта:
        </p>
        <div style={formula}>
          <div>Таможенная стоимость = Сумма товара + доля фрахта</div>
          <div>Пошлина = Таможенная стоимость × ставка пошлины</div>
          <div>Акциз = Таможенная стоимость × ставка акциза</div>
          <div>НДС = (Таможенная стоимость + Пошлина + Акциз) × ставка НДС</div>
          <div>Итого = Тамож. стоимость + Пошлина + Акциз + НДС</div>
        </div>
        <p style={{ ...para, marginBottom: 0 }}>
          Три параметра ниже управляют этой базой: <b>страна происхождения</b> задаёт ставки,
          <b> фрахт</b> — размер таможенной стоимости, <b>Инкотермс</b> — корректность её
          структуры.
        </p>
      </Section>

      <Section id="country" title="Страна происхождения">
        <p style={para}>
          Страна, где товар <b>произведён</b> (не откуда отгружен). По ней таможня применяет
          тарифные и нетарифные меры. Система определяет её автоматически при разборе файла — по
          явному указанию в таблице, языку описаний или валюте цен; если признаков нет, по
          умолчанию подставляется Китай. Текущий источник показан под полем (AI, вручную, по
          умолчанию). Страну можно задать и построчно — колонка в файле перекрывает страну
          документа для конкретной позиции.
        </p>
        <p style={influence}>На что влияет:</p>
        <ul style={list}>
          <li>
            <b>Ставку ввозной пошлины:</b> базовую ставку, тарифные преференции для развивающихся
            и наименее развитых стран, а также антидемпинговые, специальные и компенсационные
            пошлины по отдельным странам.
          </li>
          <li>Графу 34 ДТ и группировку товаров на листе «Проект ДТ».</li>
          <li>Страновые запреты и ограничения (санкционные и ответные меры).</li>
          <li>
            Необходимость сертификата происхождения (форма СТ-1, А) — при преференциях или
            антидемпинговых мерах.
          </li>
        </ul>
      </Section>

      <Section id="freight" title="Фрахт до границы">
        <p style={para}>
          Стоимость транспортировки партии до пункта пропуска на границе ЕАЭС (морской,
          автомобильный или ж/д фрахт) в валюте USD, CNY, RUB или EUR. Сумма конвертируется в
          валюту документа по курсу ЦБ РФ и распределяется между позициями пропорционально весу
          брутто × количество (Решение Коллегии ЕЭК № 83); доля включается в таможенную стоимость
          каждой позиции.
        </p>
        <p style={influence}>На что влияет:</p>
        <ul style={list}>
          <li>
            Увеличивает <b>таможенную стоимость</b>, а через неё — базу пошлины, акциза и НДС.
          </li>
          <li>
            Указывайте расходы <b>только до границы ЕАЭС</b> — перевозка по территории РФ в
            таможенную стоимость не входит.
          </li>
          <li>
            Если условия поставки уже включают доставку (CIF, CIP, DAP и т. п.), повторно
            добавлять фрахт не нужно — иначе стоимость будет задвоена (система предупредит).
          </li>
        </ul>
        <p style={{ ...para, marginBottom: 0 }}>
          Чтобы сбросить ранее заданный фрахт, введите <b>0</b> или очистите поле и пересчитайте.
        </p>
      </Section>

      <Section id="incoterms" title="Инкотермс (условия поставки)">
        <p style={para}>
          Базис поставки по Incoterms 2020 (EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP, DAP, DPU,
          DDP). Определяет, до какого момента расходы и риски несёт продавец, и попадает в графу
          20 ДТ. Система не меняет суммы автоматически, но по значению проверяет корректность
          структуры таможенной стоимости и выдаёт предупреждения:
        </p>
        <ul style={list}>
          <li>
            <b>EXW, FCA, FAS, FOB</b> — доставка не входит в цену. Если фрахт не задан,
            таможенная стоимость может быть <b>занижена</b> — добавьте фрахт.
          </li>
          <li>
            <b>CFR, CIF, CPT, CIP, DAP, DPU, DDP</b> — доставка уже в цене. Отдельно заданный
            фрахт грозит <b>двойным счётом</b>.
          </li>
          <li>
            <b>CIF, CIP</b> — в цену входит ещё и страхование, оно учитывается в таможенной
            стоимости.
          </li>
        </ul>
      </Section>

      <div style={{ marginTop: 8 }}>
        <Link href="/documents" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 14 }}>
          &larr; К документам
        </Link>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ ...cardSurface, padding: 20, marginBottom: 16, scrollMarginTop: 20 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
      {children}
    </section>
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
