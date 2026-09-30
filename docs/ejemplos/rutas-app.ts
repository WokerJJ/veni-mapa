import type { GeoJSONSource, Map } from "maplibre-gl";
// scripts/routing/router.ts y graph.ts del tag vX.Y.Z de veni-mapa, copiados en la app.
import { Router, type LngLat, type Route } from "@veni/rutas";

declare const map: Map; // el mapa de "Usar el mapa en la app"

// El grafo (~215 KB con gzip) se descarga la primera vez que se pide una ruta,
// no al abrir el mapa. Si la descarga falla (sin señal, portal cautivo), se
// olvida la promesa para reintentar en la próxima ruta.
let router: Promise<Router> | undefined;
function loadRouter(): Promise<Router> {
  router ??= fetch(import.meta.env.VITE_MAP_ROUTES_URL)
    .then(async (res) => {
      if (!res.ok) throw new Error(`rutas: HTTP ${res.status}`);
      return new Router(await res.json());
    })
    .catch((error: unknown) => {
      router = undefined;
      throw error;
    });
  return router;
}

/** Dibuja la ruta y la devuelve (distance en m, duration en s), o null si no hay. */
export async function showRoute(from: LngLat, to: LngLat, profile: "foot" | "car"): Promise<Route | null> {
  const route = (await loadRouter()).route(from, to, profile);
  // Sin ruta (a más de 1 km de una vía): ofrecer abrir Google Maps o Waze.
  if (!route) return null;
  // route.snap dice cuántos metros hay de cada punto a la red: se dibujan aparte.
  const data: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.coordinates } };
  const source = map.getSource<GeoJSONSource>("ruta");
  if (source) source.setData(data);
  else {
    map.addSource("ruta", { type: "geojson", data });
    map.addLayer({ id: "ruta", type: "line", source: "ruta", paint: { "line-color": "#F0525A", "line-width": 5 } });
  }
  return route;
}
