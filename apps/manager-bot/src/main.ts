import { NestFactory } from '@nestjs/core';
import { createNestLogger } from '@direct-port/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createNestLogger({ name: 'manager-bot' });

  const app = await NestFactory.create(AppModule, { logger });
  // Без shutdown-хуков SIGTERM (каждый деплой) убивает процесс мгновенно: BullMQ-воркер
  // manager-notifications не дожидается активного job, и тот зависает до stalled-таймаута.
  app.enableShutdownHooks();

  const port = process.env.BOT_PORT || 3004;
  await app.listen(port);
  logger.log(`Manager bot service running on http://localhost:${port}`);
}

bootstrap();
