import { Injectable, Logger } from '@nestjs/common';
import { Context, InlineKeyboard } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { ColumnMappingInput, ExcelService } from '../../excel/excel.service';
import { formatUser } from '../format-user';
import { ColumnMapping, ConversationStateService } from '../state/conversation-state.service';

const COLUMN_STEPS = [
  { field: 'description', next: 'awaiting_column_price', label: 'стоимостью' },
  { field: 'price', next: 'awaiting_column_weight', label: 'весом' },
  { field: 'weight', next: 'awaiting_column_quantity', label: 'количеством' },
  { field: 'quantity', next: null, label: null },
] as const;

@Injectable()
export class CallbackQueryHandler {
  private logger = new Logger(CallbackQueryHandler.name);

  constructor(
    private excelService: ExcelService,
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  async handle(ctx: Context) {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('col_')) return;

    const user = formatUser(ctx);

    await ctx.answerCallbackQuery();

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const state = await this.stateService.getState(chatId);
    if (!state) {
      this.logger.warn(`Session expired for chat=${chatId} (${user}), data="${data}"`);
      await ctx.editMessageText('Сессия истекла. Отправьте файл заново.');
      return;
    }

    const parts = data.split('_');
    const field = parts[1] as keyof ColumnMapping;
    const index = parseInt(parts[2], 10);

    this.logger.log(
      `Column selected: ${field}="${state.headers[index] ?? '?'}" by ${user}`,
    );

    state.columnMapping[field] = index;

    const currentStep = COLUMN_STEPS.find((s) => s.field === field);
    if (!currentStep) return;

    if (currentStep.next) {
      // Show next column selection
      state.step = currentStep.next as typeof state.step;
      await this.stateService.setState(chatId, state);

      const selectedIndices = new Set(
        Object.values(state.columnMapping).filter((v): v is number => v !== undefined),
      );

      const nextField = COLUMN_STEPS[COLUMN_STEPS.findIndex((s) => s.field === field) + 1];

      const kb = new InlineKeyboard();
      state.headers.forEach((header, i) => {
        if (!selectedIndices.has(i)) {
          kb.text(header, `col_${nextField.field}_${i}`).row();
        }
      });

      await ctx.editMessageText(
        `✅ ${state.headers[index]}\n\nВыберите столбец с ${currentStep.label}:`,
        { reply_markup: kb },
      );
    } else {
      // All 4 columns mapped — process
      await ctx.editMessageText(
        `✅ ${state.headers[index]}\n\nВсе столбцы выбраны. Обрабатываю...`,
      );

      try {
        const buffer = Buffer.from(state.fileBuffer, 'base64');
        const mapping = state.columnMapping as ColumnMappingInput;
        const products = await this.excelService.parseWithMapping(buffer, state.fileType, mapping);

        if (products.length === 0) {
          this.logger.warn(`Empty file "${state.fileName}" from ${user}`);
          await ctx.reply('Файл не содержит данных. Проверьте формат.');
          await this.stateService.clearState(chatId);
          return;
        }

        const doc = await this.apiClient.createDocument({
          telegramUserId: state.telegramUserId,
          originalFileName: state.fileName,
          columnMapping: { ...mapping },
          parsedData: products.map((p) => ({ ...p })),
        });
        this.logger.log(
          `Document created "${state.fileName}" (${products.length} rows) from ${user}: id=${doc.id} status=${doc.status}`,
        );

        await ctx.reply(
          `📄 Файл «${state.fileName}» принят в обработку (${products.length} строк).\n` +
            'Вы получите уведомление по завершении.',
        );
      } catch (err) {
        this.logger.error(
          `Error processing document "${state.fileName}" from ${user}: ${(err as Error).message}`,
        );
        await ctx.reply('Ошибка при отправке документа. Попробуйте ещё раз.');
      }

      await this.stateService.clearState(chatId);
    }
  }
}
