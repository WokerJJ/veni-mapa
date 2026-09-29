#!/usr/bin/env bash
# `make verify`: comprueba que lo generado sea un mapa válido antes de publicarlo.
#
#   Estilos   los cuatro pasan el validador oficial de MapLibre (gl-style-validate)
#   PMTiles   tiles vectoriales (mvt), caja dentro de la región, zoom máximo igual a
#             mín(REGION_MAXZOOM, zoom máximo de la build) y capas esperadas
#   Tamaño    el extracto no pasa de PMTILES_MAX_MB
#
# Lee REGION_NAME, REGION_BBOX, REGION_MAXZOOM (config/region.yml, vía make),
# BUILD_DIR y PMTILES_MAX_MB. Reporta todos los problemas y falla al final.
set -euo pipefail

: "${REGION_NAME:?falta REGION_NAME (usá make verify)}" "${REGION_BBOX:?falta REGION_BBOX}" "${REGION_MAXZOOM:?falta REGION_MAXZOOM}"
build_dir="${BUILD_DIR:-build}"
max_mb="${PMTILES_MAX_MB:-50}"
validator="${GL_STYLE_VALIDATE:-node_modules/.bin/gl-style-validate}"

# Capas de Protomaps que usan los estilos Vení; si una build las cambia, el
# estilo quedaría sin calles, agua o lugares sin que nada falle.
required_layers=(earth water roads places landuse buildings pois)

problems=0
ok() { echo "ok   - $1"; }
problem() {
  echo "FAIL - $1" >&2
  problems=$((problems + 1))
}

[[ "$max_mb" =~ ^[0-9]+$ ]] || { echo "verify.sh: PMTILES_MAX_MB debe ser un entero (recibido: '$max_mb')" >&2; exit 1; }
[[ -x "$validator" ]] || { echo "verify.sh: falta $validator (npm ci)" >&2; exit 1; }

# --- Estilos ----------------------------------------------------------------------

for variant in claro oscuro; do
  for lang in es en; do
    style="$build_dir/style/veni-$variant-$lang.json"
    if [[ ! -f "$style" ]]; then
      problem "falta $style (make style)"
    elif output="$("$validator" "$style" 2>&1)"; then
      ok "$style es válido según la especificación de MapLibre"
    else
      problem "$style no es válido: $output"
    fi
  done
done

# --- PMTiles ----------------------------------------------------------------------

pmtiles="$build_dir/$REGION_NAME.pmtiles"
build_json="$build_dir/build.json"
if [[ ! -f "$pmtiles" || ! -f "$build_json" ]]; then
  problem "falta $pmtiles o $build_json (make extract)"
else
  header="$(pmtiles show "$pmtiles" --header-json)"
  metadata="$(pmtiles show "$pmtiles" --metadata)"

  tile_type="$(jq -r '.tile_type' <<<"$header")"
  [[ "$tile_type" == mvt ]] && ok "tiles vectoriales (mvt)" || problem "tipo de tile '$tile_type', se esperaba mvt"

  source_maxzoom="$(jq -r '.source_maxzoom // empty' "$build_json")"
  maxzoom="$(jq -r '.maxzoom' <<<"$header")"
  if [[ -z "$source_maxzoom" ]]; then
    problem "$build_json no registra source_maxzoom (volvé a correr make extract)"
  else
    expected=$((REGION_MAXZOOM < source_maxzoom ? REGION_MAXZOOM : source_maxzoom))
    [[ "$maxzoom" == "$expected" ]] \
      && ok "zoom máximo $maxzoom = mín(pedido $REGION_MAXZOOM, build $source_maxzoom)" \
      || problem "zoom máximo $maxzoom, se esperaba $expected = mín(pedido $REGION_MAXZOOM, build $source_maxzoom)"
  fi

  # La caja del extracto no puede salirse de la región (con margen de redondeo).
  if jq -e --arg bbox "$REGION_BBOX" '
      ($bbox | split(",") | map(tonumber)) as $r | .bounds as $b | 1e-6 as $e
      | $b[0] >= $r[0] - $e and $b[1] >= $r[1] - $e and $b[2] <= $r[2] + $e and $b[3] <= $r[3] + $e' \
      <<<"$header" >/dev/null; then
    ok "caja $(jq -c '.bounds' <<<"$header") dentro de la región"
  else
    problem "caja $(jq -c '.bounds' <<<"$header") fuera de la región $REGION_BBOX"
  fi

  layers="$(jq -r '[.vector_layers[].id] | join(" ")' <<<"$metadata")"
  missing=()
  for layer in "${required_layers[@]}"; do
    [[ " $layers " == *" $layer "* ]] || missing+=("$layer")
  done
  ((${#missing[@]} == 0)) && ok "capas esperadas presentes ($layers)" || problem "faltan capas: ${missing[*]} (hay: $layers)"

  bytes="$(stat -c %s "$pmtiles")"
  limit=$((max_mb * 1024 * 1024))
  ((bytes <= limit)) && ok "tamaño $bytes bytes (límite $max_mb MB)" || problem "tamaño $bytes bytes supera el límite de $max_mb MB"
fi

if ((problems > 0)); then
  echo "verify.sh: $problems problema(s)" >&2
  exit 1
fi
echo "==> Listo: estilos y extracto verificados"
