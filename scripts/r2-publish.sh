#!/usr/bin/env bash
# Publica una release en Cloudflare R2: <bucket>/vX.Y.Z/ y el alias <bucket>/latest/.
#
#   scripts/r2-publish.sh <dist>      (dist = lo que arma make release)
#
# Lo llama release.yml después de adjuntar los artefactos. Queda desactivado
# hasta que existan los cuatro secrets: si falta alguno, avisa y termina bien,
# sin tocar la red. Ver docs/PUBLICACION.md, "Cloudflare R2".
#
# En R2 se publica el mismo árbol al que apuntan los estilos
# (<TILES_BASE_URL>/vX.Y.Z): el PMTiles, los estilos y manifest.json en la
# raíz, y assets.tar.gz desempaquetado (fonts/, sprites/, licenses/).
#
# Caché: /vX.Y.Z/ no cambia nunca (inmutable, un año); /latest/ se mueve con
# cada release (cinco minutos).
set -euo pipefail

dist="${1:?uso: scripts/r2-publish.sh <dist>}"

missing=()
for name in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [[ -n "${!name:-}" ]] || missing+=("$name")
done
if ((${#missing[@]} == 4)); then
  echo "::notice title=R2 desactivado::Publicación en R2 omitida: no hay secrets de R2 (ver docs/PUBLICACION.md)."
  exit 0
fi
if ((${#missing[@]} > 0)); then
  # Configuración a medias: se avisa fuerte, pero una release no falla por esto.
  echo "::warning title=R2 incompleto::Publicación en R2 omitida: faltan ${missing[*]} (ver docs/PUBLICACION.md)."
  exit 0
fi

fail() {
  echo "r2-publish.sh: $*" >&2
  exit 1
}

manifest="$dist/manifest.json"
[[ -s "$manifest" && -s "$dist/assets.tar.gz" && -s "$dist/SHA256SUMS" ]] || fail "$dist no tiene una release completa (corré make release)"
(cd "$dist" && sha256sum -c --quiet SHA256SUMS) || fail "$dist no coincide con su SHA256SUMS"
version="$(jq -r '.version' "$manifest")"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail "versión inválida en $manifest: '$version'"
# El ID de cuenta va en el host del endpoint y el bucket en la URL s3://.
[[ "$R2_ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] || fail "R2_ACCOUNT_ID no es un ID de cuenta de Cloudflare (32 hex)"
[[ "$R2_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "R2_BUCKET no es un nombre de bucket válido"

tree="$(mktemp -d)"
trap 'rm -rf "$tree"' EXIT
find "$dist" -maxdepth 1 -type f ! -name assets.tar.gz -exec cp {} "$tree/" \;
tar -xzf "$dist/assets.tar.gz" -C "$tree" --no-same-owner
cp "$dist/assets.tar.gz" "$tree/"

# Cliente S3 de AWS contra el endpoint de R2. Las sumas de verificación que la
# CLI agrega por defecto desde 2025 se piden solo cuando la API las exige.
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
endpoint="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

# Tipo de contenido por patrón: la CLI no conoce .pmtiles ni .pbf.
types=(
  "*.pmtiles=application/vnd.pmtiles"
  "*.pbf=application/x-protobuf"
  "*.json=application/json"
  "*.png=image/png"
  "*.tar.gz=application/gzip"
  "*.txt=text/plain; charset=utf-8"
  "*.md=text/markdown; charset=utf-8"
  "SHA256SUMS=text/plain; charset=utf-8"
)

upload() {
  local prefix="$1" cache="$2" entry pattern type
  # Todos los archivos del árbol tienen que tener tipo: si aparece uno nuevo,
  # falla antes de subir nada.
  local unknown
  unknown="$(cd "$tree" && find . -type f ! -name '*.pmtiles' ! -name '*.pbf' ! -name '*.json' ! -name '*.png' \
    ! -name '*.tar.gz' ! -name '*.txt' ! -name '*.md' ! -name SHA256SUMS)"
  [[ -z "$unknown" ]] || fail "archivos sin tipo de contenido: $unknown"
  for entry in "${types[@]}"; do
    pattern="${entry%%=*}"
    type="${entry#*=}"
    aws s3 cp "$tree/" "s3://$R2_BUCKET/$prefix/" --endpoint-url "$endpoint" --recursive --only-show-errors \
      --exclude "*" --include "$pattern" --content-type "$type" --cache-control "$cache"
  done
}

echo "==> R2: s3://$R2_BUCKET/v$version/"
upload "v$version" "public, max-age=31536000, immutable"
# latest/ al final: nunca apunta a una versión a medio subir.
echo "==> R2: s3://$R2_BUCKET/latest/"
upload latest "public, max-age=300"
echo "==> Listo: v$version y latest en R2 ($(find "$tree" -type f | wc -l) archivos por prefijo)"
