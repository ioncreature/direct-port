import { NestFactory } from '@nestjs/core';
import { createNestLogger } from '@direct-port/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createNestLogger({ name: 'client-bot' });

  const app = await NestFactory.create(AppModule, { logger });

  const port = process.env.BOT_PORT || 3003;
  await app.listen(port);
  logger.log(`Client bot service running on http://localhost:${port}`);
}

bootstrap();
