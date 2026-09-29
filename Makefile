# Pipeline del mapa de Roldanillo.
#
# Se ejecuta dentro de la imagen de herramientas, sin instalar nada más:
#   docker compose run --rm tools make <objetivo>
# (En Linux o macOS con bash, curl, jq, yq v4, pmtiles, font-maker y Node 24 también corre directo.)

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-builtin-rules --warn-undefined-variables

BUILD_DIR := build
BUILD_DATE ?=
# URL absoluta donde se publican PMTiles, glyphs y sprites; queda escrita en los
# estilos. Por defecto, la de `make serve`.
STYLE_BASE_URL ?= http://localhost:8080
# Versión que queda en los metadatos de los estilos; la fija el workflow de release.
STYLE_VERSION ?= dev
# Tamaño máximo del extracto que acepta make verify (hoy pesa ~1,6 MB).
PMTILES_MAX_MB ?= 50

# Los valores de la región salen de config/region.yml. make regenera
# build/region.mk cuando cambia el YAML y lo vuelve a leer antes de seguir.
# help, clean, assets, check, licenses y serve no lo necesitan: funcionan aunque el YAML esté roto.
NO_REGION_GOALS := help clean assets check licenses serve
ifneq ($(filter-out $(NO_REGION_GOALS),$(or $(MAKECMDGOALS),$(.DEFAULT_GOAL))),)
include $(BUILD_DIR)/region.mk
endif

$(BUILD_DIR)/region.mk: config/region.yml scripts/region.sh
	@mkdir -p $(@D)
	@scripts/region.sh $< >$@.tmp || { rm -f $@.tmp; exit 1; }
	@mv $@.tmp $@

export REGION_NAME REGION_BBOX REGION_MAXZOOM REGION_CENTER REGION_ZOOM BUILD_DIR BUILD_DATE STYLE_BASE_URL STYLE_VERSION PMTILES_MAX_MB

.PHONY: help all extract style assets site serve check verify licenses clean

help: ## Muestra esta ayuda
	@echo "Uso: docker compose run --rm tools make <objetivo>"
	@echo
	@grep -hE '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'
	@echo
	@echo "Variables: BUILD_DATE=AAAAMMDD (build de Protomaps; por defecto, la más reciente),"
	@echo "           STYLE_BASE_URL y STYLE_VERSION (estilos), PMTILES_MAX_MB (verify)."

all: extract assets style site ## Genera todo: extracto, recursos, estilos y sitio

extract: ## Extrae la región a build/<región>.pmtiles (reporte en build/extract-report.txt)
	@scripts/extract.sh

assets: ## Glyphs y sprites autohospedados en build/assets (verificados por SHA-256)
	@scripts/assets.sh

# Dependencias de Node exactamente como dice package-lock.json: npm ci falla si
# el lock no coincide con package.json, en vez de reescribirlo como npm install.
# node_modules es un volumen de Docker (compose.yaml); npm ci vacía su
# contenido sin borrar el punto de montaje.
node_modules/.package-lock.json: package.json package-lock.json
	@npm ci --no-audit --no-fund --loglevel=error

style: node_modules/.package-lock.json ## Estilos MapLibre claro/oscuro ES/EN en build/style (STYLE_BASE_URL=…)
	@node scripts/style/build.ts

check: node_modules/.package-lock.json ## Tipos (tsc), pruebas de Node y licencias de vendor/ al día
	@npx tsc -p .
	@npm test --silent
	@node scripts/vendor-licenses.ts --check

verify: node_modules/.package-lock.json ## Valida estilos (MapLibre) y extracto (tipo, caja, zoom, capas, tamaño)
	@scripts/verify.sh

licenses: node_modules/.package-lock.json ## Regenera licenses/vendor-deps.txt (tras actualizar MapLibre o PMTiles)
	@node scripts/vendor-licenses.ts

site: node_modules/.package-lock.json ## Arma build/site para publicar: demo, PMTiles, recursos y estilos
	@scripts/site.sh

# Necesita el puerto publicado: docker compose run --rm --service-ports tools make serve
serve: node_modules/.package-lock.json ## Sirve build/site en http://localhost:8080 (con rangos HTTP, como Pages)
	@SITE_DIR=$(BUILD_DIR)/site node scripts/serve.ts

clean: ## Borra build/, incluido el caché de descargas de make assets
	rm -rf $(BUILD_DIR)
