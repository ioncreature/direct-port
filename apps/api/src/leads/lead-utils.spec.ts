import { clampScore, cleanStringList, htmlToText, normalizeDomain, toFetchUrl } from './lead-utils';

describe('normalizeDomain', () => {
  it.each([
    ['https://www.Example.com/path?q=1', 'example.com'],
    ['http://test.ru', 'test.ru'],
    ['ved-service.ru', 'ved-service.ru'],
    ['WWW.UPPER.RU/', 'upper.ru'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('пустое / null / пробелы → null', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
  });

  it('две формы одного сайта дают один домен (для дедупа)', () => {
    expect(normalizeDomain('http://a.ru')).toBe(normalizeDomain('https://www.a.ru/contacts'));
  });
});

describe('toFetchUrl', () => {
  it('строит https-URL из домена', () => {
    expect(toFetchUrl('www.a.ru')).toBe('https://a.ru');
  });
  it('нет сайта → null', () => {
    expect(toFetchUrl(null)).toBeNull();
  });
});

describe('htmlToText', () => {
  it('вырезает script/style и теги, схлопывает пробелы', () => {
    const html =
      '<html><head><style>.a{color:red}</style><script>alert(1)</script></head>' +
      '<body><h1>Привет</h1> <p>мир&nbsp;импорта</p></body></html>';
    const text = htmlToText(html);
    expect(text).toBe('Привет мир импорта');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });
});

describe('clampScore', () => {
  it('зажимает в [0,1]', () => {
    expect(clampScore(1.5)).toBe(1);
    expect(clampScore(-0.2)).toBe(0);
    expect(clampScore(0.73)).toBe(0.73);
  });
  it('не-число → null', () => {
    expect(clampScore('x')).toBeNull();
    expect(clampScore(null)).toBeNull();
    expect(clampScore(undefined)).toBeNull();
  });
});

describe('cleanStringList', () => {
  it('trim, дедуп, отбрасывает пустые', () => {
    expect(cleanStringList([' a ', 'a', 'b', '', '  '])).toEqual(['a', 'b']);
  });
  it('не массив → null; пустой результат → null', () => {
    expect(cleanStringList('x')).toBeNull();
    expect(cleanStringList(null)).toBeNull();
    expect(cleanStringList(['', '   '])).toBeNull();
  });
});
