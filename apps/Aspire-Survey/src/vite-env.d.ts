/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  isLocalDev?: boolean;
  isStaging?: boolean;
  isProduction?: boolean;
  _ziteUsageToken?: string;
  __ziteAllowAiFix?: boolean;
  _ziteOnFixError?: (error: Error) => void;
  _ziteOnReload?: () => void;
}
