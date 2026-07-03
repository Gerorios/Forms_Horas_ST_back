# NestJS Backend Setup — Registro de Horas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el proyecto NestJS completo con módulos Auth, Empleados, RegistroHoras, Novedades y Admin conectados a la base MySQL ya migrada.

**Architecture:** API REST con NestJS 10, autenticación JWT stateless, guards de roles aplicados por endpoint. PrismaService global inyectado en todos los módulos. Cada módulo tiene su propio controller + service + DTOs.

**Tech Stack:** Node.js 22, NestJS 10, Prisma 7 (ya configurado), MySQL, JWT (passport-jwt), bcrypt, class-validator.

## Global Constraints

- Prisma ya está en `package.json` y `prisma/schema.prisma` existe — no reinicializar.
- Tabla existente de solo lectura: `snuempleados` (empleados activos: `activo='S'` y `borrado<>'S'`).
- Tablas propias del proyecto tienen prefijo `sth_`.
- Roles válidos (guardados en `sth_roles.nombre`): `Operario`, `JefeCuadrilla`, `JefeContrato`, `Supervisor`, `HyS`, `Admin`.
- JWT_SECRET debe vivir en `.env` — nunca hardcodeado.
- `ValidationPipe({ whitelist: true })` global — rechaza campos no declarados en DTOs.
- Puerto por defecto: `3001` (configurable via `PORT` en `.env`).

---

## Mapa de archivos

```
src/
  main.ts
  app.module.ts
  prisma/
    prisma.service.ts
    prisma.module.ts
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    jwt.strategy.ts
    guards/
      jwt-auth.guard.ts
      roles.guard.ts
    decorators/
      roles.decorator.ts
    dto/
      login.dto.ts
  empleados/
    empleados.module.ts
    empleados.controller.ts
    empleados.service.ts
  registros-horas/
    registros-horas.module.ts
    registros-horas.controller.ts
    registros-horas.service.ts
    dto/
      create-registro-horas.dto.ts
      resolver-registro.dto.ts
  novedades/
    novedades.module.ts
    novedades.controller.ts
    novedades.service.ts
    dto/
      create-novedad.dto.ts
      resolver-novedad.dto.ts
  admin/
    admin.module.ts
    admin.controller.ts
    admin.service.ts
    dto/
      contrato.dto.ts
      tarea.dto.ts
      movil.dto.ts
      provincia.dto.ts
      tipo-novedad.dto.ts
      usuario.dto.ts
```

---

## Task 1: Instalar NestJS y configurar proyecto base

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `.env` (agregar variables nuevas)
- Create: `src/main.ts`
- Create: `src/app.module.ts`

- [ ] **Step 1: Instalar dependencias de NestJS**

```bash
npm install @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt class-validator class-transformer reflect-metadata rxjs
```

```bash
npm install --save-dev @nestjs/cli @nestjs/schematics @nestjs/testing @types/passport-jwt @types/bcrypt @types/node typescript ts-node ts-jest jest @types/jest
```

- [ ] **Step 2: Actualizar `package.json` con scripts y metadata**

Reemplazar el contenido completo de `package.json`:

```json
{
  "name": "formulario-horas-backend",
  "version": "1.0.0",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "@types/passport-jwt": "^4.0.0",
    "dotenv": "^17.4.2",
    "jest": "^29.0.0",
    "prisma": "^7.8.0",
    "ts-jest": "^29.0.0",
    "ts-node": "^10.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^7.8.0",
    "bcrypt": "^5.1.0",
    "class-transformer": "^0.5.0",
    "class-validator": "^0.14.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  }
}
```

- [ ] **Step 3: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false
  }
}
```

- [ ] **Step 4: Crear `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 5: Agregar variables al `.env`**

Agregar al final del `.env` existente:

```
JWT_SECRET=cambiar_esto_por_un_secreto_largo_y_aleatorio
PORT=3001
```

- [ ] **Step 6: Crear `src/main.ts`**

```typescript
import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend corriendo en http://localhost:${port}`);
}
bootstrap();
```

- [ ] **Step 7: Crear `src/app.module.ts`**

```typescript
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
```

- [ ] **Step 8: Verificar que compila**

```bash
npx nest build
```

Esperado: carpeta `dist/` creada sin errores. Si hay errores de módulos faltantes (los otros módulos aún no existen), continuar — se resuelven en tasks siguientes.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json src/main.ts src/app.module.ts .env
git commit -m "feat: inicializar proyecto NestJS con configuración base"
```

---

## Task 2: PrismaService global

**Files:**
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`

- [ ] **Step 1: Crear `src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 2: Crear `src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Verificar conexión arrancando el servidor**

```bash
npm run start:dev
```

Esperado en consola: `Backend corriendo en http://localhost:3001` sin errores de conexión a MySQL.

- [ ] **Step 4: Commit**

```bash
git add src/prisma/
git commit -m "feat: agregar PrismaService global"
```

---

## Task 3: Módulo Auth (Login + JWT + Guards)

**Files:**
- Create: `src/auth/dto/login.dto.ts`
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/jwt.strategy.ts`
- Create: `src/auth/guards/jwt-auth.guard.ts`
- Create: `src/auth/guards/roles.guard.ts`
- Create: `src/auth/decorators/roles.decorator.ts`
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.module.ts`

**Interfaces:**
- Produce: `JwtAuthGuard` y `RolesGuard` para usar en todos los controllers siguientes.
- Produce: `@Roles(...roles)` decorator para proteger endpoints.
- Produce: `req.user` con shape `{ cuil: string, email: string, rol: string }`.

- [ ] **Step 1: Crear `src/auth/dto/login.dto.ts`**

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
```

- [ ] **Step 2: Crear `src/auth/decorators/roles.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 3: Crear `src/auth/guards/jwt-auth.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 4: Crear `src/auth/guards/roles.guard.ts`**

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.rol);
  }
}
```

- [ ] **Step 5: Crear `src/auth/jwt.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { cuil: string; email: string; rol: string }) {
    return { cuil: payload.cuil, email: payload.email, rol: payload.rol };
  }
}
```

- [ ] **Step 6: Crear `src/auth/auth.service.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const usuario = await this.prisma.sth_usuarios.findUnique({
      where: { email: dto.email },
      include: { rol: true },
    });

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValida = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = {
      cuil: usuario.cuil,
      email: usuario.email,
      rol: usuario.rol.nombre,
    };

    return { access_token: this.jwt.sign(payload) };
  }

  async perfil(cuil: string) {
    return this.prisma.sth_usuarios.findUnique({
      where: { cuil },
      select: {
        cuil: true,
        email: true,
        activo: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true } },
        contratosHabilitados: {
          select: { contrato: { select: { id: true, codigo: true, nombre: true } } },
        },
      },
    });
  }
}
```

- [ ] **Step 7: Crear `src/auth/auth.controller.ts`**

```typescript
import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('perfil')
  perfil(@Request() req) {
    return this.authService.perfil(req.user.cuil);
  }
}
```

- [ ] **Step 8: Crear `src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 9: Verificar endpoint de login**

Arrancar el servidor y probar:

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"123456"}'
```

Esperado con credenciales inexistentes: `{"statusCode":401,"message":"Credenciales inválidas"}`.

- [ ] **Step 10: Commit**

```bash
git add src/auth/
git commit -m "feat: módulo Auth con JWT y guards de roles"
```

---

## Task 4: Módulo Empleados (solo lectura)

**Files:**
- Create: `src/empleados/empleados.service.ts`
- Create: `src/empleados/empleados.controller.ts`
- Create: `src/empleados/empleados.module.ts`

**Interfaces:**
- Consume: `JwtAuthGuard`, `RolesGuard`, `@Roles()` de `src/auth/`.
- Produce: `GET /empleados?q=texto` — lista empleados activos de `snuempleados`.

- [ ] **Step 1: Crear `src/empleados/empleados.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmpleadosService {
  constructor(private prisma: PrismaService) {}

  findActivos(q?: string) {
    return this.prisma.snuempleados.findMany({
      where: {
        activo: 'S',
        borrado: { not: 'S' },
        ...(q
          ? { apellido_nombre: { contains: q } }
          : {}),
      },
      select: {
        cuil: true,
        apellido_nombre: true,
        legajo: true,
        cargo: true,
        seccion: true,
        categoria: true,
      },
      orderBy: { apellido_nombre: 'asc' },
    });
  }

  findOne(cuil: string) {
    return this.prisma.snuempleados.findUnique({ where: { cuil } });
  }
}
```

- [ ] **Step 2: Crear `src/empleados/empleados.controller.ts`**

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EmpleadosService } from './empleados.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('empleados')
export class EmpleadosController {
  constructor(private empleadosService: EmpleadosService) {}

  @Get()
  findAll(@Query('q') q?: string) {
    return this.empleadosService.findActivos(q);
  }

  @Get(':cuil')
  findOne(@Param('cuil') cuil: string) {
    return this.empleadosService.findOne(cuil);
  }
}
```

- [ ] **Step 3: Crear `src/empleados/empleados.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmpleadosService } from './empleados.service';
import { EmpleadosController } from './empleados.controller';

@Module({
  providers: [EmpleadosService],
  controllers: [EmpleadosController],
  exports: [EmpleadosService],
})
export class EmpleadosModule {}
```

- [ ] **Step 4: Commit**

```bash
git add src/empleados/
git commit -m "feat: módulo Empleados (solo lectura de snuempleados)"
```

---

## Task 5: Módulo RegistroHoras

**Files:**
- Create: `src/registros-horas/dto/create-registro-horas.dto.ts`
- Create: `src/registros-horas/dto/resolver-registro.dto.ts`
- Create: `src/registros-horas/registros-horas.service.ts`
- Create: `src/registros-horas/registros-horas.controller.ts`
- Create: `src/registros-horas/registros-horas.module.ts`

**Interfaces:**
- Consume: `JwtAuthGuard`, `RolesGuard`, `@Roles()`.
- Produce: CRUD de `sth_registros_horas` con flujo de aprobación.

- [ ] **Step 1: Crear `src/registros-horas/dto/create-registro-horas.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDecimal,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateRegistroHorasDto {
  @IsDateString()
  fecha: string;

  @IsString()
  operarioCuil: string;

  @IsInt()
  contratoId: number;

  @IsInt()
  tareaId: number;

  @IsNumber()
  horas: number;

  @IsInt()
  provinciaId: number;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsInt({ each: true })
  movilIds?: number[];
}
```

- [ ] **Step 2: Crear `src/registros-horas/dto/resolver-registro.dto.ts`**

```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ResolverRegistroDto {
  @IsEnum(['aprobado', 'desaprobado'])
  estado: 'aprobado' | 'desaprobado';

  @IsOptional()
  @IsString()
  motivoDesaprobacion?: string;
}
```

- [ ] **Step 3: Crear `src/registros-horas/registros-horas.service.ts`**

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRegistroHorasDto } from './dto/create-registro-horas.dto';
import { ResolverRegistroDto } from './dto/resolver-registro.dto';

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  contrato: { select: { id: true, codigo: true, nombre: true } },
  tarea: { select: { id: true, nombre: true } },
  provincia: { select: { id: true, nombre: true } },
  moviles: { include: { movil: { select: { id: true, identificador: true } } } },
};

@Injectable()
export class RegistrosHorasService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateRegistroHorasDto, cargadoPorCuil: string) {
    // Validar que el usuario tiene ese contrato habilitado
    const habilitado = await this.prisma.sth_contratos_habilitados.findUnique({
      where: {
        usuarioCuil_contratoId: {
          usuarioCuil: cargadoPorCuil,
          contratoId: dto.contratoId,
        },
      },
    });
    if (!habilitado) {
      throw new ForbiddenException('No tenés habilitado ese contrato');
    }

    // Calcular alerta de horas (> 16h en el día para ese operario)
    const horasDelDia = await this.prisma.sth_registros_horas.aggregate({
      where: {
        operarioCuil: dto.operarioCuil,
        fecha: new Date(dto.fecha),
        estado: { not: 'desaprobado' },
      },
      _sum: { horas: true },
    });
    const totalHoras =
      Number(horasDelDia._sum.horas ?? 0) + Number(dto.horas);
    const alertaHoras = totalHoras > 16;

    return this.prisma.sth_registros_horas.create({
      data: {
        fecha: new Date(dto.fecha),
        operarioCuil: dto.operarioCuil,
        cargadoPorCuil,
        contratoId: dto.contratoId,
        tareaId: dto.tareaId,
        horas: dto.horas,
        provinciaId: dto.provinciaId,
        gpsLat: dto.gpsLat,
        gpsLng: dto.gpsLng,
        alertaHoras,
        moviles: dto.movilIds?.length
          ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
          : undefined,
      },
      include: INCLUDE_BASICO,
    });
  }

  findAll(filtros: {
    fecha?: string;
    contratoId?: number;
    estado?: string;
    operarioCuil?: string;
  }) {
    return this.prisma.sth_registros_horas.findMany({
      where: {
        ...(filtros.fecha ? { fecha: new Date(filtros.fecha) } : {}),
        ...(filtros.contratoId ? { contratoId: filtros.contratoId } : {}),
        ...(filtros.estado ? { estado: filtros.estado as any } : {}),
        ...(filtros.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
      },
      include: INCLUDE_BASICO,
      orderBy: { fecha: 'desc' },
    });
  }

  async resolver(
    id: number,
    dto: ResolverRegistroDto,
    aprobadoPorCuil: string,
  ) {
    const registro = await this.prisma.sth_registros_horas.findUnique({
      where: { id },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (registro.estado !== 'pendiente') {
      throw new BadRequestException('Solo se pueden resolver registros pendientes');
    }
    if (dto.estado === 'desaprobado' && !dto.motivoDesaprobacion) {
      throw new BadRequestException('Se requiere motivo al desaprobar');
    }

    const updated = await this.prisma.sth_registros_horas.update({
      where: { id },
      data: {
        estado: dto.estado,
        aprobadoPorCuil,
        aprobadoEn: new Date(),
        motivoDesaprobacion: dto.motivoDesaprobacion ?? null,
      },
      include: INCLUDE_BASICO,
    });

    await this.prisma.sth_auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: aprobadoPorCuil,
        accion: dto.estado === 'aprobado' ? 'aprobar' : 'desaprobar',
        campo: 'estado',
        valorAnterior: 'pendiente',
        valorNuevo: dto.estado,
      },
    });

    return updated;
  }

  async reabrir(id: number, usuarioCuil: string) {
    const registro = await this.prisma.sth_registros_horas.findUnique({
      where: { id },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');

    const updated = await this.prisma.sth_registros_horas.update({
      where: { id },
      data: { estado: 'pendiente', aprobadoPorCuil: null, aprobadoEn: null },
      include: INCLUDE_BASICO,
    });

    await this.prisma.sth_auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil,
        accion: 'reabrir',
        campo: 'estado',
        valorAnterior: registro.estado,
        valorNuevo: 'pendiente',
      },
    });

    return updated;
  }
}
```

- [ ] **Step 4: Crear `src/registros-horas/registros-horas.controller.ts`**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { CreateRegistroHorasDto } from './dto/create-registro-horas.dto';
import { ResolverRegistroDto } from './dto/resolver-registro.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('registros-horas')
export class RegistrosHorasController {
  constructor(private service: RegistrosHorasService) {}

  @Post()
  @Roles('Operario', 'JefeCuadrilla', 'JefeContrato', 'Admin')
  create(@Body() dto: CreateRegistroHorasDto, @Request() req) {
    return this.service.create(dto, req.user.cuil);
  }

  @Get()
  findAll(
    @Query('fecha') fecha?: string,
    @Query('contratoId', new ParseIntPipe({ optional: true })) contratoId?: number,
    @Query('estado') estado?: string,
    @Query('operarioCuil') operarioCuil?: string,
  ) {
    return this.service.findAll({ fecha, contratoId, estado, operarioCuil });
  }

  @Patch(':id/resolver')
  @Roles('JefeContrato', 'Admin')
  resolver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverRegistroDto,
    @Request() req,
  ) {
    return this.service.resolver(id, dto, req.user.cuil);
  }

  @Patch(':id/reabrir')
  @Roles('JefeContrato', 'Admin')
  reabrir(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.reabrir(id, req.user.cuil);
  }
}
```

- [ ] **Step 5: Crear `src/registros-horas/registros-horas.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { RegistrosHorasController } from './registros-horas.controller';

@Module({
  providers: [RegistrosHorasService],
  controllers: [RegistrosHorasController],
})
export class RegistrosHorasModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/registros-horas/
git commit -m "feat: módulo RegistroHoras con flujo de aprobación"
```

---

## Task 6: Módulo Novedades

**Files:**
- Create: `src/novedades/dto/create-novedad.dto.ts`
- Create: `src/novedades/dto/resolver-novedad.dto.ts`
- Create: `src/novedades/novedades.service.ts`
- Create: `src/novedades/novedades.controller.ts`
- Create: `src/novedades/novedades.module.ts`

- [ ] **Step 1: Crear `src/novedades/dto/create-novedad.dto.ts`**

```typescript
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateNovedadDto {
  @IsString()
  operarioCuil: string;

  @IsInt()
  tipoNovedadId: number;

  @IsDateString()
  fechaInicio: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsString()
  justificacionTexto?: string;

  @IsOptional()
  @IsString()
  adjuntoUrl?: string;
}
```

- [ ] **Step 2: Crear `src/novedades/dto/resolver-novedad.dto.ts`**

```typescript
import { IsEnum } from 'class-validator';

export class ResolverNovedadDto {
  @IsEnum(['aprobada', 'desaprobada'])
  estadoHys: 'aprobada' | 'desaprobada';
}
```

- [ ] **Step 3: Crear `src/novedades/novedades.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  tipoNovedad: { select: { id: true, nombre: true, requiereAprobacionHys: true } },
  cargadoPor: { select: { cuil: true, email: true } },
};

@Injectable()
export class NovedadesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNovedadDto, cargadoPorCuil: string) {
    const tipo = await this.prisma.sth_tipos_novedad.findUnique({
      where: { id: dto.tipoNovedadId },
    });
    if (!tipo) throw new NotFoundException('Tipo de novedad no encontrado');

    const estadoHys = tipo.requiereAprobacionHys ? 'pendiente' : 'no_aplica';

    return this.prisma.sth_novedades.create({
      data: {
        operarioCuil: dto.operarioCuil,
        tipoNovedadId: dto.tipoNovedadId,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
        cargadoPorCuil,
        justificacionTexto: dto.justificacionTexto,
        adjuntoUrl: dto.adjuntoUrl,
        estadoHys: estadoHys as any,
      },
      include: INCLUDE_BASICO,
    });
  }

  findAll(filtros: { operarioCuil?: string; estadoHys?: string }) {
    return this.prisma.sth_novedades.findMany({
      where: {
        ...(filtros.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
        ...(filtros.estadoHys ? { estadoHys: filtros.estadoHys as any } : {}),
      },
      include: INCLUDE_BASICO,
      orderBy: { fechaInicio: 'desc' },
    });
  }

  async resolverHys(id: number, dto: ResolverNovedadDto, aprobadoPorCuil: string) {
    const novedad = await this.prisma.sth_novedades.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');

    return this.prisma.sth_novedades.update({
      where: { id },
      data: {
        estadoHys: dto.estadoHys,
        aprobadoHysPorCuil: aprobadoPorCuil,
        aprobadoHysEn: new Date(),
      },
      include: INCLUDE_BASICO,
    });
  }
}
```

- [ ] **Step 4: Crear `src/novedades/novedades.controller.ts`**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('novedades')
export class NovedadesController {
  constructor(private service: NovedadesService) {}

  @Post()
  @Roles('Supervisor', 'JefeContrato', 'Admin')
  create(@Body() dto: CreateNovedadDto, @Request() req) {
    return this.service.create(dto, req.user.cuil);
  }

  @Get()
  findAll(
    @Query('operarioCuil') operarioCuil?: string,
    @Query('estadoHys') estadoHys?: string,
  ) {
    return this.service.findAll({ operarioCuil, estadoHys });
  }

  @Patch(':id/resolver-hys')
  @Roles('HyS', 'Admin')
  resolverHys(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverNovedadDto,
    @Request() req,
  ) {
    return this.service.resolverHys(id, dto, req.user.cuil);
  }
}
```

- [ ] **Step 5: Crear `src/novedades/novedades.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { NovedadesController } from './novedades.controller';

@Module({
  providers: [NovedadesService],
  controllers: [NovedadesController],
})
export class NovedadesModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/novedades/
git commit -m "feat: módulo Novedades con flujo de aprobación HyS"
```

---

## Task 7: Módulo Admin (ABM catálogos + usuarios)

**Files:**
- Create: `src/admin/dto/contrato.dto.ts`
- Create: `src/admin/dto/usuario.dto.ts`
- Create: `src/admin/dto/catalogo.dto.ts`
- Create: `src/admin/admin.service.ts`
- Create: `src/admin/admin.controller.ts`
- Create: `src/admin/admin.module.ts`

- [ ] **Step 1: Crear `src/admin/dto/contrato.dto.ts`**

```typescript
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateContratoDto {
  @IsString()
  codigo: string;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  jefeContratoCuil?: string;
}

export class UpdateContratoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  jefeContratoCuil?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

- [ ] **Step 2: Crear `src/admin/dto/catalogo.dto.ts`**

```typescript
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateTareaDto {
  @IsInt()
  contratoId: number;

  @IsString()
  nombre: string;
}

export class CreateMovilDto {
  @IsString()
  identificador: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class CreateProvinciaDto {
  @IsString()
  nombre: string;
}

export class CreateTipoNovedadDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionHys?: boolean;

  @IsOptional()
  @IsBoolean()
  generaPlus?: boolean;
}

export class ToggleActivoDto {
  @IsBoolean()
  activo: boolean;
}
```

- [ ] **Step 3: Crear `src/admin/dto/usuario.dto.ts`**

```typescript
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUsuarioDto {
  @IsString()
  cuil: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsInt()
  rolId: number;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];
}

export class UpdateUsuarioDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsInt()
  rolId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];
}
```

- [ ] **Step 4: Crear `src/admin/admin.service.ts`**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, CreateMovilDto, CreateProvinciaDto, CreateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // --- ROLES ---
  getRoles() {
    return this.prisma.sth_roles.findMany({ orderBy: { nombre: 'asc' } });
  }

  // --- CONTRATOS ---
  getContratos() {
    return this.prisma.sth_contratos.findMany({
      include: { jefeContrato: { select: { cuil: true, email: true } } },
      orderBy: { codigo: 'asc' },
    });
  }

  createContrato(dto: CreateContratoDto) {
    return this.prisma.sth_contratos.create({ data: dto });
  }

  updateContrato(id: number, dto: UpdateContratoDto) {
    return this.prisma.sth_contratos.update({ where: { id }, data: dto });
  }

  // --- TAREAS ---
  getTareas(contratoId?: number) {
    return this.prisma.sth_tareas_catalogo.findMany({
      where: { ...(contratoId ? { contratoId } : {}) },
      include: { contrato: { select: { codigo: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  createTarea(dto: CreateTareaDto) {
    return this.prisma.sth_tareas_catalogo.create({ data: dto });
  }

  toggleTarea(id: number, dto: ToggleActivoDto) {
    return this.prisma.sth_tareas_catalogo.update({ where: { id }, data: { activo: dto.activo } });
  }

  // --- MÓVILES ---
  getMoviles() {
    return this.prisma.sth_moviles.findMany({ orderBy: { identificador: 'asc' } });
  }

  createMovil(dto: CreateMovilDto) {
    return this.prisma.sth_moviles.create({ data: dto });
  }

  toggleMovil(id: number, dto: ToggleActivoDto) {
    return this.prisma.sth_moviles.update({ where: { id }, data: { activo: dto.activo } });
  }

  // --- PROVINCIAS ---
  getProvincias() {
    return this.prisma.sth_provincias.findMany({ orderBy: { nombre: 'asc' } });
  }

  createProvincia(dto: CreateProvinciaDto) {
    return this.prisma.sth_provincias.create({ data: dto });
  }

  // --- TIPOS NOVEDAD ---
  getTiposNovedad() {
    return this.prisma.sth_tipos_novedad.findMany({ orderBy: { nombre: 'asc' } });
  }

  createTipoNovedad(dto: CreateTipoNovedadDto) {
    return this.prisma.sth_tipos_novedad.create({ data: dto });
  }

  toggleTipoNovedad(id: number, dto: ToggleActivoDto) {
    return this.prisma.sth_tipos_novedad.update({ where: { id }, data: { activo: dto.activo } });
  }

  // --- USUARIOS ---
  getUsuarios() {
    return this.prisma.sth_usuarios.findMany({
      select: {
        cuil: true, email: true, activo: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true } },
        contratosHabilitados: { include: { contrato: { select: { codigo: true } } } },
      },
      orderBy: { cuil: 'asc' },
    });
  }

  async createUsuario(dto: CreateUsuarioDto) {
    const existe = await this.prisma.sth_usuarios.findUnique({ where: { cuil: dto.cuil } });
    if (existe) throw new ConflictException('Ya existe un usuario con ese CUIL');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.sth_usuarios.create({
      data: {
        cuil: dto.cuil,
        email: dto.email,
        passwordHash,
        rolId: dto.rolId,
        contratosHabilitados: dto.contratosIds?.length
          ? { create: dto.contratosIds.map((contratoId) => ({ contratoId })) }
          : undefined,
      },
    });
  }

  async updateUsuario(cuil: string, dto: UpdateUsuarioDto) {
    const { password, contratosIds, ...rest } = dto;
    const data: any = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    if (contratosIds !== undefined) {
      await this.prisma.sth_contratos_habilitados.deleteMany({ where: { usuarioCuil: cuil } });
      if (contratosIds.length) {
        await this.prisma.sth_contratos_habilitados.createMany({
          data: contratosIds.map((contratoId) => ({ usuarioCuil: cuil, contratoId })),
        });
      }
    }

    return this.prisma.sth_usuarios.update({ where: { cuil }, data });
  }
}
```

- [ ] **Step 5: Crear `src/admin/admin.controller.ts`**

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, CreateMovilDto, CreateProvinciaDto, CreateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
@Controller('admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('roles')
  getRoles() { return this.service.getRoles(); }

  @Get('contratos')
  getContratos() { return this.service.getContratos(); }

  @Post('contratos')
  createContrato(@Body() dto: CreateContratoDto) { return this.service.createContrato(dto); }

  @Patch('contratos/:id')
  updateContrato(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContratoDto) {
    return this.service.updateContrato(id, dto);
  }

  @Get('tareas')
  getTareas(@Query('contratoId', new ParseIntPipe({ optional: true })) contratoId?: number) {
    return this.service.getTareas(contratoId);
  }

  @Post('tareas')
  createTarea(@Body() dto: CreateTareaDto) { return this.service.createTarea(dto); }

  @Patch('tareas/:id/activo')
  toggleTarea(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleTarea(id, dto);
  }

  @Get('moviles')
  getMoviles() { return this.service.getMoviles(); }

  @Post('moviles')
  createMovil(@Body() dto: CreateMovilDto) { return this.service.createMovil(dto); }

  @Patch('moviles/:id/activo')
  toggleMovil(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleMovil(id, dto);
  }

  @Get('provincias')
  getProvincias() { return this.service.getProvincias(); }

  @Post('provincias')
  createProvincia(@Body() dto: CreateProvinciaDto) { return this.service.createProvincia(dto); }

  @Get('tipos-novedad')
  getTiposNovedad() { return this.service.getTiposNovedad(); }

  @Post('tipos-novedad')
  createTipoNovedad(@Body() dto: CreateTipoNovedadDto) { return this.service.createTipoNovedad(dto); }

  @Patch('tipos-novedad/:id/activo')
  toggleTipoNovedad(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleTipoNovedad(id, dto);
  }

  @Get('usuarios')
  getUsuarios() { return this.service.getUsuarios(); }

  @Post('usuarios')
  createUsuario(@Body() dto: CreateUsuarioDto) { return this.service.createUsuario(dto); }

  @Patch('usuarios/:cuil')
  updateUsuario(@Param('cuil') cuil: string, @Body() dto: UpdateUsuarioDto) {
    return this.service.updateUsuario(cuil, dto);
  }
}
```

- [ ] **Step 6: Crear `src/admin/admin.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
```

- [ ] **Step 7: Build final y verificar que todo compila**

```bash
npm run build
```

Esperado: carpeta `dist/` generada sin errores TypeScript.

- [ ] **Step 8: Arrancar y verificar endpoints**

```bash
npm run start:dev
```

Verificar que responde:
```bash
curl http://localhost:3001/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"x","password":"x"}'
```
Esperado: `{"statusCode":400,...}` (validación de email inválido) o `{"statusCode":401,...}`.

- [ ] **Step 9: Commit final**

```bash
git add src/admin/ src/app.module.ts
git commit -m "feat: módulo Admin con ABM de catálogos y usuarios"
```
