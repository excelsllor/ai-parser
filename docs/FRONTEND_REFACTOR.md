# Frontend refactor

Status and remaining work. Keep changes incremental: one component and its
styles per commit, with `bun run lint` and `bun run build` green.

## Done

- Single `AppHeader`: brand is always clickable, the main nav appears for
  authenticated users, and the user menu is rendered from one component
  (`components/layout/UserMenu.tsx`) on every authenticated page.
- Removed the dead `layout/DefaultLayout.tsx` (imported non-existent Header
  and Footer) and the unused Yandex/VK SDK loaders and type shims.
- Added barrels: `components/index.ts`, `components/ui/index.ts`.

## 1. CSS modules

Global page styles (5–6k lines) are the main source of accidental overrides.

Order, lowest risk first:

1. `components/ui/SnakeLoader.css` → `SnakeLoader.module.css`.
2. `components/layout/AppHeader.css` → `AppHeader.module.css`
   (`styles['app-header']` and so on; `UserMenu` keeps `ws-*` until step 4).
3. `components/workspace/workspace.css` → split by owner:
   `WorkspaceLayout.module.css`, `UserMenu.module.css`, `PolicySwitches.module.css`.
   Shared tokens stay in `index.css` as CSS variables.
4. `pages/*/*.css` → one module per page, then split further only where a
   component is reused.

Rules:

- Keep `index.css` for resets, CSS variables and `[data-theme]` tokens.
- No `:global` unless a class must be targeted by a third-party renderer.
- Keep the existing class names inside modules initially, so the diff is
  mechanical and reviewable.

## 2. Reusable components

After the CSS split, extract only patterns that actually repeat:

- button variants (`.auth-submit`, `.ws-new-query`, `.pf-button`),
- cards (`.ws-card`, `.pf-card`, `.admin-card`),
- form field + label + error,
- alert/notice,
- tabs (`.admin-tab`, auth tabs),
- modal/confirm dialog,
- table wrapper,
- status badge/dot.

Do not create a component until it has at least two real call sites.

## 3. Folders

Target shape for shared UI:

```
components/
  ui/
    Button/
      Button.tsx
      Button.module.css
      index.ts
    Card/
    Field/
    Alert/
    index.ts
  layout/
    AppHeader/
      AppHeader.tsx
      AppHeader.module.css
      index.ts
    UserMenu/
    index.ts
```

Page-specific components stay next to their page until reused.

## 4. Barrels

`components/index.ts` and `components/ui/index.ts` exist. Extend them only for
public entry points; avoid re-exporting page components to prevent import
cycles. Named exports only.

## Acceptance

- No new global class outside `index.css`.
- No duplicated header markup.
- `bun run lint` has no errors.
- `bun run build` succeeds.
