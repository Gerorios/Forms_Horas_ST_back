# ADR-025: "Central Sertec": la app pasa de "Registro de Horas" a sistema interno integral, con un sistema de diseño único

**Fecha:** 2026-09-21
**Estado:** aceptado. Afecta al Frontend completo (shell, inicio, login y los
34 módulos). El Backend solo aporta indicadores nuevos si el inicio los pide.

## Contexto

La aplicación nació como formulario de carga de horas y se llamó así en la
barra lateral, el login y la pestaña: "Registro de Horas · Gestión de
cuadrillas". Hoy centraliza además novedades y ausencias, liquidación con
cierres versionados, certificaciones y facturación por contrato, km de
relevadores y combustible. El nombre y la apariencia quedaron chicos: el
inicio es una grilla plana de tarjetas en el orden del menú, sin jerarquía
entre lo que mueve dinero y lo que carga datos. El dueño de producto pidió que
se vea y se sienta como el sistema interno integral de la empresa, con fotos
de la empresa de fondo, y eligió entre tres direcciones presentadas en mockup
(spec visual: `docs/superpowers/specs/2026-09-21-redisenio-central-sertec-mockup.html`,
también publicada en https://claude.ai/artifact/SENhNr72nKf24tFte9RJw7; plan:
`docs/superpowers/plans/2026-09-21-redisenio-central-sertec.md`).

## Decisión

1. **Nombre: "Central Sertec".** Reemplaza a "Registro de Horas" en barra,
   login, pestaña y documentación (no hay correos en el sistema). El título
   de la pestaña es "Central Sertec" completo (una pestaña angosta lo recorta
   sola a "Central"); la abreviatura "CS" se usa en la barra plegada.
2. **Módulos agrupados en cuatro áreas**, que ordenan la barra lateral y el
   inicio y dan contexto al encabezado de cada módulo:
   - **Operación**: reporte diario, mis registros, aprobaciones, control
     general, km por tantos, **combustible**.
   - **Personas**: novedades, ausencias (HyS).
   - **Resultados operativos**: liquidación (quincena, análisis, cierres,
     perfiles de empleados, tarifas) y certificaciones y facturación. Los
     perfiles quedan dentro de Liquidación por decisión del dueño de producto:
     son un dato de liquidación, no un módulo de personas.
   - **Administración**: usuarios y catálogos.
   Los roles siguen decidiendo qué módulos ve cada persona; las áreas solo
   agrupan.
3. **Dirección visual "Grafito industrial"**: barra lateral oscura (grafito
   `#1b1f24`) con el dorado de marca (`#ecb332`) como único acento y luz;
   contenido claro sobre arena (`#f3f1ec`, `#faf9f6`) y blanco; franja
   fotográfica a todo el ancho en el inicio y foto a pantalla completa en el
   login. Se conservan las tipografías (Space Grotesk para display, IBM Plex
   Sans y Mono), la barra plegable, los componentes de tabla y los pills de
   estado. La foto lleva siempre el mismo tratamiento: oscurecida hacia
   grafito con una luz dorada, para que fotos distintas se lean como una
   sola familia. Hasta recibir fotos reales se usan marcadores.
4. **Alcance total, en etapas con un PR cada una**: (1) tokens y shell, (2)
   inicio y login, (3) módulos área por área unificando encabezado, tarjetas
   e indicadores. Producción nunca queda a medio camino: cada etapa deja la
   app coherente.

## Opciones descartadas

- **"Evolución clara"** (barra blanca, banner en el inicio): menor cambio,
  pero seguía pareciendo el formulario de siempre con más tarjetas.
- **"Panel de mosaicos"** (inicio de contadores vivos, barra solo de íconos):
  atractivo, pero cada mosaico exige un indicador del backend y la barra de
  íconos obliga a aprender la iconografía. Sus contadores pueden sumarse más
  adelante al inicio de la dirección elegida.
- **Nombres "Sertec Gestión" y "Sertec Operaciones"**: el primero suena a
  trámite, el segundo excluye liquidación y facturación.

## Consecuencias

- Contraste (verificado al planificar): el dorado `#ecb332` sobre grafito
  `#1b1f24` da ~8,6:1 y cumple AA y AAA aun para texto chico. Lo que **no**
  sirve es el dorado como texto sobre claro (~1,9:1: ahí va `brand-deep`), el
  gris `slate` actual sobre grafito (~3,2:1: en la barra el texto secundario
  va blanco al 70 %), el hover crema `bg-accent` sobre grafito (flash claro:
  va `bg-white/8`) y el blanco sobre foto sin velo (velo grafito ≥ 55 %).
- El glosario incorpora "Central Sertec" y "área" (ver `CONTEXT.md`).
- Todo lo que hoy dice "Registro de Horas" (metadatos, títulos, correos,
  tests) cambia; los tests que afirman ese texto se actualizan a propósito.
