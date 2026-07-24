# ADR-007 — Tipos de novedad habilitados por usuario (empieza por JefeCuadrilla)

**Fecha:** 2026-07-23
**Estado:** Aceptado
**Afecta:** `sth_tipos_novedad_habilitados` (tabla nueva), `POST /novedades`,
Admin > Usuarios, el nav lateral, y el formulario de carga de novedad.

## Contexto

Hoy `POST /novedades` se restringe solo por rol (`Supervisor`, `JefeContrato`,
`Admin`) — **JefeCuadrilla no puede cargar ninguna novedad**, y ningún rol
tiene restricción sobre qué tipo de novedad puede usar (cualquiera de esos 3
roles puede cargar cualquier tipo, para cualquier operario).

El caso concreto: hay novedades tipo "Viáticos" que se le quieren habilitar
puntualmente a algunos Jefes de Cuadrilla (no a todos) para que puedan
cargárselas a los operarios de su cuadrilla que corresponda — sin tener que
pasar por un Supervisor. Esto alimenta más adelante la liquidación: contando
los días con novedad "Viáticos" por operario se sabe cuánto reintegrar (rol
Liquidador, aún no implementado — ver glosario).

## Decisión

Se agrega `TipoNovedadHabilitado` (M:N `usuarioCuil` × `tipoNovedadId`),
mismo patrón que `ContratoHabilitado`. Se agrega `JefeCuadrilla` a los roles
permitidos en `POST /novedades`, pero **solo para JefeCuadrilla** se valida
que el `tipoNovedadId` elegido esté en su lista habilitada — vacía por
defecto, no puede cargar nada hasta que se le asigne al menos un tipo desde
Admin > Usuarios. **Supervisor/JefeContrato/Admin no se tocan**: siguen sin
ninguna restricción de tipo, exactamente igual que hoy.

En el nav lateral, "Novedades" pasa a mostrarse también para JefeCuadrilla,
pero **solo si tiene al menos un tipo habilitado** — un JefeCuadrilla sin
tipos asignados no debe ver la opción en absoluto, no alcanza con el rol.

No hay un campo booleano separado tipo "¿carga novedades?": la lista vacía ya
significa que no puede cargar nada. El toggle "¿Carga novedades?" en el
formulario de Admin es puramente visual (muestra u oculta la lista de tipos a
tildar), mismo criterio que "¿Es Jefe de Contrato?" con `contratosJefeIds`.

## Alternativas consideradas

- **Restringir también a Supervisor/JefeContrato ahora.** Se decidió
  explícitamente empezar solo por JefeCuadrilla — es el caso real que
  motivó el cambio. Extender el mismo mecanismo a los otros roles queda
  para una tarea aparte si aparece la necesidad.
- **Permiso sobre el operario receptor, no sobre quien carga.** Se descartó:
  el patrón ya establecido (`ContratoHabilitado`, `contratosComoJefe`) es
  siempre un permiso sobre quien realiza la acción, no sobre el sujeto de la
  novedad — mantenerlo consistente evita un tercer modelo de permisos distinto
  en el mismo panel de Admin.

## Consecuencias / notas

- **Migración de Prisma:** igual que ADR-002/003/004/005/006, la BD es
  compartida — el DDL se aplica a mano, nunca `prisma migrate`/`db push`.
  Ojo: `usuario_cuil` debe crearse con `CHARACTER SET utf8mb3 COLLATE
  utf8mb3_general_ci` para poder referenciar `sth_usuarios.cuil` (esa columna
  no usa el charset por defecto de la tabla) — el mismo detalle aplica a
  cualquier FK nueva hacia `sth_usuarios.cuil`.
- El formulario de carga de novedad filtra el desplegable de "Tipo" a los
  habilitados del usuario solo cuando es JefeCuadrilla; para los demás roles
  sigue mostrando el catálogo completo, sin cambios.
