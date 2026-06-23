/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATABASE_URL: string;
  readonly VITE_DATABASE_ANON_KEY: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_APK_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
