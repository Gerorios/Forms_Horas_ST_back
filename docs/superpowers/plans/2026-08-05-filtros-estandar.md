# Filtros estándar (MultiFiltro) — Plan

Decisiones del grilling 2026-08-05 (cerradas):
- UN componente `MultiFiltro` para TODO filtro categórico de listados: botón con contador
  ("Contrato (3)"), desplegable de checkboxes, opción fija "(Todos)" (marca/desmarca todo),
  buscador interno cuando hay >10 opciones, nada tildado = sin filtro.
- Facetado estándar: las opciones de cada filtro se calculan con los DEMÁS filtros aplicados
  (excluyendo el propio), con contador por opción; fechas y búsquedas libres también acotan.
- Fechas (rango) y búsqueda de texto libre conservan su control, dentro de la misma BarraFiltros.
- Filtros de personas (operario/empleado/cargador) = MultiFiltro con buscador interno.
- Selectores de período (mes/año/quincena) NO son filtros. Formularios NO cambian.
- Pantallas: Aprobaciones (contrato/cargador/operario + fecha queda) · Combustible (móvil/estado
  + fechas quedan) · Control general (personas) · Liquidación Detalle (régimen/categoría/contrato
  ajustados + empleado pasa a MultiFiltro) · Liquidación Perfiles (régimen/categoría/modalidad a
  multi + empleado) · Admin Usuarios (sus selects de filtro).
- Solo frontend. Componente en src/components/ui/barra-filtros.tsx (evoluciona FiltroChecks →
  MultiFiltro; FiltroSelect queda para selectores de período).
