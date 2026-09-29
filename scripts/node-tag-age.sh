#!/usr/bin/env bash
# Avisa si la etiqueta de Node de la imagen de herramientas dejó de recibir parches.
#
#   scripts/node-tag-age.sh [Dockerfile]
#
# La imagen oficial de Node solo publica parches sobre las Alpine vigentes: cuando
# sale una Alpine nueva, node:<mayor>-alpine<vieja> se congela mientras
# node:<mayor>-alpine sigue recibiendo versiones. Dos avisos (::warning:: de
# GitHub Actions, también en el resumen de la corrida):
#
#   - la etiqueta del Dockerfile lleva más de MAX_AGE_DAYS (30) sin push frente a
#     la flotante: hay que subir ALPINE_VERSION;
#   - la flotante lleva más de MAX_FLOATING_AGE_DAYS (90) sin push: la mayor de
#     Node quedó sin soporte y hay que subir NODE_MAJOR.
#
# Si no puede comprobarlo (red, API, Dockerfile) también avisa, y sale con 1.
# Solo avisa: el cambio se hace a mano ("Actualizar la imagen de herramientas"
# en el README).
#
# Lee las fechas de DOCKER_HUB_API (por defecto la API de Docker Hub). Acepta
# file:// para las pruebas sin red, y NOW (segundos desde 1970) fija "ahora".
set -euo pipefail

dockerfile="${1:-docker/tools/Dockerfile}"
api="${DOCKER_HUB_API:-https://hub.docker.com/v2/namespaces/library/repositories}"
max_age_days="${MAX_AGE_DAYS:-30}"
max_floating_age_days="${MAX_FLOATING_AGE_DAYS:-90}"
title="Imagen de herramientas"

# El aviso va a la corrida y a su resumen, si existe.
warn() {
  echo "::warning title=$title::$*"
  [[ -z "${GITHUB_STEP_SUMMARY:-}" ]] || echo "> **$title:** $*" >>"$GITHUB_STEP_SUMMARY"
}

# Un fallo también avisa: "sin aviso" no puede significar "no se comprobó".
# Por stderr, porque pushed() corre dentro de $(…).
fail() {
  warn "No se pudo comprobar la etiqueta de Node: node-tag-age.sh: $*" >&2
  exit 1
}

# Sin ceros a la izquierda: bash leería 08 y 010 como octal.
for var in MAX_AGE_DAYS:"$max_age_days" MAX_FLOATING_AGE_DAYS:"$max_floating_age_days"; do
  [[ "${var#*:}" =~ ^(0|[1-9][0-9]{0,4})$ ]] || fail "${var%%:*} debe ser un entero de 0 a 99999 días (recibido: '${var#*:}')"
done
now="${NOW:-$(date -u +%s)}"
[[ "$now" =~ ^[1-9][0-9]*$ ]] || fail "NOW debe ser segundos desde 1970 (recibido: '$now')"
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
  # ISO 8601 exacto: date -d también interpretaría "… +400 days".
  [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] \
    || fail "$url no trae tag_last_pushed en formato AAAA-MM-DDThh:mm:ssZ"
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
floating_age_days=$(((now - floating) / 86400))
fresh=1

if ((age_days > max_age_days)); then
  warn "node:$pinned_tag no recibe parches desde $(day "$pinned") (node:$floating_tag: $(day "$floating"), $age_days días después). Subí ALPINE_VERSION en $dockerfile: ver \"Actualizar la imagen de herramientas\" en el README."
  fresh=0
fi
if ((floating_age_days > max_floating_age_days)); then
  warn "node:$floating_tag no recibe push desde $(day "$floating") ($floating_age_days días): Node $node_major puede estar sin soporte. Subí NODE_MAJOR en $dockerfile: ver \"Actualizar la imagen de herramientas\" en el README."
  fresh=0
fi
if ((fresh)); then
  echo "node:$pinned_tag al día (último push $(day "$pinned"); node:$floating_tag $(day "$floating"))"
fi
