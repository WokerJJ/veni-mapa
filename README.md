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
| `assets` | Descarga las fuentes y los sprites de [`config/assets.lock`](config/assets.lock) (fijados por commit y verificados por SHA-256) y genera en `build/assets` los glyphs de [`config/fontstacks.yml`](config/fontstacks.yml) con [font-maker](https://github.com/maplibre/font-maker). |
| `style` | Estilos MapLibre claro y oscuro, en español e inglés. |
| `serve` | Sirve la demo en local. |
| `all` | `extract`, `assets` y `style`. |

Para reproducir una versión exacta, fijá la build (funciona igual en bash y en PowerShell):

```bash
docker compose run --rm tools make extract BUILD_DATE=20260928
```

La misma build produce siempre el mismo archivo (mismo SHA-256 en `build/build.json`).

En Linux, el contenedor corre con tu usuario para que `build/` no quede de root: exportá `HOST_UID=$(id -u)` y `HOST_GID=$(id -g)` si tu uid no es 1000.

Si tu `build/` lo creó una versión anterior de la imagen (que corría como root) y ves `Permission denied`, borralo una vez con `docker compose run --rm --user 0:0 tools rm -rf build`.

La extracción no descarga el planeta: `pmtiles` pide por rangos HTTP solo los tiles de la región (unos 1,6 MB hoy).

## Tipografías y sprites

El estilo usa las tipografías de la marca Vení, servidas desde el mismo lugar que el mapa (sin CDNs de terceros):

| Fontstack | Uso | Respaldo incluido |
| --- | --- | --- |
| `Figtree Regular` | Etiquetas generales | Noto Sans Regular |
| `Figtree SemiBold` | Vías principales y barrios | Noto Sans SemiBold |
| `Figtree Italic` | Agua | Noto Sans Italic |
| `Bricolage Grotesque Bold` | Lugares destacados | Noto Sans Bold |

Un hosting estático no puede combinar fuentes al vuelo, así que font-maker mete el respaldo de Noto Sans dentro de cada fontstack: lo que Figtree o Bricolage no cubren (griego, cirílico, Latin extendido) sale de Noto. Los sprites son los de [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (v4, claro y oscuro). Licencias en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
