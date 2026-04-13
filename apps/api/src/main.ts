import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createNestLogger, createHttpLoggerMiddleware } from '@direct-port/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createNestLogger({ name: 'api' });

  const app = await NestFactory.create(AppModule, { logger });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' });
  app.use(createHttpLoggerMiddleware(logger.getPino()));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
}

bootstrap();
