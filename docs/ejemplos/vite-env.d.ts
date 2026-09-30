// Lo mínimo de Vite para verificar el ejemplo sin instalar Vite: la variable
// de entorno que lee la app y la importación del CSS de MapLibre.
interface ImportMetaEnv {
  readonly VITE_MAP_STYLE_URL: string;
  readonly VITE_MAP_ROUTES_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
