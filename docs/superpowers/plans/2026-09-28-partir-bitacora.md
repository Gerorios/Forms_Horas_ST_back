# Partir la bitácora (2026-09-28)

**Carril corto.** Solo docs: cero archivos de código, sin DDL, sin API. Paso 6 de la
reorganización del harness, aprobado por el usuario ("hacé los pasos 4 a 6").

**Pedido:** la bitácora `.claude/Contexto/contexto-proyecto.md` pesa 260 KB y 4000 líneas;
ya no se puede leer entera. Partirla sin romper las referencias "§NN" de ~20 docs.

## Pasos

1. `.claude/Contexto/contexto-proyecto-historico.md` ← §1-§90 tal cual (líneas 1-3569),
   con una nota arriba: qué contiene, que está congelado y que manda el archivo vivo.
2. `.claude/Contexto/contexto-proyecto.md` (misma ruta, para no romper referencias) ←
   encabezado + **§0 "Estado actual"** nuevo (qué es, stack y hosting, roles, dónde vive
   cada cosa, pendientes abiertos, dónde están §1-§90) + §91-§99 tal cual + §100 de cierre.
3. Verificación: `cat` de los dos archivos reconstruye el original línea por línea salvo el
   encabezado nuevo y §0/§100 (comprobado con `diff`); ninguna sección se pierde ni se
   duplica (conteo de `^## N.`).

Sin test ni revisión de código: solo docs (flujo, fase 4: "ninguna" ronda).

## Riesgos

- Una referencia "§NN" con NN ≤ 90 ahora se resuelve en el histórico: §0 lo dice en su
  primera línea. No se reescriben los 20 docs que citan secciones viejas.
- PR solo en Backend; nada que deployar.
