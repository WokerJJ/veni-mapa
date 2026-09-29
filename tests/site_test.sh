#!/usr/bin/env bash
# Pruebas de scripts/site.sh sin red: un build/ falso con lo mínimo que el
# sitio necesita. Usa node_modules (maplibre-gl y pmtiles) y node: corré en la
# imagen de herramientas después de `make check` o `make style`. Con
# SITE_TEST_REQUIRE_DEPS=1 (CI) que falten es un fallo, no una omisión.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

if [[ ! -f node_modules/maplibre-gl/dist/maplibre-gl.mjs ]]; then
  if [[ "${SITE_TEST_REQUIRE_DEPS:-}" == 1 ]]; then
    echo "FAIL - faltan las dependencias de Node (npm ci) y SITE_TEST_REQUIRE_DEPS=1"
    exit 1
  fi
  echo "skip - faltan las dependencias de Node (npm ci)"
  exit 0
fi

export BUILD_DIR="$tmp/build" REGION_NAME=prueba
base="https://tiles.example.com/v1"

# build/ mínimo, con estilos que apuntan a $1.
make_build() {
  local styled_base="$1"
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR/assets/fonts/Figtree Regular" "$BUILD_DIR/assets/sprites" "$BUILD_DIR/assets/licenses" "$BUILD_DIR/style"
  printf 'tiles' >"$BUILD_DIR/prueba.pmtiles"
  echo '{"protomaps_build":"20260928"}' >"$BUILD_DIR/build.json"
  printf 'pbf' >"$BUILD_DIR/assets/fonts/Figtree Regular/0-255.pbf"
  echo '{}' >"$BUILD_DIR/assets/sprites/light.json"
  echo 'OFL' >"$BUILD_DIR/assets/licenses/Figtree-OFL.txt"
  echo '{}' >"$BUILD_DIR/assets/assets.json"
  for variant in claro oscuro; do
    for lang in es en; do
      jq -n --arg b "$styled_base" '{version: 8, metadata: {"veni:base_url": $b}, sources: {}, layers: []}' \
        >"$BUILD_DIR/style/veni-$variant-$lang.json"
    done
  done
}

run_site() { STYLE_BASE_URL="$1" scripts/site.sh 2>&1; }

expect_error() {
  local description="$1" url="$2" message="$3" out
  if out="$(run_site "$url")"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

snapshot() { (cd "$BUILD_DIR/site" && find . -type f -print0 | sort -z | xargs -0 sha256sum); }

# --- Sitio completo ------------------------------------------------------------

make_build "$base"
if out="$(run_site "$base")"; then
  pass "arma el sitio completo"
  site="$BUILD_DIR/site"
  missing=()
  for file in index.html demo.js demo.css \
    vendor/maplibre-gl.mjs vendor/maplibre-gl-shared.mjs vendor/maplibre-gl-worker.mjs vendor/maplibre-gl.css vendor/pmtiles.js \
    prueba.pmtiles build.json assets.json "fonts/Figtree Regular/0-255.pbf" sprites/light.json \
    style/veni-claro-es.json style/veni-claro-en.json style/veni-oscuro-es.json style/veni-oscuro-en.json \
    licenses/Figtree-OFL.txt licenses/maplibre-gl-BSD-3.txt licenses/pmtiles-BSD-3.txt licenses/vendor-deps.txt; do
    [[ -s "$site/$file" ]] || missing+=("$file")
  done
  ((${#missing[@]} == 0)) && pass "trae demo, vendor, datos, recursos, estilos y licencias" || fail "faltan: ${missing[*]}"
  [[ -z "$(find "$site" ! -perm -a+r)" ]] && pass "todo es legible por otros usuarios" || fail "hay archivos no legibles"
  [[ ! -e "$BUILD_DIR/site.tmp" && ! -e "$BUILD_DIR/site.old" ]] && pass "no deja temporales" || fail "quedaron temporales"
else
  fail "el sitio completo falló: $out"
fi

# La misma base escrita de otra forma: make style la normaliza igual.
if out="$(run_site "https://Tiles.Example.com/v1//")"; then
  pass "acepta la misma base con mayúsculas y barras finales"
else
  fail "la misma base escrita distinto falló: $out"
fi

# --- Fallos: el sitio anterior queda intacto y sin temporales -------------------

before="$(snapshot)"

expect_error "base distinta de la de los estilos" "http://localhost:8080" "corré make style con la misma STYLE_BASE_URL"
expect_error "base inválida" "ftp://x" "STYLE_BASE_URL inválida"

rm "$BUILD_DIR/style/veni-oscuro-en.json"
expect_error "falta un estilo" "$base" "veni-oscuro-en.json"

jq -n --arg b "$base" '{version: 8, metadata: {"veni:base_url": $b}, sources: {}, layers: []}' >"$BUILD_DIR/style/veni-oscuro-en.json"
mv "$BUILD_DIR/build.json" "$BUILD_DIR/build.json.bak"
expect_error "falta build.json" "$base" "build.json"
mv "$BUILD_DIR/build.json.bak" "$BUILD_DIR/build.json"

[[ "$before" == "$(snapshot)" ]] && pass "los fallos no tocan el sitio anterior" || fail "un fallo cambió el sitio anterior"
[[ ! -e "$BUILD_DIR/site.tmp" ]] && pass "los fallos no dejan site.tmp" || fail "quedó site.tmp"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de site.sh pasaron"
