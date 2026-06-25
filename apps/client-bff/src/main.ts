import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createNestLogger, createHttpLoggerMiddleware } from '@direct-port/common';
import { AxiosExceptionFilter } from './api-client/axios-exception.filter';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = createNestLogger({ name: 'client-bff' });

  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AxiosExceptionFilter());
  app.enableCors({ origin: process.env.CLIENT_WEB_ORIGIN || 'http://localhost:3006' });
  app.use(createHttpLoggerMiddleware(logger.getPino()));

  const port = process.env.PORT || 3005;
  await app.listen(port);
  logger.log(`Client BFF running on http://localhost:${port}`);
}

bootstrap();
