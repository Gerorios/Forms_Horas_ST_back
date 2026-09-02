# Deploy ERP etapa 3 — maestro de ítems

Sin DDL (el UNIQUE (item_codigo, id_contrato) ya existía; sin duplicados
normalizados verificado 2026-09-01). Deploy estándar:

1. Merge de los PRs (Backend y Frontend de Horas). Los TRES repos: el portal
   NO tiene cambios en esta etapa (verificarlo igual).
2. Limpieza única de datos (hallazgo de la review final, verificado en
   producción el 2026-09-02: existen tipos legacy '' y 'm'):
   `UPDATE sth_cert_items SET tipo = NULL WHERE tipo IS NOT NULL AND tipo NOT IN ('OPEX','CAPEX');`
   (analytics ya ignoraba esos valores; NULL = "sin especificar" honesto y
   elimina el borde de que una edición los pise en silencio). Anotar el
   conteo de filas afectadas. Correr también en `testing.sth_cert_items`
   (snapshot dev, misma regla).
3. VPS: pull + npm install + npx prisma generate + build en ambos repos.
4. AVISO al usuario y sudo pm2 restart forms-horas-back forms-horas-front.
5. Smoke: /api/certificaciones/items 401 sin token; con admin: la pantalla
   Ítems lista, crea, edita (vaciar un campo lo borra) y bloquea el borrado
   de un ítem con certificaciones.
6. Paridad: el listado de la pantalla nueva vs items.html del portal para
   un mismo contrato (mismos ítems; el orden es el mismo, textual).
7. Aviso operativo: a partir de acá el maestro se administra desde
   misregistros; items.html del portal queda redundante (ambos escriben la
   misma tabla física — evitar ediciones simultáneas). Se apaga en etapa 5.
8. Documentar la sesión en los dos contextos.
