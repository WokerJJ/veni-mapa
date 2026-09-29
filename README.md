# Vení · Mapa de Roldanillo

Pipeline reproducible que recorta Roldanillo (Valle del Cauca, Colombia) de OpenStreetMap, lo empaqueta como [PMTiles](https://docs.protomaps.com/pmtiles/) y genera un estilo [MapLibre](https://maplibre.org/) con la marca **Vení**. Cada versión se publica como release para que la app [veni-roldanillo](https://github.com/WokerJJ/veni-roldanillo) la consuma sin depender de la API de Google Maps.

> 🚧 En construcción: milestone **v0.1.0 · Primer mapa**. El avance está en [docs/BITACORA.md](docs/BITACORA.md).

## Uso

El único requisito es Docker. Todas las herramientas (make, pmtiles, yq, jq, Node) vienen en la imagen de [`docker/tools`](docker/tools/Dockerfile), la misma que usa la CI:

```bash
docker compose run --rm tools make help      # lista los objetivos
docker compose run --rm tools make extract   # build/roldanillo.pmtiles
```

| Objetivo | Qué hace |
| --- | --- |
| `extract` | Resuelve la build diaria más reciente de Protomaps, corre `pmtiles extract --dry-run` (reporte en `build/extract-report.txt`) y extrae la región a `build/<región>.pmtiles`. Deja la procedencia (build, bbox, tamaño, SHA-256) en `build/build.json`. |
| `assets` | Glyphs y sprites autohospedados. |
| `style` | Estilos MapLibre claro y oscuro, en español e inglés. |
| `serve` | Sirve la demo en local. |
| `all` | `extract`, `assets` y `style`. |

Para reproducir una versión exacta, fijá la build: `BUILD_DATE=20260928 docker compose run --rm tools make extract`.

La extracción no descarga el planeta: `pmtiles` pide por rangos HTTP solo los tiles de la región (unos 1,6 MB hoy).

## Región

La región se define en un solo archivo, [`config/region.yml`](config/region.yml): la caja delimitadora (oeste, sur, este, norte, en WGS84) que cubre el casco urbano de Roldanillo y sus veredas, el zoom máximo y la vista inicial de la demo. `scripts/region.sh` valida el archivo y lo expone como variables de `make`, así ningún otro archivo repite esos valores.

Las builds diarias de Protomaps llegan hasta z15: el extracto se recorta a ese zoom y MapLibre sobreescala (overzoom) los tiles para mostrar z16 o más.

## Documentación

- [docs/BITACORA.md](docs/BITACORA.md): diario de avance.
- [CONTRIBUTING.md](CONTRIBUTING.md): flujo de trabajo, ramas y commits.

## Licencia y atribución

- Código: todos los derechos reservados, ver [LICENSE](LICENSE).
- Datos del mapa: © colaboradores de OpenStreetMap, bajo [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Componentes de terceros: ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
