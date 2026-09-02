# Deploy ERP etapa 3 — maestro de ítems

Sin DDL (el UNIQUE (item_codigo, id_contrato) ya existía; sin duplicados
normalizados verificado 2026-09-01). Deploy estándar:

1. Merge de los PRs (Backend y Frontend de Horas). Los TRES repos: el portal
   NO tiene cambios en esta etapa (verificarlo igual).
2. VPS: pull + npm install + npx prisma generate + build en ambos repos.
3. AVISO al usuario y sudo pm2 restart forms-horas-back forms-horas-front.
4. Smoke: /api/certificaciones/items 401 sin token; con admin: la pantalla
   Ítems lista, crea, edita (vaciar un campo lo borra) y bloquea el borrado
   de un ítem con certificaciones.
5. Paridad: el listado de la pantalla nueva vs items.html del portal para
   un mismo contrato (mismos ítems; el orden es el mismo, textual).
6. Aviso operativo: a partir de acá el maestro se administra desde
   misregistros; items.html del portal queda redundante (ambos escriben la
   misma tabla física — evitar ediciones simultáneas). Se apaga en etapa 5.
7. Documentar la sesión en los dos contextos.
