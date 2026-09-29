#!/usr/bin/env bash
# Pruebas de scripts/protomaps-build.sh con un índice de builds local (sin red).
set -uo pipefail
cd "$(dirname "$0")/.."

export PROTOMAPS_BUILDS_URL="file://$PWD/tests/fixtures/builds.json"
failures=0

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; failures=$((failures + 1)); }

expect_output() {
  local description="$1" expected="$2" out
  shift 2
  if out="$(scripts/protomaps-build.sh "$@" 2>&1)" && [[ "$out" == "$expected" ]]; then
    pass "$description"
  else
    fail "$description: se esperaba '$expected' y salió '$out'"
  fi
}

expect_error() {
  local description="$1" message="$2" out
  shift 2
  if out="$(scripts/protomaps-build.sh "$@" 2>&1)"; then
    fail "$description: debía fallar y salió '$out'"
  elif [[ "$out" == *"$message"* ]]; then
    pass "$description"
  else
    fail "$description: falló con otro mensaje: $out"
  fi
}

# El fixture trae claves que no son builds diarias y que, al ordenar, quedan
# después de la real (20261231-test, planet-latest): sin el filtro, la "más
# reciente" sería una de ellas.
expect_output "sin fecha elige la build diaria más reciente e ignora otras claves" 20260928
expect_output "con fecha existente la devuelve" 20260926 20260926
expect_error "fecha que no existe" "no existe la build 20250101" 20250101
expect_error "una clave no diaria no se acepta como build" "no existe la build 20261231" 20261231
expect_error "fecha con formato inválido" "formato AAAAMMDD" 2026-09-28
expect_error "fecha con espacios" "formato AAAAMMDD" " 20260928"

PROTOMAPS_BUILDS_URL="file://$PWD/tests/fixtures/no-existe.json" \
  expect_error "índice inaccesible" "no se pudo leer la lista de builds"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo '[]' >"$tmp/vacio.json"
echo 'esto no es JSON' >"$tmp/roto.json"
PROTOMAPS_BUILDS_URL="file://$tmp/vacio.json" expect_error "índice vacío" "está vacía"
PROTOMAPS_BUILDS_URL="file://$tmp/roto.json" expect_error "índice que no es JSON" "no es JSON válido"

if ((failures > 0)); then
  echo "$failures prueba(s) fallaron"
  exit 1
fi
echo "Todas las pruebas de protomaps-build.sh pasaron"
