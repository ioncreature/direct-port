import { fmtTokens, modelLabel } from '@/lib/format';
import type { TokenUsageMap } from '@/lib/types';

/** Разбивка токенов по семействам моделей («модель: in / out»).
 *  Общий вид для карточек AI-расходов и диагностики документа. */
export function ModelBreakdown({ models }: { models: TokenUsageMap }) {
  return (
    <>
      {Object.entries(models).map(([model, usage]) => (
        <div key={model} style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
          {modelLabel(model)}: {fmtTokens(usage.inputTokens)} in / {fmtTokens(usage.outputTokens)} out
        </div>
      ))}
    </>
  );
}
