import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { EmpleadosModule } from './empleados/empleados.module';
import { RegistrosHorasModule } from './registros-horas/registros-horas.module';
import { NovedadesModule } from './novedades/novedades.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    EmpleadosModule,
    RegistrosHorasModule,
    NovedadesModule,
    AdminModule,
  ],
})
export class AppModule {}
