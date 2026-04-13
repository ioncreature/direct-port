import { NestFactory } from '@nestjs/core';
import { createNestLogger } from '@direct-port/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createNestLogger({ name: 'tg-bot' });

  const app = await NestFactory.create(AppModule, { logger });

  const port = process.env.BOT_PORT || 3002;
  await app.listen(port);
  logger.log(`TG Bot service running on http://localhost:${port}`);
}

bootstrap();
