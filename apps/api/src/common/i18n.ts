/**
 * Имя языка в форме существительного предложного падежа ("на китайском", "на английском"),
 * пригодное для подстановки в промпты Claude. Используется при запросе локализованных
 * полей (comment_localized, reasoning_localized) для не-русских пользователей бота.
 */
export function localizedLanguageName(language: string): string {
  switch (language) {
    case 'zh':
      return 'китайском';
    case 'en':
      return 'английском';
    default:
      return language;
  }
}
