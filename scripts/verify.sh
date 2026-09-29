#!/usr/bin/env bash
# `make verify`: comprueba que lo generado sea un mapa válido antes de publicarlo.
#
#   Estilos   los cuatro pasan el validador oficial de MapLibre (gl-style-validate)
#   PMTiles   tiles vectoriales (mvt), caja igual a la de la región, zoom máximo
#             igual a mín(REGION_MAXZOOM, zoom de la build), las capas que usan
#             los estilos, y build.json que corresponde a este archivo
#   Tamaño    el extracto no pasa de PMTILES_MAX_MB
#
# Lee REGION_NAME, REGION_BBOX, REGION_MAXZOOM (config/region.yml, vía make),
# BUILD_DIR y PMTILES_MAX_MB. Reporta todos los problemas y falla al final.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME (usá make verify)}" "${REGION_BBOX:?falta REGION_BBOX}" "${REGION_MAXZOOM:?falta REGION_MAXZOOM}"
build_dir="${BUILD_DIR:-build}"
max_mb="${PMTILES_MAX_MB:-50}"
validator="${GL_STYLE_VALIDATE:-node_modules/.bin/gl-style-validate}"

problems=0
ok() { echo "ok   - $1"; }
problem() {
  echo "FAIL - $1" >&2
  problems=$((problems + 1))
}

# Solo enteros decimales sin ceros a la izquierda: bash lee 010 como octal y 08
# rompe la aritmética (y el bloque que la contiene se saltaría en silencio).
[[ "$max_mb" =~ ^(0|[1-9][0-9]{0,5})$ ]] \
  || { echo "verify.sh: PMTILES_MAX_MB debe ser un entero sin ceros a la izquierda (recibido: '$max_mb')" >&2; exit 1; }
[[ -x "$validator" ]] || { echo "verify.sh: falta $validator (npm ci)" >&2; exit 1; }

# --- Estilos ----------------------------------------------------------------------

styles=()
for variant in claro oscuro; do
  for lang in es en; do
    style="$build_dir/style/veni-$variant-$lang.json"
    if [[ ! -f "$style" ]]; then
      problem "falta $style (make style)"
      continue
    fi
    styles+=("$style")
    if output="$("$validator" "$style" 2>&1)"; then
      ok "$style es válido según la especificación de MapLibre"
    else
      problem "$style no es válido: $output"
    fi
  done
done

# Capas del PMTiles que piden los estilos: la lista sale de los propios estilos,
# así no se desincroniza cuando cambia @protomaps/basemaps.
required_layers=()
if ((${#styles[@]} > 0)); then
  mapfile -t required_layers < <(jq -r '[.layers[]?."source-layer" // empty] | .[]' "${styles[@]}" 2>/dev/null | sort -u)
fi

# --- PMTiles ----------------------------------------------------------------------

pmtiles="$build_dir/$REGION_NAME.pmtiles"
build_json="$build_dir/build.json"
if [[ ! -f "$pmtiles" || ! -f "$build_json" ]]; then
  problem "falta $pmtiles o $build_json (make extract)"
elif ! header="$(pmtiles show "$pmtiles" --header-json 2>&1)" || ! jq -e 'type == "object"' <<<"$header" >/dev/null 2>&1; then
  problem "no se pudo leer el encabezado de $pmtiles: $header"
elif ! metadata="$(pmtiles show "$pmtiles" --metadata 2>&1)" || ! jq -e 'type == "object"' <<<"$metadata" >/dev/null 2>&1; then
  problem "no se pudieron leer los metadatos de $pmtiles: $metadata"
else
  # build.json tiene que describir este archivo y no el de otra extracción.
  sha="$(sha256sum "$pmtiles" | cut -d' ' -f1)"
  [[ "$(jq -r '.sha256 // empty' "$build_json")" == "$sha" ]] \
    && ok "$build_json corresponde a $pmtiles" \
    || problem "$build_json no corresponde a $pmtiles (SHA-256 distinto): volvé a correr make extract"

  tile_type="$(jq -r '.tile_type' <<<"$header")"
  [[ "$tile_type" == mvt ]] && ok "tiles vectoriales (mvt)" || problem "tipo de tile '$tile_type', se esperaba mvt"

  source_maxzoom="$(jq -r '.source_maxzoom // empty' "$build_json")"
  maxzoom="$(jq -r '.maxzoom' <<<"$header")"
  if [[ ! "$source_maxzoom" =~ ^(0|[1-9][0-9]?)$ ]]; then
    problem "$build_json no registra un source_maxzoom entero (recibido: '$source_maxzoom'); volvé a correr make extract"
  else
    expected=$((REGION_MAXZOOM < source_maxzoom ? REGION_MAXZOOM : source_maxzoom))
    [[ "$maxzoom" == "$expected" ]] \
      && ok "zoom máximo $maxzoom = mín(pedido $REGION_MAXZOOM, build $source_maxzoom)" \
      || problem "zoom máximo $maxzoom, se esperaba $expected = mín(pedido $REGION_MAXZOOM, build $source_maxzoom)"
  fi

  # pmtiles extract --bbox deja como caja exactamente la pedida (con margen de
  # redondeo): ni más grande ni un pedazo de la región.
  if jq -e --arg bbox "$REGION_BBOX" '
      ($bbox | split(",") | map(tonumber)) as $r | (.bounds // []) as $b | 1e-6 as $e
      | ($b | length) == 4 and ([range(4)] | all(. as $i | (($b[$i] - $r[$i]) | fabs) <= $e))' \
      <<<"$header" >/dev/null; then
    ok "caja $(jq -c '.bounds' <<<"$header") igual a la región"
  else
    problem "caja $(jq -c '.bounds' <<<"$header") distinta de la región $REGION_BBOX"
  fi

  layers="$(jq -r '[.vector_layers[]?.id] | join(" ")' <<<"$metadata")"
  if ((${#required_layers[@]} == 0)); then
    problem "los estilos no piden ninguna capa: no hay contra qué comparar el extracto"
  else
    missing=()
    for layer in "${required_layers[@]}"; do
      [[ " $layers " == *" $layer "* ]] || missing+=("$layer")
    done
    ((${#missing[@]} == 0)) \
      && ok "el extracto trae las ${#required_layers[@]} capas que piden los estilos ($layers)" \
      || problem "faltan capas que piden los estilos: ${missing[*]} (hay: ${layers:-ninguna})"
  fi

  bytes="$(stat -c %s "$pmtiles")"
  limit=$((max_mb * 1024 * 1024))
  ((bytes <= limit)) && ok "tamaño $bytes bytes (límite $max_mb MB)" || problem "tamaño $bytes bytes supera el límite de $max_mb MB"
fi

if ((problems > 0)); then
  echo "verify.sh: $problems problema(s)" >&2
  exit 1
fi
echo "==> Listo: estilos y extracto verificados"
