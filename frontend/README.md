# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Запуск

```bash
bun install
bun run dev
```

Vite проксирует `/api` на `http://127.0.0.1:8080`, поэтому backend должен быть запущен через Docker Compose.

## Яндекс ID

Официальная кнопка Яндекс ID подключается через `sdk-suggest.js`. Для неё нужны:

- `VITE_YANDEX_CLIENT_ID` — client_id OAuth-приложения;
- `VITE_YANDEX_REDIRECT_URI` — URL вспомогательной страницы, совпадающий с Redirect URI в настройках OAuth-приложения (по умолчанию `/auth/yandex/token`);
- HTTPS на стандартном порту 443: Яндекс не разрешает встраивать кнопку на HTTP или нестандартном порту.

`client_secret` в frontend не передаётся. Он хранится только в серверном `.env` и понадобится, если позже понадобится обменивать код на токен на backend.

Если iframe-кнопка недоступна (например, локально на нестандартном порту), показывается fallback-кнопка с официальным логотипом. Она запускает обычный OAuth-redirect по коду: `response_type=code`.

## VK ID

Кнопка One Tap и виджет 3-в-1 (VK, OK, Mail) подключаются через `@vkid/sdk`.

- `VITE_VK_APP_ID` — ID приложения VK ID (по умолчанию `54883348`);
- `VITE_VK_REDIRECT_URL` — адрес из поля «Доверенный Redirect URL» настроек приложения (по умолчанию `<origin>/auth/vk/callback`).

Сейчас вход остаётся заглушкой: SDK получает код авторизации, но обмен на токен не выполняется.
