import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);

  const port = Number.parseInt(process.env.API_PORT ?? '3001', 10);
  await app.listen(port);
}

void bootstrap();
