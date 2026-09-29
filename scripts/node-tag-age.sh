#!/usr/bin/env bash
# Avisa si la etiqueta de Node de la imagen de herramientas dejó de recibir parches.
#
#   scripts/node-tag-age.sh [Dockerfile]
#
# La imagen oficial de Node solo publica parches sobre las Alpine vigentes: cuando
# sale una Alpine nueva, node:<mayor>-alpine<vieja> se congela mientras
# node:<mayor>-alpine sigue recibiendo versiones. Si la etiqueta del Dockerfile
# lleva más de MAX_AGE_DAYS (30) sin push frente a la flotante, imprime un
# ::warning:: de GitHub Actions; si no, una línea informativa. Solo avisa: el
# cambio de Alpine se hace a mano ("Actualizar la imagen de herramientas" en el
# README).
#
# Lee las fechas de DOCKER_HUB_API (por defecto la API de Docker Hub). Acepta
# file:// para las pruebas sin red.
set -euo pipefail

dockerfile="${1:-docker/tools/Dockerfile}"
api="${DOCKER_HUB_API:-https://hub.docker.com/v2/namespaces/library/repositories}"
max_age_days="${MAX_AGE_DAYS:-30}"

fail() {
  echo "node-tag-age.sh: $*" >&2
  exit 1
}

[[ "$max_age_days" =~ ^[0-9]+$ ]] || fail "MAX_AGE_DAYS debe ser un entero (recibido: '$max_age_days')"
[[ -f "$dockerfile" ]] || fail "no existe $dockerfile"

arg() {
  sed -n "s/^ARG $1=//p" "$dockerfile" | head -n1
}

alpine="$(arg ALPINE_VERSION)"
node_major="$(arg NODE_MAJOR)"
[[ "$alpine" =~ ^[0-9]+\.[0-9]+$ ]] || fail "ALPINE_VERSION en $dockerfile debe ser X.Y (recibido: '$alpine')"
[[ "$node_major" =~ ^[0-9]+$ ]] || fail "NODE_MAJOR en $dockerfile debe ser un número (recibido: '$node_major')"

# Fecha del último push de node:<tag>, en segundos desde 1970.
pushed() {
  local url="$api/node/tags/$1" json date
  # --retry-all-errors: también reintenta cortes de conexión (SSL, error 56).
  json="$(curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors "$url")" || fail "no se pudo leer $url"
  date="$(jq -r '.tag_last_pushed // empty' <<<"$json" 2>/dev/null)" || fail "$url no es JSON válido"
  [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || fail "$url no trae tag_last_pushed"
  date -u -d "$date" +%s 2>/dev/null || fail "fecha inválida en $url: '$date'"
}

day() {
  date -u -d "@$1" +%F
}

pinned_tag="$node_major-alpine$alpine"
floating_tag="$node_major-alpine"
pinned="$(pushed "$pinned_tag")"
floating="$(pushed "$floating_tag")"
age_days=$(((floating - pinned) / 86400))

if ((age_days > max_age_days)); then
  echo "::warning title=Imagen de herramientas::node:$pinned_tag no recibe parches desde $(day "$pinned") (node:$floating_tag: $(day "$floating"), $age_days días después). Subí ALPINE_VERSION en $dockerfile: ver \"Actualizar la imagen de herramientas\" en el README."
else
  echo "node:$pinned_tag al día (último push $(day "$pinned"); node:$floating_tag $(day "$floating"))"
fi
