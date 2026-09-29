# Pipeline del mapa de Roldanillo.
#
# Se ejecuta dentro de la imagen de herramientas, sin instalar nada más:
#   docker compose run --rm tools make <objetivo>
# (En Linux o macOS con bash, curl, jq, yq v4 y pmtiles también corre directo.)

SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-builtin-rules --warn-undefined-variables

BUILD_DIR := build
BUILD_DATE ?=

# Los valores de la región salen de config/region.yml. make regenera
# build/region.mk cuando cambia el YAML y lo vuelve a leer antes de seguir.
# help y clean no lo necesitan: así funcionan aunque el YAML esté roto.
NO_REGION_GOALS := help clean
ifneq ($(filter-out $(NO_REGION_GOALS),$(or $(MAKECMDGOALS),$(.DEFAULT_GOAL))),)
include $(BUILD_DIR)/region.mk
endif

$(BUILD_DIR)/region.mk: config/region.yml scripts/region.sh
	@mkdir -p $(@D)
	@scripts/region.sh $< >$@.tmp || { rm -f $@.tmp; exit 1; }
	@mv $@.tmp $@

export REGION_NAME REGION_BBOX REGION_MAXZOOM BUILD_DIR BUILD_DATE

.PHONY: help all extract style assets serve clean

help: ## Muestra esta ayuda
	@echo "Uso: docker compose run --rm tools make <objetivo>"
	@echo
	@grep -hE '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'
	@echo
	@echo "Variables: make extract BUILD_DATE=AAAAMMDD fija la build de Protomaps (por defecto, la más reciente)."

all: extract assets style ## Genera todo: extracto, recursos y estilos

extract: ## Extrae la región a build/<región>.pmtiles (reporte en build/extract-report.txt)
	@scripts/extract.sh

assets: ## Glyphs y sprites autohospedados (issue #4)
	@echo "make assets: pendiente, llega con el issue #4" >&2; exit 1

style: ## Estilos MapLibre claro/oscuro ES/EN (issue #5)
	@echo "make style: pendiente, llega con el issue #5" >&2; exit 1

serve: ## Sirve la demo en local (issue #7)
	@echo "make serve: pendiente, llega con el issue #7" >&2; exit 1

clean: ## Borra build/
	rm -rf $(BUILD_DIR)
