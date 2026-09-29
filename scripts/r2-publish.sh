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
# cada release (cinco minutos), nunca hacia atrás, y queda igual al árbol de su
# versión: lo que la release ya no trae se borra.
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
err="$(mktemp)"
trap 'rm -rf "$tree" "$err"' EXIT
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
  for entry in "${types[@]}"; do
    pattern="${entry%%=*}"
    type="${entry#*=}"
    aws s3 cp "$tree/" "s3://$R2_BUCKET/$prefix/" --endpoint-url "$endpoint" --recursive --only-show-errors \
      --exclude "*" --include "$pattern" --content-type "$type" --cache-control "$cache"
  done
}

# Todo archivo del árbol tiene que casar con un patrón de types, con la misma
# regla que la CLI (ruta relativa; "*" también cruza "/"): si no, no se subiría.
unknown=()
while IFS= read -r -d '' file; do
  rel="${file#"$tree"/}"
  matched=0
  for entry in "${types[@]}"; do
    # shellcheck disable=SC2053 # el patrón es un glob a propósito
    [[ "$rel" == ${entry%%=*} ]] && { matched=1; break; }
  done
  ((matched)) || unknown+=("$rel")
done < <(find "$tree" -type f -print0)
((${#unknown[@]} == 0)) || fail "archivos sin tipo de contenido: ${unknown[*]}"

echo "==> R2: s3://$R2_BUCKET/v$version/"
upload "v$version" "public, max-age=31536000, immutable"

# latest/ nunca retrocede: un re-adjunto de una versión vieja no la mueve.
# Sin latest/manifest.json (primera publicación), se crea.
current=""
if published="$(aws s3 cp "s3://$R2_BUCKET/latest/manifest.json" - --endpoint-url "$endpoint" --only-show-errors 2>"$err")"; then
  current="$(jq -r '.version // empty' <<<"$published" 2>/dev/null || true)"
  [[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "latest/manifest.json publicado no tiene una versión válida"
elif ! grep -qE '\(404\)|NoSuchKey|does not exist' "$err"; then
  fail "no se pudo leer latest/manifest.json: $(head -c 300 "$err")"
fi
if [[ -n "$current" && "$current" != "$version" && "$(printf '%s\n' "$current" "$version" | sort -V | tail -n1)" == "$current" ]]; then
  echo "::notice title=latest sin cambios::latest/ ya tiene la v$current, más nueva que la v$version: solo se publicó /v$version/."
  exit 0
fi

# latest/ al final: nunca apunta a una versión a medio subir.
echo "==> R2: s3://$R2_BUCKET/latest/ (antes: ${current:-vacío})"
upload latest "public, max-age=300"

# Borra de latest/ lo que esta versión ya no trae (no sync --delete: compara
# por tamaño y fecha, y el tar trae todas las fechas en 0).
# Un fallo al listar corta aquí (set -e): no se borra nada a ciegas.
keys="$(aws s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix latest/ --endpoint-url "$endpoint" \
  --query 'Contents[].Key' --output json | jq -r '.[]?')"
stale=0
while IFS= read -r key; do
  [[ -z "$key" || -f "$tree/${key#latest/}" ]] && continue
  aws s3 rm "s3://$R2_BUCKET/$key" --endpoint-url "$endpoint" --only-show-errors
  stale=$((stale + 1))
done <<<"$keys"
echo "==> Listo: v$version y latest en R2 ($(find "$tree" -type f | wc -l) archivos por prefijo, $stale obsoletos borrados de latest/)"
