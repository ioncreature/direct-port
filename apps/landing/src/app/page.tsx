const TELEGRAM_BOT_URL = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || 'https://t.me/DirectPortBot';

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={headerStyle}>
        <div style={containerStyle}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>DirectPort</span>
        </div>
      </header>

      <section style={heroStyle}>
        <div style={centeredContainerStyle}>
          <h1 style={{ fontSize: 48, margin: '0 0 24px', fontWeight: 800 }}>
            Импорт товаров в Россию — просто
          </h1>
          <p style={{ fontSize: 20, color: '#555', maxWidth: 640, margin: '0 auto 40px' }}>
            Загрузите прайс-лист — получите готовый расчёт таможенных пошлин, НДС и стоимости
            доставки за пару минут.
          </p>
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" style={ctaStyle}>
            Открыть бота в Telegram
          </a>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={containerStyle}>
          <h2 style={sectionTitleStyle}>Как это работает</h2>
          <div style={gridStyle}>
            <Card
              step="1"
              title="Загрузите файл"
              description="Отправьте боту Excel или CSV с товарами — наименования, цены, вес, количество."
            />
            <Card
              step="2"
              title="AI обрабатывает данные"
              description="Система переводит наименования, определяет коды ТН ВЭД и ставки пошлин автоматически."
            />
            <Card
              step="3"
              title="Получите расчёт"
              description="Готовый Excel с пошлинами, НДС, акцизами и итоговой стоимостью для каждого товара."
            />
          </div>
        </div>
      </section>

      <section style={altSectionStyle}>
        <div style={containerStyle}>
          <h2 style={sectionTitleStyle}>Почему DirectPort</h2>
          <div style={gridStyle}>
            <Card
              title="Любая валюта"
              description="Юани, доллары, евро — цены автоматически конвертируются по актуальному курсу ЦБ РФ."
            />
            <Card
              title="Любой язык"
              description="Наименования на китайском, английском или другом языке переводятся на русский."
            />
            <Card
              title="Точная классификация"
              description="Коды ТН ВЭД подбираются по справочнику ФТС и проверяются AI-верификацией."
            />
          </div>
        </div>
      </section>

      <section style={centeredSectionStyle}>
        <div style={containerStyle}>
          <h2 style={{ fontSize: 32, margin: '0 0 16px', fontWeight: 700 }}>Готовы начать?</h2>
          <p style={{ fontSize: 18, color: '#555', margin: '0 0 32px' }}>
            Отправьте первый файл прямо сейчас — это бесплатно.
          </p>
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" style={ctaStyle}>
            Перейти в Telegram
          </a>
        </div>
      </section>

      <footer style={footerStyle}>
        <div style={containerStyle}>DirectPort &copy; {new Date().getFullYear()}</div>
      </footer>
    </div>
  );
}

function Card({ step, title, description }: { step?: string; title: string; description: string }) {
  return (
    <div style={cardStyle}>
      {step && <div style={stepBadgeStyle}>{step}</div>}
      <h3 style={{ margin: step ? '12px 0 8px' : '0 0 8px', fontSize: 20 }}>{title}</h3>
      <p style={{ margin: 0, color: '#555', lineHeight: 1.6 }}>{description}</p>
    </div>
  );
}

/* ---------- Styles ---------- */

const containerStyle: React.CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
  padding: '0 24px',
};

const centeredContainerStyle: React.CSSProperties = {
  ...containerStyle,
  textAlign: 'center',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 0',
  borderBottom: '1px solid #eee',
};

const heroStyle: React.CSSProperties = {
  padding: '96px 0 80px',
  background: 'linear-gradient(180deg, #f0f5ff 0%, #fff 100%)',
};

const sectionStyle: React.CSSProperties = {
  padding: '80px 0',
};

const altSectionStyle: React.CSSProperties = {
  ...sectionStyle,
  background: '#f7f9fc',
};

const centeredSectionStyle: React.CSSProperties = {
  ...sectionStyle,
  textAlign: 'center',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  textAlign: 'center',
  margin: '0 0 48px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 32,
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 32,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: '1px solid #eee',
};

const stepBadgeStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background: '#1a56db',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 16,
};

const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  background: '#1a56db',
  color: '#fff',
  padding: '16px 40px',
  borderRadius: 8,
  fontSize: 18,
  fontWeight: 600,
  textDecoration: 'none',
};

const footerStyle: React.CSSProperties = {
  marginTop: 'auto',
  padding: '24px 0',
  borderTop: '1px solid #eee',
  color: '#888',
  fontSize: 14,
  textAlign: 'center',
};
