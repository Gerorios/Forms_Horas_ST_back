# Revisión: Autogestión de la Seguridad (ADR-027) y Lanzamiento de módulos (ADR-028) (2026-10-14)

PRs de Rodrigo: Backend #110 y Frontend #91 (rama `feat/autogestion-seguridad`, contra `dev`). Trae DDL (3 SQL, ya
aplicados en `testing`) y toca auth/permisos: zona sensible, dos rondas (la segunda solo sobre los arreglos).
Revisión (Standards + Spec + Permisos/seguridad, verificador): 0 urgent, 3 high, 9 minor, 8 descartados.
Permisos sin hallazgos de acceso: `ModuloGuard` a nivel de clase cubre todos los endpoints; sin IDOR.

## Paso R1 (high) — el perfil se rompe si falla la consulta de lanzamientos

`Backend/src/auth/auth.service.ts:90`: `perfil()` llamaba a `lanzamientos.visibles()` sin try/catch. Si el back
llega a producción antes del SQL de lanzamientos, `GET /auth/perfil` da 500 y nadie entra al sistema.
Arreglo: `resolverModulos` con try/catch que devuelve `{}` (igual que `resolverCert`); `ModuloGuard` sigue cerrando.
Test en `auth.service.spec.ts`, visto en rojo.

## Paso R2 (high) — el rollback del DDL falla

`docs/sql/2026-10-07-autogestion-seguridad.sql:33`: el rollback borra `sth_seg_periodos`, que ya borró
`2026-10-08-seguridad-ajustes.sql`; el DROP múltiple falla entero y no borra nada. Arreglo: `DROP TABLE IF EXISTS`.

## Paso R3 (high) — editar una paralización enviada sin GPS exige la ubicación

`Frontend/src/features/seguridad/reporte-form.tsx:135`: el back no guarda "sin ubicación" y el form arrancaba en
`false`; al editarla pedía "Tomar mi ubicación" y, desde otro lugar, guardaba un punto que no es el de la obra.
Arreglo: en edición de una paralización sin punto de GPS, `sinUbicacion` arranca en `true`. Test en
`reporte-form.test.tsx`, visto en rojo.

## Minor (sin tocar, van al comentario del PR)

`corregir` sin `puedeCalificar` ni control de reporte propio; gráficos del ranking con divs (regla Recharts:
decide el usuario); `quitarFoto` sin tope de subidas; DTO sin `MaxLength`/`@Max`; carrera calificar/corregir;
`estado.md` del PR desactualizado; plan del rediseño dice 028 (es 029); comentarios/docs viejos ("períodos",
ADR-027 "Propuesto"); duplicaciones (`mapaNombres`, guard de layout ×3, `FOCO_VISIBLE`, literales de rol).

## Segunda ronda (solo los arreglos R1-R3)

0 urgent, 0 high, 2 minor (al comentario del PR): si falla la consulta de lanzamientos, quien no está en el
piloto ve Seguridad en el menú y al entrar recibe un error genérico (el back igual lo cierra); al editar una
paralización con punto tomado de la foto, el cartel dice "Se envía sin ubicación GPS" aunque el mapa la ubica.
Verificación: back `tsc` y build OK, auth 5/5; front `tsc` y build OK, Seguridad 105/105.
