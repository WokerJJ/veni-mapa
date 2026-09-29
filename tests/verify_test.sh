#!/usr/bin/env bash
# Pruebas de scripts/verify.sh sin red: un `pmtiles` falso devuelve encabezados
# y capas controlados; los estilos pasan por el validador real de MapLibre
# (node_modules). Con VERIFY_TEST_REQUIRE_DEPS=1 (CI) que falte es un fallo.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

if [[ ! -x node_modules/.bin/gl-style-validate ]]; then
  if [[ "${VERIFY_TEST_REQUIRE_DEPS:-}" == 1 ]]; then
    echo "FAIL - falta gl-style-validate (npm ci) y VERIFY_TEST_REQUIRE_DEPS=1"
    exit 1
  fi
  echo "skip - falta gl-style-validate (npm ci)"
  exit 0
fi

# pmtiles falso: responde con lo que haya en $FAKE_HEADER y $FAKE_METADATA.
mkdir -p "$tmp/bin"
cat >"$tmp/bin/pmtiles" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" --header-json "*) cat "$FAKE_HEADER" ;;
  *" --metadata "*) cat "$FAKE_METADATA" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/pmtiles"
export PATH="$tmp/bin:$PATH" FAKE_HEADER="$tmp/header.json" FAKE_METADATA="$tmp/metadata.json"
export BUILD_DIR="$tmp/build" REGION_NAME=prueba REGION_BBOX=-76.30,4.30,-76.00,4.55 REGION_MAXZOOM=16 PMTILES_MAX_MB=50

valid_style='{"version": 8, "sources": {}, "layers": []}'
layers='["boundaries","buildings","earth","landcover","landuse","places","pois","roads","water"]'

# Estado válido; cada caso cambia una sola cosa.
reset() {
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR/style"
  for variant in claro oscuro; do
    for lang in es en; do echo "$valid_style" >"$BUILD_DIR/style/veni-$variant-$lang.json"; done
  done
  printf 'tiles' >"$BUILD_DIR/prueba.pmtiles"
  echo '{"source_maxzoom": 15}' >"$BUILD_DIR/build.json"
  echo '{"tile_type": "mvt", "maxzoom": 15, "bounds": [-76.3, 4.3, -76, 4.55]}' >"$FAKE_HEADER"
  jq -n --argjson ids "$layers" '{vector_layers: ($ids | map({id: .}))}' >"$FAKE_METADATA"
}

expect_ok() {
  local out
  if out="$(scripts/verify.sh 2>&1)"; then pass "$1"; else fail "$1: $out"; fi
}

expect_problem() {
  local description="$1" message="$2" out
  if out="$(scripts/verify.sh 2>&1)"; then
    fail "$description: debía fallar"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

reset
expect_ok "un extracto y estilos válidos pasan"

reset
echo '{"version": 7, "layers": "no"}' >"$BUILD_DIR/style/veni-oscuro-en.json"
expect_problem "estilo inválido según MapLibre" "veni-oscuro-en.json no es válido"

reset
rm "$BUILD_DIR/style/veni-claro-en.json"
expect_problem "falta un estilo" "falta $BUILD_DIR/style/veni-claro-en.json"

reset
jq '.tile_type = "png"' "$FAKE_HEADER" >"$tmp/h" && mv "$tmp/h" "$FAKE_HEADER"
expect_problem "tiles raster" "se esperaba mvt"

reset
jq '.maxzoom = 14' "$FAKE_HEADER" >"$tmp/h" && mv "$tmp/h" "$FAKE_HEADER"
expect_problem "zoom máximo menor al esperado" "se esperaba 15 = mín(pedido 16, build 15)"

reset
REGION_MAXZOOM=12 expect_problem "el pedido manda si es menor que la build" "se esperaba 12 = mín(pedido 12, build 15)"

reset
echo '{}' >"$BUILD_DIR/build.json"
expect_problem "build.json sin source_maxzoom" "no registra source_maxzoom"

reset
jq '.bounds = [-77, 4.3, -76, 4.55]' "$FAKE_HEADER" >"$tmp/h" && mv "$tmp/h" "$FAKE_HEADER"
expect_problem "caja fuera de la región" "fuera de la región"

reset
jq -n '{vector_layers: [{id: "earth"}, {id: "water"}]}' >"$FAKE_METADATA"
expect_problem "faltan capas" "faltan capas: roads places landuse buildings pois"

reset
PMTILES_MAX_MB=0 expect_problem "tamaño sobre el límite" "supera el límite de 0 MB"

reset
out="$(PMTILES_MAX_MB=mucho scripts/verify.sh 2>&1)" && fail "límite no numérico debía fallar" \
  || { [[ "$out" == *"PMTILES_MAX_MB debe ser un entero"* ]] && pass "límite no numérico" || fail "límite no numérico: $out"; }

# Reporta todos los problemas, no solo el primero.
reset
jq '.maxzoom = 14 | .tile_type = "png"' "$FAKE_HEADER" >"$tmp/h" && mv "$tmp/h" "$FAKE_HEADER"
out="$(scripts/verify.sh 2>&1)"
[[ "$out" == *"2 problema(s)"* ]] && pass "reporta todos los problemas" || fail "no reportó los dos problemas: $out"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de verify.sh pasaron"
