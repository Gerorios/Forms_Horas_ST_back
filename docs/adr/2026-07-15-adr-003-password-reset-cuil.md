# ADR-003 — Reset de contraseña usa el CUIL como contraseña (riesgo de seguridad aceptado)

**Fecha:** 2026-07-15
**Estado:** Aceptado
**Afecta:** alta masiva de usuarios (`POST /admin/usuarios/masivo`) y el nuevo reset individual de
contraseña por Admin (`POST /admin/usuarios/:cuil/resetear-password`).

## Contexto

El alta masiva de usuarios (Fase 4, ver `docs/superpowers/specs/2026-07-04-fase4-panel-admin-design.md`)
generaba una contraseña aleatoria de 10 caracteres por usuario (`AdminService.generarPassword()`) y la
mostraba una única vez en una tabla de credenciales para que el Admin las distribuyera.

En la práctica, esa tabla de credenciales se perdió (se cerró la pestaña del navegador antes de copiarla),
y como las contraseñas se guardan como hash `bcrypt` (**de una sola vía, irreversible**), no hay forma de
recuperar las contraseñas originales — ni consultando la base de datos.

Se necesita un mecanismo para que el Admin pueda resetear la contraseña de un usuario individual sin
depender de un flujo de autoservicio por email: los usuarios de alta masiva reciben un email ficticio con
formato `<legajo>@st.local` (`admin.service.ts:181`) — **`.local` no es un dominio enviable**, así que no
hay forma de mandarles un link de recuperación. Un flujo de "olvidé mi contraseña" por email queda fuera
de alcance hasta que exista infraestructura de envío de mail (diferido, ver §24 del contexto).

## Decisión

**La contraseña de un usuario, tanto en el alta masiva como en el reset individual por Admin, es su
propio CUIL** (11 dígitos, ya cumple el mínimo de 8 caracteres exigido por `MinLength(8)`).

- Alta masiva (`AdminService.createUsuariosMasivo`): en vez de `generarPassword()` (que se elimina, queda
  sin usos), la contraseña de cada usuario nuevo es su `cuil`.
- Reset individual (`AdminService.resetearPassword`, nuevo): setea `passwordHash = bcrypt.hash(cuil)`
  para el usuario indicado, sin generar nada al azar.

En ambos casos la contraseña es **predecible y determinística** — no hay secreto que mostrarle al Admin
después de la operación, porque el CUIL ya es un dato que el Admin tiene a la vista en la fila del usuario.

## Riesgo de seguridad — aceptado explícitamente

**El CUIL de una persona no es un secreto.** Aparece en el DNI, recibos de sueldo, y lo conocen
razonablemente compañeros de trabajo y familiares. Usarlo como contraseña anula la propiedad de
confidencialidad de una contraseña: **cualquiera que sepa el CUIL de un usuario puede iniciar sesión en su
nombre** y cargar/editar horas u otros datos con esa identidad.

Este riesgo fue explicado directamente al dueño del producto (sesión 2026-07-15, `/grill-with-docs`), con
alternativas de menor riesgo (password random pero corto/pronunciable, o CUIL + sufijo fijo). Se decidió
**conscientemente** aceptar el riesgo, priorizando que el Admin pueda dictar/entregar credenciales
simples a operarios de campo sin depender de un canal de comunicación adicional.

**Mitigación futura, si el riesgo deja de ser aceptable:** exigir cambio de contraseña en el primer login
(requiere backend de "cambiar mi contraseña", hoy inexistente — ver pendiente #3 en §23 del contexto), o
retomar contraseñas aleatorias una vez exista un canal de entrega confiable (autoservicio por email/SMS).

## Consecuencias

- `AdminService.generarPassword()` se elimina (sin usos tras este cambio).
- La tabla de credenciales que muestra el alta masiva sigue funcionando igual (sigue devolviendo
  `{ cuil, apellido_nombre, email, password }` por usuario creado), solo que ahora `password` es
  siempre igual al `cuil` de esa fila — no cambia el contrato de la respuesta ni el frontend que la consume.
- El reset individual no necesita devolver ni mostrar la contraseña generada en una pantalla de
  "credenciales" — el diálogo de confirmación en el frontend ya indica a qué se va a resetear (el CUIL),
  porque es un valor conocido de antemano.

## Alternativas consideradas

- **Password random corto/pronunciable** (6-8 caracteres sin símbolos): mantiene algo de secreto sin ser
  tan difícil de dictar como el random de 10 caracteres con símbolos. Descartado por decisión explícita
  del dueño del producto a favor de simplicidad máxima.
- **CUIL + sufijo fijo** (ej. últimos 4 dígitos + año): reduce levemente la obviedad sin perder
  simplicidad. Descartado por la misma razón — se prefirió el CUIL a secas.
- **Autoservicio "olvidé mi contraseña" por email**: descartado para esta iteración por falta de
  infraestructura de envío de mail y por email no enviable (`@st.local`) en la mayoría de los usuarios.
  Queda como pendiente global (ver §24 del contexto).
