import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"; // controles, incluida la atribución
import { Protocol } from "pmtiles";

// Los estilos piden los tiles como pmtiles://…: MapLibre los lee por rangos HTTP.
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const style = (await (await fetch(import.meta.env.VITE_MAP_STYLE_URL)).json()) as maplibregl.StyleSpecification;
// Metadatos de Vení en el estilo: la caja de la región (config/region.yml).
const metadata = style.metadata as { "veni:bounds": maplibregl.LngLatBoundsLike };

const map = new maplibregl.Map({
  container: "mapa",
  style,
  // Cámara explícita: sin ella el mapa arranca en 0,0 con zoom 0, salta a
  // Roldanillo al cargar el estilo y puede quedar vacío hasta moverlo.
  center: style.center as maplibregl.LngLatLike,
  zoom: style.zoom,
  // La cámara no sale de la región del extracto.
  maxBounds: metadata["veni:bounds"],
});
