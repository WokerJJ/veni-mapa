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

# pmtiles falso: responde con lo que haya en $FAKE_HEADER y $FAKE_METADATA, o
# falla como pmtiles ante un archivo corrupto (FAKE_FAIL=1).
mkdir -p "$tmp/bin"
cat >"$tmp/bin/pmtiles" <<'EOF'
#!/usr/bin/env bash
[[ -n "${FAKE_FAIL:-}" ]] && { echo "Failed to read archive, magic number not detected"; exit 1; }
case " $* " in
  *" --header-json "*) cat "$FAKE_HEADER" ;;
  *" --metadata "*) cat "$FAKE_METADATA" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/pmtiles"
export PATH="$tmp/bin:$PATH" FAKE_HEADER="$tmp/header.json" FAKE_METADATA="$tmp/metadata.json"
export BUILD_DIR="$tmp/build" REGION_NAME=prueba REGION_BBOX=-76.30,4.30,-76.00,4.55 REGION_MAXZOOM=16 PMTILES_MAX_MB=50
export REGION_CENTER=-76.149,4.4105 ROUTING_MAX_KB=500

# Grafo de rutas de la red de prueba (tests/fixtures/routing), sin la calle
# aislada: conectado desde el centro. make_graph <opl> lo arma en BUILD_DIR.
make_graph() {
  mkdir -p "$BUILD_DIR/routing"
  jq -n '{region: "prueba", osm_date: "20260928", source: "file:///colombia-260928.osm.pbf",
    source_md5: "0123456789abcdef0123456789abcdef", bbox: [-76.3, 4.3, -76, 4.55]}' >"$BUILD_DIR/routing/source.json"
  node scripts/routing/build.ts --opl "$1" --source "$BUILD_DIR/routing/source.json" \
    --out "$BUILD_DIR/routing/prueba-rutas.json" >/dev/null
}
grep -v '^w[79] ' tests/fixtures/routing/red.opl >"$tmp/red-conectada.opl"

# Estilo válido que pide dos capas del extracto.
valid_style='{"version": 8, "sources": {"p": {"type": "vector", "url": "pmtiles://x"}},
  "layers": [{"id": "calles", "type": "line", "source": "p", "source-layer": "roads"},
             {"id": "agua", "type": "fill", "source": "p", "source-layer": "water"}]}'
layers='["boundaries","buildings","earth","landcover","landuse","places","pois","roads","water"]'

# Estado válido; cada caso cambia una sola cosa.
reset() {
  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR/style"
  for variant in claro oscuro; do
    for lang in es en; do echo "$valid_style" >"$BUILD_DIR/style/veni-$variant-$lang.json"; done
  done
  printf 'tiles' >"$BUILD_DIR/prueba.pmtiles"
  jq -n --arg sha "$(sha256sum "$BUILD_DIR/prueba.pmtiles" | cut -d' ' -f1)" '{source_maxzoom: 15, sha256: $sha}' >"$BUILD_DIR/build.json"
  echo '{"tile_type": "mvt", "maxzoom": 15, "bounds": [-76.3, 4.3, -76, 4.55]}' >"$FAKE_HEADER"
  jq -n --argjson ids "$layers" '{vector_layers: ($ids | map({id: .}))}' >"$FAKE_METADATA"
  make_graph "$tmp/red-conectada.opl"
}

# Cambia un JSON con una expresión de jq.
edit() {
  jq "$2" "$1" >"$tmp/editado" && mv "$tmp/editado" "$1"
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
edit "$FAKE_HEADER" '.tile_type = "png"'
expect_problem "tiles raster" "se esperaba mvt"

reset
edit "$FAKE_HEADER" '.maxzoom = 14'
expect_problem "zoom máximo menor al esperado" "se esperaba 15 = mín(pedido 16, build 15)"

reset
REGION_MAXZOOM=12 expect_problem "el pedido manda si es menor que la build" "se esperaba 12 = mín(pedido 12, build 15)"

reset
edit "$BUILD_DIR/build.json" 'del(.source_maxzoom)'
expect_problem "build.json sin source_maxzoom" "no registra un source_maxzoom entero"

reset
edit "$BUILD_DIR/build.json" '.source_maxzoom = 15.5'
expect_problem "source_maxzoom no entero" "no registra un source_maxzoom entero (recibido: '15.5')"

reset
printf 'otra extraccion' >"$BUILD_DIR/prueba.pmtiles"
expect_problem "build.json de otra extracción" "no corresponde a"

reset
edit "$FAKE_HEADER" '.bounds = [-77, 4.3, -76, 4.55]'
expect_problem "caja más grande que la región" "distinta de la región"

reset
edit "$FAKE_HEADER" '.bounds = [-76.2, 4.35, -76.1, 4.45]'
expect_problem "caja que cubre solo un pedazo de la región" "distinta de la región"

reset
edit "$FAKE_HEADER" 'del(.bounds)'
expect_problem "encabezado sin caja" "distinta de la región"

reset
jq -n '{vector_layers: [{id: "earth"}, {id: "water"}]}' >"$FAKE_METADATA"
expect_problem "falta una capa que pide un estilo" "faltan capas que piden los estilos: roads"

reset
echo '{}' >"$FAKE_METADATA"
expect_problem "metadatos sin vector_layers" "faltan capas que piden los estilos: roads water (hay: ninguna)"

reset
FAKE_FAIL=1 expect_problem "PMTiles ilegible: el error de pmtiles se muestra" "magic number not detected"

reset
PMTILES_MAX_MB=0 expect_problem "tamaño sobre el límite" "supera el límite de 0 MB"

# Ceros a la izquierda: bash los lee en octal (010 = 8) o rompe (08) y el bloque
# de comprobaciones se saltaría en silencio.
for bad in mucho 08 010 9999999; do
  reset
  if out="$(PMTILES_MAX_MB=$bad scripts/verify.sh 2>&1)"; then
    fail "PMTILES_MAX_MB=$bad debía fallar"
  elif [[ "$out" == *"PMTILES_MAX_MB debe ser un entero"* ]]; then
    pass "PMTILES_MAX_MB=$bad se rechaza"
  else
    fail "PMTILES_MAX_MB=$bad: $out"
  fi
done

# --- Rutas ---------------------------------------------------------------------

reset
out="$(scripts/verify.sh 2>&1)"
[[ "$out" == *"rutas (foot): la red principal tiene 6 de 6 vértices"* && "$out" == *"rutas (car)"* ]] \
  && pass "verifica el grafo de rutas con los dos perfiles" || fail "sin verificación de rutas: $out"

reset
rm "$BUILD_DIR/routing/prueba-rutas.json"
expect_problem "falta el grafo de rutas" "make routing"

reset
make_graph tests/fixtures/routing/red.opl
expect_problem "red partida: las calles aisladas quedan fuera de la red principal" "la red principal tiene 6 de 10 vértices"

reset
edit "$BUILD_DIR/routing/source.json" '.osm_date = "20260101"'
expect_problem "grafo de otra fecha de OSM que source.json" "igual que source.json"

reset
edit "$BUILD_DIR/routing/prueba-rutas.json" '.region = "otra"'
expect_problem "grafo de otra región" "región 'otra'"

reset
ROUTING_MAX_KB=0 expect_problem "grafo más grande que ROUTING_MAX_KB" "límite 0 KB"

reset
REGION_CENTER=-75.5,4.41 expect_problem "centro lejos de toda vía" "FAIL - rutas (foot): el centro de la región está cerca de la red principal"

# Rutas conocidas de la región (tests/data/rutas-<región>.test.ts): se corren si existen.
known="$tmp/conocidas"
mkdir -p "$known"
reset
KNOWN_ROUTES_DIR="$known" expect_ok "sin rutas conocidas para la región, no se exigen"
cat >"$known/rutas-prueba.test.ts" <<'EOF2'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
it("el grafo del BUILD_DIR de verify.sh", () => {
  const g = JSON.parse(readFileSync(`${process.env.BUILD_DIR}/routing/prueba-rutas.json`, "utf8"));
  assert.equal(g.region, process.env.ESPERADA ?? "prueba");
});
EOF2
reset
out="$(KNOWN_ROUTES_DIR="$known" scripts/verify.sh 2>&1)" && [[ "$out" == *"ok   - rutas conocidas de prueba"* ]] \
  && pass "corre las rutas conocidas de la región con su BUILD_DIR" || fail "rutas conocidas: $out"
reset
KNOWN_ROUTES_DIR="$known" ESPERADA=otra expect_problem "una ruta conocida que falla detiene la verificación" "rutas conocidas de prueba: falló"

reset
edit "$BUILD_DIR/routing/prueba-rutas.json" '.bbox = [-76.3, 4.3, -76, 4.6]'
expect_problem "grafo de otra caja" "igual a la de la región"

reset
edit "$BUILD_DIR/routing/source.json" '.source_md5 = "ffffffffffffffffffffffffffffffff"'
expect_problem "grafo de otro archivo de OSM que source.json" "igual que source.json"

for bad in 08 abc; do
  reset
  ROUTING_MAX_KB="$bad" expect_problem "ROUTING_MAX_KB '$bad'" "ROUTING_MAX_KB debe ser un entero"
done

# Reporta todos los problemas, no solo el primero.
reset
edit "$FAKE_HEADER" '.maxzoom = 14 | .tile_type = "png"'
out="$(scripts/verify.sh 2>&1)"
[[ "$out" == *"2 problema(s)"* ]] && pass "reporta todos los problemas" || fail "no reportó los dos problemas: $out"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de verify.sh pasaron"
