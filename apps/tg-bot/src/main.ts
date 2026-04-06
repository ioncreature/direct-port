import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.BOT_PORT || 3002;
  await app.listen(port);
  console.log(`TG Bot service running on http://localhost:${port}`);
}

bootstrap();
