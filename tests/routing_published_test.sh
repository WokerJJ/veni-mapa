#!/usr/bin/env bash
# Pruebas de scripts/routing-published.sh: el grafo de una release publicada se
# reutiliza tal cual (mismo SHA-256) al volver a adjuntarla.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

export BUILD_DIR="$tmp/build"
manifest="$tmp/manifest.json"
dl="$tmp/descarga"

reset() {
  rm -rf "$BUILD_DIR" "$dl"
  mkdir -p "$dl"
  echo '{"format":"veni-rutas","version":1,"osm_date":"20260928"}' >"$dl/prueba-rutas.json"
  jq -n --arg sha "$(sha256sum "$dl/prueba-rutas.json" | cut -d' ' -f1)" '{
    version: "0.2.0", region: "prueba", bbox: [-76.3, 4.3, -76, 4.55],
    routing: {file: "prueba-rutas.json", osm_date: "20260928",
      source: "https://download.geofabrik.de/south-america/colombia-260928.osm.pbf",
      source_md5: "0123456789abcdef0123456789abcdef"},
    files: [{name: "prueba.pmtiles", sha256: ("0" * 64)}, {name: "prueba-rutas.json", sha256: $sha}]}' >"$manifest"
}

edit() {
  jq "$2" "$1" >"$tmp/editado" && mv "$tmp/editado" "$1"
}

expect_error() {
  local description="$1" message="$2" out
  if out="$(scripts/routing-published.sh "$manifest" "$dl" 2>&1)"; then
    fail "$description: debía fallar y salió: $out"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

reset
if out="$(scripts/routing-published.sh "$manifest" "$dl" 2>&1)"; then
  cmp -s "$dl/prueba-rutas.json" "$BUILD_DIR/routing/prueba-rutas.json" \
    && pass "deja el grafo publicado, byte por byte" || fail "el grafo cambió"
  jq -e '. == {region: "prueba", osm_date: "20260928",
    source: "https://download.geofabrik.de/south-america/colombia-260928.osm.pbf",
    source_md5: "0123456789abcdef0123456789abcdef", bbox: [-76.3, 4.3, -76, 4.55]}' "$BUILD_DIR/routing/source.json" >/dev/null \
    && pass "source.json con la procedencia del manifest" || fail "source.json: $(cat "$BUILD_DIR/routing/source.json")"
else
  fail "el grafo publicado falló: $out"
fi

reset
echo 'alterado' >>"$dl/prueba-rutas.json"
expect_error "grafo descargado distinto del publicado" "no coincide con su SHA-256 del manifest"
[[ ! -e "$BUILD_DIR/routing/prueba-rutas.json" ]] && pass "un grafo alterado no queda en build/" || fail "quedó el grafo alterado"

reset
edit "$manifest" '.routing.file = "../../etc/passwd"'
expect_error "nombre de archivo con ruta" "nombre de grafo inválido"

reset
edit "$manifest" '.files |= map(select(.name != "prueba-rutas.json"))'
expect_error "manifest sin el SHA-256 del grafo" "no trae el SHA-256"

reset
rm "$dl/prueba-rutas.json"
expect_error "grafo sin descargar" "falta"

reset
edit "$manifest" 'del(.routing.source_md5)'
expect_error "manifest sin procedencia" "no trae la procedencia"

reset
edit "$manifest" 'del(.routing)'
scripts/routing-published.sh "$manifest" "$dl" >/dev/null 2>&1
[[ $? == 3 ]] && pass "versión publicada sin rutas: sale con 3" || fail "sin rutas no salió con 3"

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de routing-published.sh pasaron"
