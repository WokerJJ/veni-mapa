# Cómo contribuir

Este es un proyecto de portafolio con todos los derechos reservados sobre el código (ver [LICENSE](LICENSE)). Se reciben reportes de errores y sugerencias por issues. Para mejorar los datos del mapa, lo correcto es editar OpenStreetMap directamente.

## Flujo de trabajo

1. Todo cambio parte de un issue con criterios de aceptación.
2. Rama desde `main`: `feat/<n>-<descripcion>`, `fix/<n>-…`, `chore/<n>-…`, `docs/<n>-…`.
3. Commits con [Conventional Commits](https://www.conventionalcommits.org/es/) en español que referencian el issue:
   `feat(estilo): variante oscura con la paleta Vení (#5)`.
4. PR con la plantilla y `Closes #N`. Requiere CI en verde y revisión.
5. Squash merge; la rama se borra al fusionar.

`main` está protegida: solo se modifica por PR.

## Idioma

Documentación, commits e issues en español. Código (variables, archivos, claves) en inglés.

## Verificación local

Todo corre en la imagen de herramientas; el único requisito es Docker (también en Windows, sin `make`):

```bash
docker compose run --rm tools make help                   # objetivos disponibles
docker compose run --rm tools make extract assets         # pipeline
docker compose run --rm tools bash tests/assets_test.sh   # una suite de pruebas
```

Los objetivos y opciones están en el [README](README.md#uso). Las pruebas viven en `tests/*_test.sh` y la CI corre todas.

En Windows git no registra el bit de ejecución: al crear un script nuevo en `scripts/` o `tests/`, marcalo con `git update-index --chmod=+x <archivo>`. La CI falla si falta.
