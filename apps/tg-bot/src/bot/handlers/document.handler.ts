import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'grammy';
import { ExcelService } from '../../excel/excel.service';
import { ClassifierService } from '../../classifier/classifier.service';
import { CalculatorService, CalculationSummary } from '../../calculator/calculator.service';

@Injectable()
export class DocumentHandler {
  private logger = new Logger(DocumentHandler.name);

  constructor(
    private excelService: ExcelService,
    private classifierService: ClassifierService,
    private calculatorService: CalculatorService,
  ) {}

  async handle(ctx: Context) {
    const doc = ctx.message?.document;
    if (!doc) return;

    const fileName = doc.file_name || 'file';
    if (!fileName.endsWith('.xlsx')) {
      await ctx.reply('Пожалуйста, отправьте файл в формате .xlsx');
      return;
    }

    await ctx.reply('Обрабатываю файл...');

    try {
      const file = await ctx.getFile();
      const response = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const products = await this.excelService.parse(buffer);
      if (products.length === 0) {
        await ctx.reply('Файл не содержит данных о товарах. Проверьте формат (/help).');
        return;
      }

      await ctx.reply(`Найдено ${products.length} товаров. Классифицирую...`);

      const classified = await this.classifierService.classify(products);
      const result = this.calculatorService.calculate(classified);

      await ctx.reply(this.formatResult(result, fileName), { parse_mode: 'HTML' });

      this.logger.log(`Processed ${products.length} items from ${fileName}`);
    } catch (err) {
      this.logger.error(`Failed to process ${fileName}:`, err);
      await ctx.reply('Ошибка при обработке файла. Проверьте формат и попробуйте снова.');
    }
  }

  private formatResult(summary: CalculationSummary, fileName: string): string {
    const lines: string[] = [
      `<b>Результат расчёта: ${fileName}</b>`,
      `Товаров: ${summary.items.length}`,
      '',
    ];

    for (const item of summary.items.slice(0, 10)) {
      const status = item.matched ? '✅' : '❓';
      lines.push(
        `${status} ${item.description.substring(0, 40)}`,
        `   ТН ВЭД: ${item.tnVedCode || 'н/д'} | Пошлина: $${item.dutyAmount.toFixed(2)} | НДС: $${item.vatAmount.toFixed(2)}`,
      );
    }

    if (summary.items.length > 10) {
      lines.push(`\n... и ещё ${summary.items.length - 10} товаров`);
    }

    lines.push(
      '',
      '<b>Итого:</b>',
      `Пошлины: $${summary.totalDuty.toFixed(2)}`,
      `НДС: $${summary.totalVat.toFixed(2)}`,
      `Логистика: $${summary.totalLogistics.toFixed(2)}`,
      `<b>Общая сумма: $${summary.grandTotal.toFixed(2)}</b>`,
    );

    return lines.join('\n');
  }
}
