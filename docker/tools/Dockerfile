# Imagen de herramientas del pipeline: todo lo que el Makefile necesita.
# Con ella, el único requisito local es Docker (también en Windows).

# Commit fijado de maplibre/font-maker. Para actualizarlo, ver
# "Actualizar recursos de terceros" en el README.
ARG FONT_MAKER_COMMIT=714ccaea67d384717890a3c2c27143dfdd4189b7

# go-pmtiles publica un binario estático; se copia a una imagen con shell.
FROM protomaps/go-pmtiles:v1.31.2 AS pmtiles

# font-maker (MapLibre) convierte TTF en glyphs SDF para MapLibre y combina
# varias fuentes en un solo fontstack. No publica binarios: se compila aquí,
# sobre la misma versión de Alpine que la imagen final, para enlazar contra la
# misma libc y la misma FreeType.
FROM alpine:3.22 AS font-maker
ARG FONT_MAKER_COMMIT
RUN apk add --no-cache boost-dev build-base clang cmake freetype-dev git
RUN git clone https://github.com/maplibre/font-maker.git /src \
    && git -C /src checkout "$FONT_MAKER_COMMIT" \
    && git -C /src submodule update --init --recursive \
    && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /src/build --parallel

FROM alpine:3.22

# Queda en la imagen para que assets.json registre con qué se generaron los glyphs.
ARG FONT_MAKER_COMMIT
ENV FONT_MAKER_COMMIT=$FONT_MAKER_COMMIT

RUN apk add --no-cache bash coreutils curl freetype jq libstdc++ make yq-go

COPY --from=pmtiles /go-pmtiles /usr/local/bin/pmtiles
COPY --from=font-maker /src/build/font-maker /usr/local/bin/font-maker

WORKDIR /work
CMD ["make", "help"]
