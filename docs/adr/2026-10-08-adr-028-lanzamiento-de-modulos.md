# ADR-028 — Lanzamiento de módulos: interno (piloto) o para todos, lo decide Admin

**Fecha:** 2026-10-08
**Estado:** Aceptado
**Afecta:** módulo nuevo `src/lanzamientos/` (servicio, guard `@Modulo`, pantalla de
Admin), perfil (`GET /auth/perfil` devuelve `modulos`), tablas `sth_modulos_*` (DDL
manual en `docs/sql/2026-10-08-lanzamiento-de-modulos.sql`). Frontend: menú, inicio,
layout de cada módulo con lanzamiento y Administración → Lanzamientos.

## Contexto

Autogestión de la Seguridad (ADR-027) quedó aprobado por HyS, pero no se lanza a
toda la empresa el día del deploy: primero lo prueban HyS y algunas personas. El
usuario pidió que esto sirva "para la posteridad": van a salir más módulos, y cada
uno se quiere probar internamente con algunos roles o personas antes de abrirlo a
todos, y que lo decida **solo Admin**.

Hasta hoy la visibilidad de un módulo la decide únicamente el rol (`NAV_ITEMS` en el
Frontend y `@Roles` en el Backend), y está escrita en el código.

## Decisión

1. **Cada módulo nuevo se registra con un estado de lanzamiento**:
   - **Interno:** lo ven Admin (siempre) y los **roles** y **personas** que Admin
     habilite.
   - **Para todos:** lo ve todo el que por su rol ya tendría acceso.
   Los módulos **no registrados** (todos los existentes al 2026-10-08) no cambian:
   el mecanismo solo actúa sobre lo que se da de alta en él.
2. **Lo maneja solo Admin**, desde Administración → Lanzamientos, y se guarda en la
   base: pasar a "Para todos" es un cambio de datos, sin deploy ni reinicio.
3. **Dos capas que no se mezclan:** el lanzamiento decide si alguien **ve el
   módulo**; adentro, los roles siguen decidiendo **qué puede hacer** (habilitar el
   rol Supervisor en el piloto de Seguridad no le da el panel de HyS).
4. **El bloqueo es en el Backend**: un guard (`@Modulo('<clave>')` en el
   controlador) responde 403 a quien no está habilitado. El Frontend solo esconde
   el menú, el inicio y las rutas (layout), a partir de `perfil.modulos`.
5. Para un módulo nuevo: fila en `sth_modulos_lanzamiento` (por SQL, con su clave
   y nombre), `@Modulo('<clave>')` en sus controladores y `modulo: '<clave>'` en sus
   ítems de `NAV_ITEMS`.

Seguridad se registra en estado **Interno**, con el rol **HyS** habilitado.

## Alternativas descartadas

- **Lista hardcodeada** (roles o CUIL en el código): cada alta o baja del piloto, y
  el propio lanzamiento, necesitarían cambio de código y deploy.
- **Variable de entorno** (todo o nada): no permite pilotos con algunas personas, y
  lanzar exige tocar el servidor y reiniciar; además no es "solo Admin".
- **Piloto solo por roles o solo por personas:** roles no sirve para "este
  supervisor sí y aquel no"; personas obliga a cargar uno por uno a un rol entero.

## Consecuencias

- Un ítem del menú con `modulo` se oculta cuando `perfil.modulos[clave] === false`.
  Un módulo registrado que el perfil no trae se muestra (no rompe nada si el
  Backend es más viejo que el Frontend).
- El perfil se pide al iniciar sesión: un cambio de Admin se ve al recargar la
  página o al volver a entrar, no al instante.
- Los datos que se generan durante el piloto (en Seguridad, los puntos) son reales.
  Si el lanzamiento debe "arrancar de cero", se resuelve con el filtro de fechas
  del ranking, no borrando datos.
- El rediseño ERP, que tenía reservado este número, pasa a ADR-029.
