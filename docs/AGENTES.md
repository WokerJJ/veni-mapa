# Agentes del proyecto

Asignación de roles para el trabajo en este repositorio. Los agentes viven en `~/.claude/agents/` (del usuario); el repositorio no define agentes propios. La implementación la hace Claude Code (sesión principal): ningún agente disponible implementa funcionalidades.

| Rol | Responsable | Cuándo |
| --- | --- | --- |
| Arquitectura | Claude Code diseña · `evaluador-codigo` valida | Al abrir cada issue que cambia el pipeline |
| Pipeline de datos (extracción, PMTiles) | Claude Code | Issues `area:pipeline` |
| Estilo y frontend (MapLibre, demo) | Claude Code | Issues `area:estilo`, `area:demo` |
| DevOps (Docker, Actions, releases, R2) | Claude Code · `evaluador-codigo` revisa workflows | Issues `area:ci`, `area:release` |
| Pruebas | Claude Code escribe · `corrector-codigo` agrega la prueba de cada corrección · `buscador-fallas` detecta pruebas que no prueban | Cada PR |
| Revisión de código | `evaluador-codigo` (hallazgos `EVA-###`) | Cada PR, antes del merge |
| Seguridad | `buscador-fallas` (hallazgos `BUG-###`) | PR que tocan workflows con secrets, publicación o CORS |
| API y datos | `auditor-api-datos` | No aplica aquí: el repositorio no tiene API ni base de datos |
| Correcciones | `corrector-codigo` | Con los IDs de hallazgos a corregir |
| Documentación | Claude Code escribe · `cronista-proyecto` mantiene la memoria en `.claude/agentes/` y detecta docs desactualizados | Al cerrar cada bloque |

## Flujo por PR

1. Implementación y verificación local (`make` + validaciones).
2. `evaluador-codigo` y `buscador-fallas` en paralelo sobre la rama.
3. Los hallazgos se publican como comentarios del PR y se corrigen todos (un commit por corrección).
4. CI en verde, squash merge, se borra la rama y el issue pasa a **Hecho**.
