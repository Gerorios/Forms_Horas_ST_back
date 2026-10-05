# Estado vivo + bitácora con lo hecho (2026-10-04)

**Carril corto.** Solo docs en el repo; el único código es un hook en `Formulario_Horas/.claude/` (fuera de git).
Esquema tomado del instructivo de Inspecciones K11, con las adaptaciones aprobadas por el usuario.

1. `.claude/Contexto/estado.md` (nuevo): SOLO lo vivo — en curso, próximo paso, pendientes del usuario, a futuro.
   Sale de §0 de la bitácora y de las memorias `pendientes-usuario`, `relevamiento-2026-09-28` y `backups-*`.
2. `.claude/Contexto/contexto-proyecto.md`: misma ruta y mismos números (los citan ~20 docs). Se quita §0 (lo fijo
   del sistema pasa al `CLAUDE.md` de la raíz; lo vivo, a `estado.md`) y las secciones quedan con la más nueva arriba.
   Entrada nueva §102 arriba de todo con este cambio.
3. Hook `Formulario_Horas/.claude/hooks/ultimas-entregas.mjs` (SessionStart: startup|resume|clear|compact) que
   imprime las 3 entradas más recientes; registrado en `Formulario_Horas/.claude/settings.local.json`.
4. `CLAUDE.md` de la raíz: `@Backend/.claude/Contexto/estado.md` + la regla (actualizar al avanzar, borrar al
   entregar). `flujo-sertec`: la misma regla en la tabla de datos y en la entrega.
5. Memoria: retirar las 3 memorias que pasan a `estado.md`.

**Verificación:** el contenido de cada sección queda idéntico (solo cambia el orden); el hook corre a mano e imprime
§102, §101 y §100; JSON de settings válido. Sin revisión de código: solo docs (ninguna ronda).
