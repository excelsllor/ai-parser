export {};

interface YaAuthSuggestQueryParams {
  client_id: string;
  response_type: 'token' | 'code';
  redirect_uri?: string;
}

interface YaAuthSuggestButtonParams {
  view: 'button';
  parentId?: string;
  buttonView?: 'main' | 'additional' | 'icon' | 'iconBG';
  buttonTheme?: 'light' | 'dark';
  buttonSize?: 'xs' | 's' | 'm' | 'l' | 'xl' | 'xxl';
  buttonBorderRadius?: number;
  buttonIcon?: 'ya' | 'yaEng';
}

interface YaAuthSuggestHandlerResult {
  status: 'ok' | 'error';
  code?: string;
  [key: string]: unknown;
}

interface YaAuthSuggestInitResult {
  status: 'ok' | 'error';
  handler: () => Promise<YaAuthSuggestHandlerResult>;
  code?: string;
}

declare global {
  interface Window {
    YaAuthSuggest?: {
      init: (
        oauthQueryParams: YaAuthSuggestQueryParams,
        tokenPageOrigin: string,
        suggestParams?: YaAuthSuggestButtonParams,
      ) => Promise<YaAuthSuggestInitResult>;
    };
    YaSendSuggestToken?: (
      origin: string,
      extraData?: Record<string, unknown>,
    ) => void;
  }
}
