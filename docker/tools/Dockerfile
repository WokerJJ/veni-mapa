# Imagen de herramientas del pipeline: todo lo que el Makefile necesita.
# Con ella, el único requisito local es Docker (también en Windows).

# Commit fijado de maplibre/font-maker. Para actualizarlo, ver
# "Actualizar recursos de terceros" en el README.
ARG FONT_MAKER_COMMIT=714ccaea67d384717890a3c2c27143dfdd4189b7

# osmium-tool v1.19.1, fijado por commit. Alpine publica libosmium pero no la
# herramienta: se compila contra la libosmium de la misma Alpine.
ARG OSMIUM_TOOL_COMMIT=18ac055a71ffebefb3b7407c0d324e2532770a79

# Una sola Alpine para las dos etapas: font-maker se compila y corre contra la
# misma libc y la misma FreeType. Declaradas antes del primer FROM, estas
# variables valen en todos los FROM. Para actualizarlas, ver "Actualizar la
# imagen de herramientas" en el README.
ARG ALPINE_VERSION=3.24
ARG NODE_MAJOR=24

# go-pmtiles publica un binario estático; se copia a una imagen con shell.
FROM protomaps/go-pmtiles:v1.31.2 AS pmtiles

# font-maker (MapLibre) convierte TTF en glyphs SDF para MapLibre y combina
# varias fuentes en un solo fontstack. No publica binarios: se compila aquí,
# sobre la misma versión de Alpine que la imagen final, para enlazar contra la
# misma libc y la misma FreeType.
FROM alpine:${ALPINE_VERSION} AS font-maker
ARG FONT_MAKER_COMMIT
RUN apk add --no-cache boost-dev build-base clang cmake freetype-dev git
RUN git clone https://github.com/maplibre/font-maker.git /src \
    && git -C /src checkout "$FONT_MAKER_COMMIT" \
    && git -C /src submodule update --init --recursive \
    && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /src/build --parallel

# osmium-tool recorta el extracto de OpenStreetMap (.osm.pbf) de la región y
# arma la red de calles para make routing.
FROM alpine:${ALPINE_VERSION} AS osmium
ARG OSMIUM_TOOL_COMMIT
RUN apk add --no-cache boost-dev build-base bzip2-dev cmake expat-dev git libosmium-dev lz4-dev nlohmann-json protozero-dev zlib-dev
RUN git clone https://github.com/osmcode/osmium-tool.git /src \
    && git -C /src checkout "$OSMIUM_TOOL_COMMIT" \
    && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
    && cmake --build /src/build --parallel --target osmium

# Node corre el generador de estilos (scripts/style/*.ts) sin compilar.
FROM node:${NODE_MAJOR}-alpine${ALPINE_VERSION}

# Queda en la imagen para que assets.json registre con qué se generaron los glyphs.
ARG FONT_MAKER_COMMIT
ENV FONT_MAKER_COMMIT=$FONT_MAKER_COMMIT

# tar y gzip de GNU: make release arma un assets.tar.gz reproducible (--sort, --mtime).
# boost-program_options, expat, lz4 y bzip2: bibliotecas de osmium-tool.
RUN apk add --no-cache bash boost-program_options coreutils curl expat freetype gzip jq libbz2 libstdc++ lz4-libs make tar yq-go

COPY --from=pmtiles /go-pmtiles /usr/local/bin/pmtiles
COPY --from=font-maker /src/build/font-maker /usr/local/bin/font-maker
COPY --from=osmium /src/build/src/osmium /usr/local/bin/osmium

# /work/node_modules es un volumen propio (compose.yaml): las dependencias de
# Linux no se mezclan con las que el editor instale en el host. Se crea aquí con
# permisos abiertos porque Docker copia modo y dueño al volumen nuevo, y el
# contenedor corre con el uid del host.
RUN mkdir -p /work/node_modules && chmod 0777 /work/node_modules

WORKDIR /work
CMD ["make", "help"]
