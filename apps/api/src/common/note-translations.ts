/**
 * Translations for static (non-AI-generated) ProductNote messages.
 * These are hardcoded strings used in verification and duty-interpreter services.
 * AI-generated comments get localized via the Claude prompt itself.
 */

const translations: Record<string, Record<string, string>> = {
  'verification-disabled': {
    en: 'TN VED code verification via AI was skipped — ANTHROPIC_API_KEY is not configured.',
    zh: 'AI 未验证商品编码 — 未配置 ANTHROPIC_API_KEY。',
  },
  'verification-error': {
    en: 'TN VED code verification via AI failed. The code from the TKS classifier is used as-is.',
    zh: 'AI 验证商品编码失败，使用 TKS 分类器提供的编码。',
  },
  'verification-no-result': {
    en: 'The verifier returned no result for this row — the code from the TKS classifier is used.',
    zh: '验证器未返回此行的结果，使用 TKS 分类器提供的编码。',
  },
  'interpreter-disabled': {
    en: 'The TN VED code has non-trivial rates (specific or combined), but the AI interpreter is disabled (no ANTHROPIC_API_KEY). Simplified TKS rules will be used.',
    zh: '商品编码具有非标准税率（特定或组合税率），但 AI 解释器已禁用（缺少 ANTHROPIC_API_KEY），将使用简化的 TKS 规则。',
  },
  'interpreter-failed': {
    en: 'AI duty rate interpretation was not received (Claude returned an empty response or there was an error). The calculation uses simplified TKS rules.',
    zh: 'AI 关税税率解释未收到（Claude 返回空响应或发生错误），计算使用简化的 TKS 规则。',
  },
};

/**
 * Get localized translation of a static note message.
 * Returns undefined if no translation exists for the given key+language.
 */
export function getStaticNoteTranslation(
  key: string,
  language: string | undefined,
): string | undefined {
  if (!language || language === 'ru') return undefined;
  return translations[key]?.[language];
}
