import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
      // MySQL 8 con caching_sha2_password exige recuperar la clave RSA en la
      // primera conexión; la config por URL cruda lo permitía implícito y al
      // pasar a config por objeto se perdió (el pool quedaba en timeout).
      allowPublicKeyRetrieval: true,
      // El servidor MySQL es compartido y su max_connections es finito: en
      // reposo alcanza con 2 conexiones vivas; las ociosas se sueltan a los
      // 10 minutos.
      minimumIdle: 2,
      idleTimeout: 600,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Junto con enableShutdownHooks (main.ts): cierra el pool al morir el
  // proceso para no dejar conexiones fantasma en el servidor compartido.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
