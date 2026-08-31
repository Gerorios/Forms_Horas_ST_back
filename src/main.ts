import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/multer-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Traduce los errores de subida (archivo muy grande, etc.) a mensajes que el
  // usuario entiende, en vez del 500 pelado que devuelve multer por defecto.
  app.useGlobalFilters(new MulterExceptionFilter());
  app.enableCors({ exposedHeaders: ['Content-Disposition'] });
  // Sin esto, cada reinicio (pm2 / nest --watch) abandona su pool de MySQL sin
  // cerrar y el servidor compartido retiene las conexiones muertas por horas
  // (incidente 2026-08-13).
  app.enableShutdownHooks();
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend corriendo en http://localhost:${port}`);
}
bootstrap();
