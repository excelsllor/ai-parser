export {};

interface VKIDOneTapRenderParams {
  container: HTMLElement;
  showAlternativeLogin?: boolean;
  styles?: {
    width?: number | string;
    [key: string]: unknown;
  };
  oauthList?: string[];
}

interface VKIDOneTap {
  render: (params: VKIDOneTapRenderParams) => VKIDOneTap;
  on: (event: string, handler: (...args: unknown[]) => void) => VKIDOneTap;
}

interface VKIDConfig {
  app: number;
  redirectUrl: string;
  responseMode: string;
  source: string;
  scope?: string;
}

interface VKIDSDKApi {
  Config: {
    init: (config: VKIDConfig) => void;
  };
  ConfigResponseMode: {
    Callback: string;
  };
  ConfigSource: {
    LOWCODE: string;
  };
  OneTap: new () => VKIDOneTap;
  WidgetEvents: {
    ERROR: string;
  };
  OneTapInternalEvents: {
    LOGIN_SUCCESS: string;
  };
}

declare global {
  interface Window {
    VKIDSDK?: VKIDSDKApi;
  }
}
