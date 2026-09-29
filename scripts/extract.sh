#!/usr/bin/env bash
# Extrae la región de la build diaria de Protomaps a un PMTiles local.
#
# Lo llama `make extract`, que exporta REGION_NAME, REGION_BBOX, REGION_MAXZOOM
# (desde config/region.yml), BUILD_DIR y, opcionalmente, BUILD_DATE.
#
# Salidas en BUILD_DIR:
#   <REGION_NAME>.pmtiles   el extracto
#   extract-report.txt      reporte del --dry-run (tamaño y peticiones)
#   build.json              de dónde salió el extracto, para releases y PR
#
# Las tres se preparan en una carpeta temporal y se publican juntas al final:
# si algo falla, BUILD_DIR conserva intacta la extracción anterior, sin mezclar
# el reporte de una build con el archivo de otra.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME}" "${REGION_BBOX:?falta REGION_BBOX}" "${REGION_MAXZOOM:?falta REGION_MAXZOOM}"
build_dir="${BUILD_DIR:-build}"

date="$(scripts/protomaps-build.sh "${BUILD_DATE:-}")"
source_url="${PROTOMAPS_BUILD_BASE:-https://build.protomaps.com}/${date}.pmtiles"

mkdir -p "$build_dir"
staging="$(mktemp -d "$build_dir/.extract.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

pmtiles_out="$staging/$REGION_NAME.pmtiles"
args=("$source_url" "$pmtiles_out" "--bbox=$REGION_BBOX" "--maxzoom=$REGION_MAXZOOM")

echo "==> Build de Protomaps: $date"
echo "==> Región: $REGION_NAME · bbox $REGION_BBOX · zoom máximo pedido $REGION_MAXZOOM"

# Primero el --dry-run: cuánto va a pesar y cuántas peticiones hará, sin escribir.
{
  echo "Fuente: $source_url"
  echo "Región: $REGION_NAME"
  echo "Bbox: $REGION_BBOX"
  echo "Zoom máximo pedido: $REGION_MAXZOOM"
  echo
  pmtiles extract "${args[@]}" --dry-run 2>&1
} | tee "$staging/extract-report.txt"

# El reporte ya quedó en el --dry-run; aquí se omite la barra de progreso.
pmtiles extract "${args[@]}" --quiet
[[ -s "$pmtiles_out" ]] || { echo "extract.sh: pmtiles no generó $pmtiles_out" >&2; exit 1; }

bytes="$(stat -c %s "$pmtiles_out")"
# Zoom máximo de la build de origen: make verify comprueba que el extracto llegue
# a mín(REGION_MAXZOOM, este valor).
source_maxzoom="$(pmtiles show "$source_url" --header-json | jq -e '.maxzoom')" \
  || { echo "extract.sh: no se pudo leer el encabezado de $source_url" >&2; exit 1; }
jq -n \
  --arg region "$REGION_NAME" \
  --arg build_date "$date" \
  --arg source "$source_url" \
  --arg bbox "$REGION_BBOX" \
  --argjson maxzoom "$REGION_MAXZOOM" \
  --argjson bytes "$bytes" \
  --argjson source_maxzoom "$source_maxzoom" \
  --arg sha256 "$(sha256sum "$pmtiles_out" | cut -d' ' -f1)" \
  --arg pmtiles "$(pmtiles version 2>&1 | head -n1)" \
  --arg jq "$(jq --version 2>&1)" \
  --arg yq "$(yq --version 2>&1)" \
  '{region: $region, protomaps_build: $build_date, source: $source,
    bbox: ($bbox | split(",") | map(tonumber)), requested_maxzoom: $maxzoom, source_maxzoom: $source_maxzoom,
    bytes: $bytes, sha256: $sha256,
    tools: {pmtiles: $pmtiles, jq: $jq, yq: $yq}}' >"$staging/build.json"

# Publicación: los metadatos primero y el .pmtiles al final, así un lector que
# vea el archivo nuevo ya encuentra su build.json.
mv "$staging/extract-report.txt" "$build_dir/extract-report.txt"
mv "$staging/build.json" "$build_dir/build.json"
mv "$pmtiles_out" "$build_dir/$REGION_NAME.pmtiles"

echo "==> Listo: $build_dir/$REGION_NAME.pmtiles ($bytes bytes)"
