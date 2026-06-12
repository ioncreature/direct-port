import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createNestLogger, createHttpLoggerMiddleware } from '@direct-port/common';
import { AppModule } from './app.module';

const WEAK_INTERNAL_KEYS = new Set(['change-me-to-a-random-key', 'change-me', 'secret']);

async function bootstrap() {
  const logger = createNestLogger({ name: 'api' });

  // Fail-fast: X-Internal-Key защищает service-to-service маршруты (бот → API).
  // Пустой/дефолтный/короткий ключ в проде = открытый доступ к *-internal, поэтому
  // падаем на старте. Вне прода только предупреждаем, чтобы не мешать локальной разработке.
  const internalKey = process.env.API_INTERNAL_KEY;
  if (!internalKey || internalKey.length < 16 || WEAK_INTERNAL_KEYS.has(internalKey)) {
    const msg = 'API_INTERNAL_KEY is missing, too short, or set to a default placeholder';
    if (process.env.NODE_ENV === 'production') throw new Error(msg);
    logger.warn(`${msg} — allowed only outside production`);
  }

  const app = await NestFactory.create(AppModule, { logger });
  // Без shutdown-хуков SIGTERM (каждый rollout) убивает процесс мгновенно: BullMQ-воркеры
  // parsing/processing не дожидаются активного job (обработка идёт минутами), и тот
  // зависает до stalled-таймаута. С хуками @nestjs/bullmq делает graceful worker.close().
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' });
  app.use(createHttpLoggerMiddleware(logger.getPino()));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
