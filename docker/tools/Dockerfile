# Imagen de herramientas del pipeline: todo lo que el Makefile necesita.
# Con ella, el único requisito local es Docker (también en Windows).

# go-pmtiles publica un binario estático; se copia a una imagen con shell.
FROM protomaps/go-pmtiles:v1.31.2 AS pmtiles

FROM node:24-alpine3.22

RUN apk add --no-cache bash coreutils curl jq make yq-go

COPY --from=pmtiles /go-pmtiles /usr/local/bin/pmtiles

WORKDIR /work
CMD ["make", "help"]
