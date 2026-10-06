# Estado del trabajo

Solo lo vivo: lo que está en curso, el próximo paso, lo que espera al usuario y lo que quedó para más adelante.
Lo entregado no va acá: su cierre está en `contexto-proyecto.md` (la bitácora, la más reciente arriba). La regla
está en el `CLAUDE.md` de la raíz `Formulario_Horas` ("Estado del trabajo"). Última actualización: **2026-10-06**.

## En curso

Nada en curso.

## Próximo paso

Ninguno definido: esperar el próximo pedido del usuario.

## Pendientes del usuario

- **Baja de Operario (§103):** que HyS revise las 2 bajas que quedaron pendientes en su bandeja (últimos días
  trabajados 29/09 y 05/10) y las confirme o rechace. Probar la feature en producción.

- **Clave SSH:** guardar una copia de `~/.ssh/forms_horas_vps2` en un lugar seguro (es la única forma de entrar por
  SSH y no tiene frase de protección). Confirmar con Rodrigo cómo entra, y averiguar de quién es la clave
  `claude-code@forms-horas-vps` cargada en `root` (no es de la PC del usuario).
- **Pedido a IT:** restringir MySQL `191.101.235.7:3306` (hoy abierto a internet) a la IP de la VPS y la de la oficina.
- **Rediseño:** recorrida visual con Liquidador/Admin de los tableros de análisis, resumen y analytics.

## A futuro

Por prioridad de la auditoría del 2026-09-28 y la de seguridad del 2026-10-01:

- **Backups automáticos de `Horas_Sertec` (prioridad 1):** pospuesto por el usuario el 2026-10-05; no traerlo como
  en curso ni pendiente hasta que lo pida. Quedó en la entrevista, pregunta 1 (destino externo). Ya se le explicó qué
  es; no repetirlo. Enfoque aceptado: dump nocturno con transacción → `zstd` → `gpg` simétrico con frase larga →
  copia local 14 días + Google Drive con `rclone` (90 días + una mensual por un año) → restore probado en `testing` →
  procedimiento escrito sin la clave. VPS: falta `mariadb-client` y `rclone`; hay `gpg`, `zstd`, `rsync`, 90 GB
  libres. La base pesa 14,6 MB; los adjuntos, 11 MB.

- **Credenciales (prioridad 2):** alta masiva y reset usan el CUIL como contraseña, sin cambio forzado al primer
  ingreso ni límite de intentos. Juntarlo con el login de abajo.
- **Login de la app:** se alcanza saltando Cloudflare (HTTPS directo a la IP) y nginx ve IPs de Cloudflare, no las
  reales. Arreglo: `real_ip` de Cloudflare, limitar 80/443 a sus rangos, `limit_req` y `@nestjs/throttler`.
- **DDL a mano en dos bases (prioridad 3):** migrar a Prisma Migrate de a poco, empezando por el próximo cambio de
  esquema. Pendiente puntual: `DROP COLUMN modalidad_pago` (§87).
- **Sesión (prioridad 4):** JWT de 1 h sin refresh, en localStorage, con el rol dentro del token.
- **`registros-horas.service.ts` (prioridad 5):** 1313 líneas; separar los 6 métodos de paneles a
  `paneles.service.ts` recién cuando toque un panel. Ya se le explicó al usuario que es mecánico; no reabrirlo.
- **Menores:** `estado` sin validar en el listado de registros (500 en vez de 400); CORS abierto; `.env` del backend
  en 644 (debería ser 600); `server_tokens off` en nginx; GET `/empleados` visible para todo rol; paginación.
- **Portal de certificaciones apagado (§84):** rotar `AZURE_CLIENT_SECRET`, `OPENAI_API_KEY` y `HORAS_JWT_SECRET`;
  borrar vistas de compatibilidad y la tabla `usuarios` en `Horas_Sertec`; limpiar `testing`; archivar el repo.
  Irreversible: pedir OK por cada paso.
- **Deuda de Baja de Operario:** 9 minor de la revisión de #105/#88 (§103, comentario en los PRs). Los más
  relevantes: alta de baja sin transacción ni índice único, bajas confirmadas en las pestañas
  Justificadas/Injustificadas de `/ausencias`, conteo de bajas sin confirmar distinto entre front y back con
  administrativos.
- **Deuda de Frontend:** minors de #84-#86 (§96-§98); `session.tsx` deja guardado el token si falla `fetchPerfil`.
- **Codex como tercer revisor:** idea conversada (usa el plan ChatGPT del usuario vía Codex CLI, solo lectura, en la
  fase 4 de `flujo-sertec`). No arrancó: falta que el usuario lo pida.
