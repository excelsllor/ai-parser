/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_YANDEX_CLIENT_ID?: string;
  readonly VITE_YANDEX_REDIRECT_URI?: string;
  readonly VITE_YANDEX_APP_ORIGIN?: string;
  readonly VITE_VK_APP_ID?: string;
  readonly VITE_VK_REDIRECT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
