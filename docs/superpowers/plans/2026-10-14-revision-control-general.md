# Revisión: Control general — período libre, filtro de tarea y Excel (2026-10-14)

PRs de Rodrigo: Backend #111 y Frontend #92 (rama `feat/exportacion-tareas-periodo`, contra `dev`), ADR-030.
Revisión (`revision-codigo` + verificador): 0 urgent, 1 high, 7 minor, 7 descartados. Permisos sin hallazgos.
Decisión del usuario: el rango de hasta 12 meses con "horas completas" en pantalla queda como está.

## Paso R1 (high) — el filtro de tarea se pierde sin aviso

`Frontend/src/app/(protected)/control-general/page.tsx`: si se elige una tarea que no existe en el contrato
filtrado después (ej. "Zanjeo", solo de K5, y luego el contrato K7), `tareaIds` queda vacío y no se manda, pero
el filtro sigue mostrando "Tarea (1)": pantalla y Excel traen todas las tareas creyendo ver solo esa.
Arreglo: al cambiar el contrato, sacar de `tareasSel` los nombres que ya no están entre las tareas disponibles.
Test rojo primero en `control-general-page.test.tsx`: elegir Zanjeo, luego K7 → el filtro dice "Tarea", no
"Tarea (1)". Verificación: spec del área, `tsc`, build. Va como commit sobre la rama de Rodrigo.
