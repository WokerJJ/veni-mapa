#!/usr/bin/env bash
# Resuelve qué build diaria de Protomaps usar e imprime su fecha (AAAAMMDD).
#
#   scripts/protomaps-build.sh            → la build más reciente publicada
#   scripts/protomaps-build.sh 20260928   → verifica que esa build exista
#
# La lista sale de PROTOMAPS_BUILDS_URL (por defecto el índice oficial). Acepta
# file:// para las pruebas sin red.
set -euo pipefail

builds_url="${PROTOMAPS_BUILDS_URL:-https://build-metadata.protomaps.dev/builds.json}"
requested="${1:-}"

fail() {
  echo "protomaps-build.sh: $*" >&2
  exit 1
}

if [[ -n "$requested" && ! "$requested" =~ ^[0-9]{8}$ ]]; then
  fail "la fecha debe tener el formato AAAAMMDD (recibido: '$requested')"
fi

builds="$(curl -fsSL --retry 3 --retry-delay 2 "$builds_url")" || fail "no se pudo leer la lista de builds de $builds_url"

# Solo claves con forma de build diaria; el índice puede traer otros archivos.
dates="$(jq -r '.[].key | select(test("^[0-9]{8}\\.pmtiles$")) | rtrimstr(".pmtiles")' <<<"$builds" | sort)" \
  || fail "la lista de builds de $builds_url no es JSON válido"
[[ -n "$dates" ]] || fail "la lista de builds de $builds_url está vacía"

if [[ -n "$requested" ]]; then
  grep -qx "$requested" <<<"$dates" || fail "no existe la build $requested (la más reciente es $(tail -n1 <<<"$dates"))"
  echo "$requested"
else
  tail -n1 <<<"$dates"
fi
