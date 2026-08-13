import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const url = new URL(process.env.DATABASE_URL!.replace(/^mysql:/, 'http:'));
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      connectionLimit: 10,
      // 1000ms (default) aborta handshakes cuando MySQL respira hondo; cada
      // aborto suma a max_connect_errors y puede terminar bloqueando la IP
      // (incidente 2026-08-13).
      connectTimeout: 10_000,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
