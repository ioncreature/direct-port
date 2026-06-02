import { escapeHtml, formatClientName } from './format';

describe('escapeHtml', () => {
  it('экранирует &, <, >', () => {
    expect(escapeHtml('a & b <c>')).toBe('a &amp; b &lt;c&gt;');
  });
});

describe('formatClientName', () => {
  it('полное имя', () => {
    expect(formatClientName({ firstName: 'Иван', lastName: 'Петров', telegramId: '1' })).toBe(
      'Иван Петров',
    );
  });

  it('только firstName', () => {
    expect(formatClientName({ firstName: 'Иван', lastName: null, telegramId: '1' })).toBe('Иван');
  });

  it('fallback на username', () => {
    expect(
      formatClientName({ firstName: null, lastName: null, username: 'ivan', telegramId: '1' }),
    ).toBe('@ivan');
  });

  it('fallback на telegramId', () => {
    expect(formatClientName({ telegramId: '12345' })).toBe('id12345');
  });
});
