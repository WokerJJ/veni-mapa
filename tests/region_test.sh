#!/usr/bin/env bash
# Pruebas de scripts/region.sh: la configuración real y casos inválidos.
set -uo pipefail
cd "$(dirname "$0")/.."

fixtures=tests/fixtures
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

expect_ok() {
  local file="$1" out
  if out="$(scripts/region.sh "$file" 2>&1)"; then pass "$file es válido"; else fail "$file debía ser válido: $out"; fi
}

expect_error() {
  local file="$1" message="$2" out
  if out="$(scripts/region.sh "$file" 2>&1)"; then
    fail "$file debía fallar"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$file falla con '$message'"
  else
    fail "$file falló con otro mensaje: $out"
  fi
}

expect_ok config/region.yml
expect_ok "$fixtures/region-valida.yml"

out="$(scripts/region.sh "$fixtures/region-valida.yml")"
[[ "$out" == *"REGION_BBOX := -76.30,4.30,-76.00,4.55"* ]] && pass "bbox en formato de pmtiles" || fail "bbox mal formateado: $out"
[[ "$out" == *"REGION_NAME := prueba"* ]] && pass "nombre exportado" || fail "nombre no exportado: $out"
[[ "$out" == *"REGION_MAXZOOM := 16"* ]] && pass "maxzoom exportado" || fail "maxzoom no exportado: $out"

expect_error "$fixtures/region-latitud-fuera.yml" "latitud del bbox"
expect_error "$fixtures/region-oeste-mayor.yml" "oeste debe ser menor que este"
expect_error "$fixtures/region-bbox-incompleto.yml" "bbox debe tener 4 números"
expect_error "$fixtures/region-centro-fuera.yml" "demo.center queda fuera del bbox"
expect_error "$fixtures/region-nombre-invalido.yml" "name debe ser minúsculas"
expect_error "$fixtures/region-zoom-alto.yml" "maxzoom debe ser un entero"
expect_error "$fixtures/no-existe.yml" "no existe"

if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de region.sh pasaron"
