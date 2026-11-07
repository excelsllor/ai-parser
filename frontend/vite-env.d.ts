/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_YANDEX_CLIENT_ID?: string;
  readonly VITE_YANDEX_REDIRECT_URI?: string;
  readonly VITE_YANDEX_APP_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
