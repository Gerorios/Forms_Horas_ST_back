# ADR-008: Usuarios fuera de nómina (sin fila en `snuempleados`)

## Contexto

Hoy `Usuario.cuil` es a la vez la clave primaria de `sth_usuarios` y una foreign
key obligatoria hacia `snuempleados.cuil` (`sth_usuarios_cuil_fkey`, `ON DELETE
RESTRICT ON UPDATE CASCADE`). Esto significa que **no se puede crear ningún
usuario** (sin importar el rol) si su CUIL no existe primero como fila en
`snuempleados`.

`snuempleados` es una tabla externa al dominio de esta app — se sincroniza
automáticamente desde otro sistema (ERP/liquidador de sueldos), que la
sobreescribe periódicamente. El Admin necesita dar de alta usuarios para
personas que **no están en relación de dependencia** (ej. el dueño o un socio
gerente) y por lo tanto nunca van a tener una fila ahí.

Insertar una fila "trucha" a mano en `snuempleados` para resolver esto se
descartó: al ser una tabla sincronizada externamente, esa fila podría ser
pisada o eliminada en la próxima sincronización, rompiendo el login de esa
persona sin aviso.

## Decisión

1. **Se elimina la foreign key física** `sth_usuarios_cuil_fkey`. `Usuario.cuil`
   sigue siendo la clave primaria/identidad de login (un CUIL es un dato
   personal — lo tiene cualquier persona, sea o no empleado en relación de
   dependencia — así que no hace falta inventar un esquema de IDs paralelo).
   Pero ya no está enforced a nivel de base que ese CUIL exista en
   `snuempleados`.
2. Se agrega `Usuario.nombreFueraNomina` (nullable): nombre y apellido
   cargados a mano por el Admin, usado como dato para mostrar únicamente
   cuando no hay fila de empleado vinculada.
3. En el backend, el join `Usuario` ↔ `snuempleados` deja de ser una relación
   Prisma (`@relation`) y pasa a resolverse a mano en el código de aplicación
   (buscar `snuempleados` por `cuil`; si no existe, usar
   `nombreFueraNomina`). `legajo`/`cargo` quedan `null` para estos usuarios.
4. En el panel de Admin, "Nuevo usuario" tiene un interruptor **"En nómina" /
   "Fuera de nómina"**: con nómina se mantiene el buscador de empleados
   actual; fuera de nómina se cargan a mano Nombre, Apellido y CUIL. Está
   disponible para cualquier rol, no solo Admin.

## Consecuencias

- Se pierde la integridad referencial automática entre `sth_usuarios` y
  `snuempleados` — un `Usuario` puede no tener empleado real vinculado, y eso
  ahora es intencional, no un bug.
- También se pierde el `ON UPDATE CASCADE`: si el CUIL de un empleado real
  cambiara en `snuempleados`, ya no se actualiza solo en `sth_usuarios`. Se
  acepta el riesgo porque el CUIL de una persona no cambia en la práctica.
- Cualquier futura consulta que asuma "todo `Usuario` tiene un
  `snuempleados` real" (ej. reportes, joins directos en SQL manual) debe
  contemplar el caso `null` a partir de ahora.

## Alternativas consideradas

- **Insertar fila manual en `snuempleados`** — descartada: riesgo de que el
  sync externo la pise o borre.
- **Esquema de identidad separado (no usar CUIL como PK para estos casos)** —
  descartada: un CUIL es un dato personal válido para cualquiera, agregar un
  esquema de IDs paralelo solo para este caso sumaba complejidad sin necesidad.
