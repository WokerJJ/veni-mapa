#!/usr/bin/env bash
# Pruebas de scripts/release.sh sin red: un BUILD_DIR armado a mano con un
# extracto, estilos y recursos mínimos, como los deja make all.
set -uo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

export BUILD_DIR="$tmp/build" DIST_DIR="$tmp/dist" REGION_NAME=prueba RELEASE_VERSION=0.1.0
base=https://tiles.example.com/v0.1.0

# Estado válido; cada caso cambia una sola cosa.
reset() {
  rm -rf "$BUILD_DIR" "$DIST_DIR"
  mkdir -p "$BUILD_DIR/style" "$BUILD_DIR/assets/fonts/Figtree Regular" "$BUILD_DIR/assets/sprites" "$BUILD_DIR/assets/licenses" "$BUILD_DIR/routing"
  printf 'tiles' >"$BUILD_DIR/prueba.pmtiles"
  echo '{"format":"veni-rutas","version":1}' >"$BUILD_DIR/routing/prueba-rutas.json"
  jq -n '{region: "prueba", osm_date: "20260928", source: "https://download.geofabrik.de/south-america/colombia-260928.osm.pbf", source_md5: "0123456789abcdef0123456789abcdef"}' \
    >"$BUILD_DIR/routing/source.json"
  jq -n --arg sha "$(sha256sum "$BUILD_DIR/prueba.pmtiles" | cut -d' ' -f1)" \
    '{region: "prueba", protomaps_build: "20260929", bbox: [-76.3, 4.3, -76, 4.55],
      requested_maxzoom: 16, source_maxzoom: 15, bytes: 5, sha256: $sha}' >"$BUILD_DIR/build.json"
  for variant in claro oscuro; do
    for lang in es en; do
      jq -n --arg v "$variant" --arg l "$lang" --arg base "$base" \
        '{version: 8, metadata: {"veni:version": "0.1.0", "veni:variant": $v, "veni:lang": $l,
          "veni:base_url": $base, "veni:protomaps_build": "20260929"}, sources: {}, layers: []}' \
        >"$BUILD_DIR/style/veni-$variant-$lang.json"
    done
  done
  printf 'glyphs' >"$BUILD_DIR/assets/fonts/Figtree Regular/0-255.pbf"
  echo '{}' >"$BUILD_DIR/assets/sprites/light.json"
  printf 'png' >"$BUILD_DIR/assets/sprites/light.png"
  echo 'OFL' >"$BUILD_DIR/assets/licenses/Figtree-OFL.txt"
  echo '{"glyphs_sha256": "x"}' >"$BUILD_DIR/assets/assets.json"
}

edit() {
  jq "$2" "$1" >"$tmp/editado" && mv "$tmp/editado" "$1"
}

expect_problem() {
  local description="$1" message="$2" out
  if out="$(scripts/release.sh 2>&1)"; then
    fail "$description: debía fallar"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$message' y salió: $out"
  fi
}

# --- Release válida ------------------------------------------------------------

reset
if out="$(scripts/release.sh 2>&1)"; then pass "release válida"; else fail "release válida: $out"; fi

expected=(SHA256SUMS assets.tar.gz manifest.json prueba-rutas.json prueba.pmtiles veni-claro-en.json veni-claro-es.json veni-oscuro-en.json veni-oscuro-es.json)
actual=()
while IFS= read -r f; do actual+=("$f"); done < <(ls "$DIST_DIR" | LC_ALL=C sort)
[[ "${actual[*]}" == "${expected[*]}" ]] && pass "dist/ tiene exactamente los 9 archivos" || fail "dist/ tiene: ${actual[*]}"

(cd "$DIST_DIR" && sha256sum -c --quiet SHA256SUMS) >/dev/null 2>&1 && pass "SHA256SUMS verifica" || fail "SHA256SUMS no verifica"
[[ "$(wc -l <"$DIST_DIR/SHA256SUMS")" == 8 ]] && pass "SHA256SUMS cubre los otros 8 archivos" || fail "SHA256SUMS: $(cat "$DIST_DIR/SHA256SUMS")"

jq -e --arg base "$base" '
  .version == "0.1.0" and .region == "prueba" and .protomaps_build == "20260929"
  and .bbox == [-76.3, 4.3, -76, 4.55] and .maxzoom == 15 and .style_base_url == $base
  and .pmtiles == "prueba.pmtiles" and (.styles | length) == 4 and (.styles | all(startswith("veni-")))
  and .routing == {file: "prueba-rutas.json", osm_date: "20260928", source: "https://download.geofabrik.de/south-america/colombia-260928.osm.pbf", source_md5: "0123456789abcdef0123456789abcdef"}
  and .data_license == "ODbL-1.0" and .attribution == "© colaboradores de OpenStreetMap"
  and (.files | length) == 7' "$DIST_DIR/manifest.json" >/dev/null \
  && pass "manifest.json con versión, build, bbox, zoom, base y rutas" || fail "manifest.json: $(cat "$DIST_DIR/manifest.json")"

# Cada archivo del manifest coincide con el de dist/.
ok=1
while IFS=$'\t' read -r name bytes sha; do
  [[ "$(stat -c %s "$DIST_DIR/$name")" == "$bytes" && "$(sha256sum "$DIST_DIR/$name" | cut -d' ' -f1)" == "$sha" ]] || ok=0
done < <(jq -r '.files[] | [.name, .bytes, .sha256] | @tsv' "$DIST_DIR/manifest.json")
((ok)) && pass "tamaños y SHA-256 del manifest coinciden" || fail "el manifest no coincide con dist/"

listing="$(tar -tzf "$DIST_DIR/assets.tar.gz" | LC_ALL=C sort | tr '\n' ' ')"
for entry in "assets.json" "fonts/Figtree Regular/0-255.pbf" "sprites/light.png" "licenses/Figtree-OFL.txt" \
  "licenses/protomaps-basemaps-BSD-3.txt" "licenses/THIRD_PARTY_NOTICES.md"; do
  [[ "$listing" == *"$entry "* ]] || { fail "assets.tar.gz sin $entry: $listing"; continue; }
done
[[ "$listing" != *"/work"* && "$listing" != *"$tmp"* ]] && pass "assets.tar.gz con rutas relativas y las licencias" || fail "rutas en assets.tar.gz: $listing"
[[ "$(tar -tvzf "$DIST_DIR/assets.tar.gz" | awk '{print $2}' | sort -u)" == "0/0" ]] && pass "assets.tar.gz sin dueños del host" || fail "dueños en assets.tar.gz"

# Reproducible: otra corrida, con otras fechas en los archivos, da el mismo tar.
first="$(sha256sum "$DIST_DIR/assets.tar.gz" | cut -d' ' -f1)"
touch -d '2001-01-01' "$BUILD_DIR/assets/assets.json"
sleep 1.1  # mtime de tar y de gzip tienen resolución de un segundo
scripts/release.sh >/dev/null 2>&1
[[ "$(sha256sum "$DIST_DIR/assets.tar.gz" | cut -d' ' -f1)" == "$first" ]] && pass "assets.tar.gz reproducible" || fail "assets.tar.gz cambió entre corridas"

# --- Versión -------------------------------------------------------------------

for version in v0.1.0 0.1 01.0.0 "0.1.0-rc.1" "0.1.0;rm"; do
  reset
  RELEASE_VERSION="$version" expect_problem "versión '$version'" "RELEASE_VERSION inválida"
done

# --- Piezas que no son de esta release -----------------------------------------

reset
edit "$BUILD_DIR/style/veni-oscuro-en.json" '.metadata["veni:version"] = "dev"'
expect_problem "estilo de otra versión" "no de '0.1.0'"

reset
edit "$BUILD_DIR/style/veni-claro-es.json" '.metadata["veni:protomaps_build"] = "20260101"'
expect_problem "estilo de otra build de Protomaps" "otra build de Protomaps"

reset
edit "$BUILD_DIR/style/veni-claro-en.json" '.metadata["veni:base_url"] = "http://localhost:8080"'
expect_problem "estilos con bases distintas" "bases distintas"

reset
printf 'otro' >"$BUILD_DIR/prueba.pmtiles"
expect_problem "extracto distinto al de build.json" "no coincide con el SHA-256"

reset
rm "$BUILD_DIR/style/veni-oscuro-es.json"
expect_problem "falta un estilo" "veni-oscuro-es.json"

reset
rm "$BUILD_DIR/routing/prueba-rutas.json"
expect_problem "falta el grafo de rutas" "corré make routing"

reset
rm -r "$BUILD_DIR/assets/sprites"
expect_problem "faltan los sprites" "corré make assets"

# Si falla, dist/ conserva la release anterior y no queda dist.tmp.
reset
scripts/release.sh >/dev/null 2>&1
before="$(cat "$DIST_DIR/SHA256SUMS")"
edit "$BUILD_DIR/style/veni-claro-es.json" '.metadata["veni:version"] = "dev"'
scripts/release.sh >/dev/null 2>&1
[[ "$(cat "$DIST_DIR/SHA256SUMS")" == "$before" && ! -e "$DIST_DIR.tmp" ]] \
  && pass "un fallo de validación deja dist/ intacto" || fail "un fallo de validación tocó dist/"

# Un fallo a mitad del empaquetado (ya con dist.tmp creado) tampoco toca dist/
# y el trap borra dist.tmp.
reset
scripts/release.sh >/dev/null 2>&1
before="$(cat "$DIST_DIR/SHA256SUMS")"
rm "$BUILD_DIR"/assets/licenses/*.txt
if scripts/release.sh >/dev/null 2>&1; then
  fail "sin licencias de recursos debía fallar"
elif [[ "$(cat "$DIST_DIR/SHA256SUMS")" == "$before" && ! -e "$DIST_DIR.tmp" ]]; then
  pass "un fallo al empaquetar deja dist/ intacto y borra dist.tmp"
else
  fail "un fallo al empaquetar tocó dist/ o dejó dist.tmp"
fi

echo
if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de release.sh pasaron"
