# Pipeline del mapa de Roldanillo.
#
# Se ejecuta dentro de la imagen de herramientas, sin instalar nada más:
#   docker compose run --rm tools make <objetivo>
# (En Linux o macOS con bash, curl, jq, yq v4, pmtiles y font-maker también corre directo.)

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

# Los valores de la región salen de config/region.yml. make regenera
# build/region.mk cuando cambia el YAML y lo vuelve a leer antes de seguir.
# help, clean y assets no lo necesitan: funcionan aunque el YAML esté roto.
NO_REGION_GOALS := help clean assets check
ifneq ($(filter-out $(NO_REGION_GOALS),$(or $(MAKECMDGOALS),$(.DEFAULT_GOAL))),)
include $(BUILD_DIR)/region.mk
endif

$(BUILD_DIR)/region.mk: config/region.yml scripts/region.sh
	@mkdir -p $(@D)
	@scripts/region.sh $< >$@.tmp || { rm -f $@.tmp; exit 1; }
	@mv $@.tmp $@

export REGION_NAME REGION_BBOX REGION_MAXZOOM REGION_CENTER REGION_ZOOM BUILD_DIR BUILD_DATE STYLE_BASE_URL STYLE_VERSION

.PHONY: help all extract style assets serve check clean

help: ## Muestra esta ayuda
	@echo "Uso: docker compose run --rm tools make <objetivo>"
	@echo
	@grep -hE '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'
	@echo
	@echo "Variables: make extract BUILD_DATE=AAAAMMDD fija la build de Protomaps (por defecto, la más reciente)."

all: extract assets style ## Genera todo: extracto, recursos y estilos

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

check: node_modules/.package-lock.json ## Tipos (tsc) y pruebas del generador de estilos
	@npx tsc -p .
	@npm test --silent

serve: ## Sirve la demo en local (issue #7)
	@echo "make serve: pendiente, llega con el issue #7" >&2; exit 1

clean: ## Borra build/, incluido el caché de descargas de make assets
	rm -rf $(BUILD_DIR)
