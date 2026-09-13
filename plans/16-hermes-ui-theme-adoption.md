# 16 — Hermes UI and Theme Adoption

## Features

- Built-in Hermes theme catalogue integrating 8 iconic palettes into the client theme registry
- Direct mathematical token mapping from Hermes 2-layer palettes onto `--dsw-alias-*` semantic variables
- Durable custom theme persistence across browser reboots via relaxed settings schema
- High-fidelity theme swatch selector rendering 3-stop preview bars in the Appearance settings row
- Independent typography and font-family customization complementing conversation font scaling
- Pre-plugin bootstrap script resilience preventing flash-of-unstyled-content on custom theme boot
- Visual cron and webhook schedule builder ported to the client schedule interface
- Model telemetry and capability card presentation ported to client models settings
- Complete Simplified Chinese and English localization compliant with the AST i18n verification gate
- Zero-regression preservation of existing default theme, system preference following, and contrast ratios

## 1. Purpose

This plan defines the architectural adoption of Hermes themes, design tokens, and select presentation components into the DeepSeek Harness web client (`/home/sic/harness-agent`), allowing users to select and persist Hermes visual themes while preserving all Harness runtime guarantees.

### 1.1 What It Owns
- **Hermes Theme Catalogue**: Registration of 8 Hermes theme definitions (`hermes-teal`, `hermes-teal-large`, `hermes-nous-blue`, `hermes-midnight`, `hermes-ember`, `hermes-mono`, `hermes-cyberpunk`, `hermes-rose`) in `@deepseek-ai/dsh-client-ui-theme`.
- **Token Translation Layer**: Mathematical translation mapping Hermes `{ background, midground }` palette triplets onto DeepSeek Harness `--dsw-alias-*` semantic tokens.
- **Durable Preference Persistence**: A targeted core schema relaxation in `packages/client/ui-theme/src/theme-settings.ts` permitting arbitrary registered theme IDs to persist across browser reloads.
- **Pre-Plugin Bootstrap Resilience**: Updating `packages/client/ui-theme/src/boot-theme.ts` so early inline HTML injection evaluates base color schemes correctly, eliminating flash-of-unstyled-content (FOUC).
- **Appearance Settings UX**: An upgraded Appearance settings row in `packages/client/ui-theme/src/client/AppearanceRow.tsx` rendering 3-stop palette swatches (`[bg, midground, brand]`) with keyboard navigation and active state indicators.
- **Selected Component Rewrites**: Reimplementing high-value Hermes functional components (`ScheduleBuilder.tsx` into `@deepseek-ai/dsh-client-ui-schedule` and `ModelInfoCard.tsx` into `@deepseek-ai/dsh-client-ui-settings-models`) using Harness `ui-primitives` and CSS Modules.
- **Complete Internationalization**: Adding all required localization strings to typed `locales.ts` dictionaries (`zh` and `en`) meeting `scripts/verify-client-ui-i18n.ts` requirements.

### 1.2 What It Deliberately Does NOT Own
- **DOM Projection Engine**: `ThemePresenter` (`packages/client/ui-layout/src/client/theme-presenter.ts:20-68`) remains the sole DOM manipulator. This plan provides data snapshots to `ThemeRuntime`; it does not touch the DOM directly.
- **CSS Technology Stack**: Tailwind CSS v4, `@tailwindcss/vite`, and `@theme inline` utility classes are strictly rejected (`docs/web-styling.md:16`). All styles must remain pure CSS Modules (`*.module.css`).
- **External UI Libraries**: `@nous-research/ui`, `lucide-react`, and motion libraries (`gsap`, `@react-three/fiber`) are forbidden in the client workspace (`docs/web-styling.md:15`). All UI controls must use `@deepseek-ai/dsh-client-ui-primitives`.
- **Interactive Terminal PTY**: Full interactive terminal sessions (`HermesConsoleModal.tsx`, `@xterm/xterm`) are rejected. Harness maintains structured tool cards (`ui-tool`) rather than embedded shell emulators (`packages/client/AGENTS.md:55`).
- **Agent Execution Plane**: Themes and UI components reside entirely on the Client Plane. They have no representation in agent presets, tool registries, or model context windows.

## 2. Harness Architecture Fit

### 2.1 Primitive Classification

| Component | Harness Primitive | Plane | Scope / Lifetime | Justification |
| :--- | :--- | :--- | :--- | :--- |
| `hermes-themes.ts` | Static Theme Definition Pack | Client Plane | Process / Bundle | Pure data dictionaries registering into `ThemeRuntime.register()`. |
| `ThemeSettingsSchema` | Host Settings Schema (Core) | Host Plane | Global (`ctx.settings`) | Defines durable user settings envelope validated by host and browser. |
| `ThemeRuntime` (extended) | Client Service (`ctx.theme`) | Client Plane | Browser Session | Coordinates active theme, font size, media query, and emits `theme/change`. |
| `AppearanceRow` (upgraded) | Client UI Extension (Slot Occupant) | Client Plane | Browser Session (`settings.general.item`) | Feature-owned UI row registered into the General Settings section (`order: 10`). |
| `ScheduleBuilder` | Client UI Component (Slot Occupant) | Client Plane | Browser Session (`ui-schedule`) | Interactive schedule composer replacing read-only catalog in `ui-schedule`. |
| `CustomProviderCard` | Client UI Component (Slot Occupant) | Client Plane | Browser Session (`settings.models`) | Enriches model provider inspection in `ui-settings-models`. |

Per `docs/web-styling.md:9`, `ui-theme` is the designated owner of `--dsw-*` tokens, semantic aliases, and theme preference. Modifying `ui-theme` directly respects this established boundary.

### 2.2 Structural Decision: Expanding `ui-theme` vs. New Package

The research in `ref-ui.md:583-594` evaluates whether to introduce a new package (`@deepseek-ai/dsh-client-ui-theme-hermes`) or expand `@deepseek-ai/dsh-client-ui-theme`. **The verdict is to expand `ui-theme`.**

#### Rejected Alternative: Standalone Package (`packages/client/ui-theme-hermes`)
1. **Ownership Violation**: `docs/web-styling.md:9` establishes:
   > "`ui-theme` owns the `--dsw-*` static scale, semantic aliases, typography, motion, gradients, shadows, scrollbar styles, and light/dark preference... Feature packages consume semantic aliases and do not define another global theme."
   Introducing a secondary theme package fragments token ownership and creates competing authorities for theme definitions.
2. **Settings Coupling Deadlock**: `ThemeRuntime` is tightly coupled to `ctx.settingsScope.bind({ namespace: 'ui-theme' })` (`packages/client/ui-theme/src/client/index.ts:430`). If an external package registers themes, `ThemeRuntime.setTheme()` refuses to persist custom IDs unless `ThemeSettingsSchema` inside `ui-theme` is modified anyway.
3. **Bundle Latency & Boot FOUC**: External package registration requires asynchronous multi-bundle coordination during client bootstrap, increasing the delay before theme stabilization and risking visible style flashes.

#### Chosen Approach: Expand `packages/client/ui-theme`
Expanding `ui-theme` places Hermes presets in `src/client/hermes-themes.ts`, updates `ThemeSettingsSchema` at its definition source, and keeps the Appearance settings row cohesive.

### 2.3 The Core Modification Register: Theme Preference Persistence

Modifying `packages/client/ui-theme/src/theme-settings.ts` constitutes an in-tree core schema adjustment subject to repository rules:

1. **Desired Behavior**: Allow users to select and durably persist any registered custom theme ID (`hermes-teal`, `hermes-nous-blue`, etc.) across reboots, with the Host settings service persisting the chosen ID in the user-settings document.
2. **Extension Points Considered**:
   - *Browser `localStorage`*: Bypasses Cordis `SettingsScope`. Fails across browsers/devices, cannot feed server-side `bootThemeInjection`, and causes severe FOUC on page load.
   - *Secondary Settings Namespace (`ui-theme-custom`)*: Creates a split-brain preference state where `ThemeRuntime` must synchronize across two disconnected settings scopes.
   - *Client-side Session Storage*: Ephemeral; resets on tab closure, failing basic user expectations.
3. **Why Each is Insufficient**: The Harness settings architecture relies on `ctx.settingsScope.bind<ThemeSettings>({ namespace: 'ui-theme' })` as the single source of truth (`packages/client/ui-theme/src/client/index.ts:430`). Custom themes registered via `ctx.theme.register()` must participate in this identical persistence channel.
4. **Smallest Possible Change**:
   In `packages/client/ui-theme/src/theme-settings.ts`:
   - Keep `THEME_PREFERENCES = ['light', 'dark', 'system'] as const` for built-in baseline modes.
   - Change `ThemeSettingsSchema`:
     ```typescript
     // packages/client/ui-theme/src/theme-settings.ts:41-44
     export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
       [THEME_PREFERENCE_FIELD]: z.string().default(DEFAULT_PREFERENCE),
       [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
     })
     ```
   - In `packages/client/ui-theme/src/client/index.ts:237`:
     Remove `if (isThemePreference(id))` check so that any registered theme ID writes to `this.host.set(THEME_PREFERENCE_FIELD, id)`.
   - In `packages/client/ui-theme/src/boot-theme.ts:12-23`:
     Update `bootThemeScript` to resolve custom theme color schemes from a baked-in registry lookup, ensuring `document.body` receives `data-ds-dark-theme` before React mounts.
   - **Backward Compatibility**: Existing persisted values (`'light'`, `'dark'`, `'system'`) remain 100% valid string values and behave identically.

## 3. Spec Coverage & Source Provenance

### 3.1 Hermes Port Provenance

| Capability | Hermes Source File | DeepSeek Harness Destination | Port Strategy & Transformation |
| :--- | :--- | :--- | :--- |
| **8 Theme Palettes** | `web/src/themes/presets.ts:41-240` | `packages/client/ui-theme/src/client/hermes-themes.ts` | **Port (Token Data)**: Map `{ background, midground }` layers to `--dsw-alias-*` tokens. |
| **Palette Types** | `web/src/themes/types.ts:27-39, 156-186` | `packages/client/ui-theme/src/client/hermes-themes.ts` | **Port (Types)**: Extract palette structure into Harness `ThemeDefinition`. |
| **Swatch Picker UX** | `web/src/components/ThemeSwitcher.tsx:27-159, 315-331` | `packages/client/ui-theme/src/client/AppearanceRow.tsx` | **Rewrite**: Convert Tailwind + `@nous-research/ui` into CSS Modules and Harness `Menu`/`Button`. |
| **Schedule Builder** | `web/src/components/ScheduleBuilder.tsx` | `packages/client/ui-schedule/src/client/ScheduleBuilder.tsx` | **Rewrite**: Port cron/interval visual selector to `ui-primitives` atoms (`Input`, `Select`). |
| **Model Info Card** | `web/src/components/ModelInfoCard.tsx` | `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx` | **Rewrite**: Adopt card metrics layout into CSS Modules for model provider inspection. |
| **Font Selection** | `web/src/themes/fonts.ts` | `packages/client/ui-theme/src/client/FontFamilyRow.tsx` | **Port (Bounded)**: Controlled font family switcher modifying `--dsw-font-family`. |
| **Console Modal** | `web/src/components/HermesConsoleModal.tsx` | N/A | **REJECT**: Violates `packages/client/AGENTS.md:55`. Harness uses structured `ui-tool` cards. |
| **Tailwind & Utility CSS** | `web/src/index.css:119-188` | N/A | **REJECT**: Direct violation of `docs/web-styling.md:16`. All styles use CSS Modules. |
| **`@nous-research/ui`** | `web/package.json:19` | N/A | **REJECT**: External component libraries forbidden; must use `ui-primitives`. |
| **Ad-hoc i18n Strings** | `web/src/i18n/*` | `packages/client/ui-theme/src/client/locales.ts` | **REJECT**: Inline strings rejected by AST gate; 100% of copy moved to typed `locales.ts`. |

### 3.2 Spec Coverage Matrix

| Spec Requirement | Handled Here | Delegated Elsewhere | Rationale |
| :--- | :--- | :--- | :--- |
| **Hermes Themes** | Yes (`HERMES_THEMES` in `ui-theme`) | None | 8 complete theme definitions registered in `ThemeRuntime`. |
| **Swatch Previews** | Yes (`AppearanceRow.tsx`) | None | 3-color stop swatch cards rendered in Settings -> General -> Appearance. |
| **Durable Theme Persistence** | Yes (`ThemeSettingsSchema`) | Core (`settings`) | Relaxed schema writes theme ID through `SettingsScope`. |
| **Early Boot FOUC Prevention** | Yes (`boot-theme.ts`) | Core (`webserver`) | Synchronous inline script applies `data-ds-dark-theme` before hydration. |
| **Cron / Schedule Visuals** | Yes (`ScheduleBuilder.tsx`) | `@deepseek-ai/dsh-client-ui-schedule` | Interactive visual cron builder in `ui-schedule`. |
| **Model Capability Inspection** | Yes (`CustomProviderCard.tsx`) | `@deepseek-ai/dsh-client-ui-settings-models` | Structured metrics card in `ui-settings-models`. |
| **Font Customization** | Yes (`FontFamilyRow.tsx`) | None | Complementary font selection row beside font size slider. |

## 4. Proposed Package and File Layout

```
packages/client/
├── ui-theme/                                        # EXTENDED: @deepseek-ai/dsh-client-ui-theme
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                                 # Host registration & index-inject hook
│   │   ├── theme-settings.ts                        # MODIFIED: relaxed ThemeSettingsSchema (string preference)
│   │   ├── boot-theme.ts                            # MODIFIED: custom theme colorScheme resolution
│   │   └── client/
│   │       ├── index.ts                             # MODIFIED: registers HERMES_THEMES, unrestricted setTheme()
│   │       ├── hermes-themes.ts                     # NEW: 8 Hermes theme definitions with token mappings
│   │       ├── locales.ts                           # MODIFIED: zh/en copy keys for Hermes themes
│   │       ├── styles.ts                            # Style injector for base stylesheets
│   │       ├── settings-store.ts                    # Store handles for AppearanceRow and FontSizeRow
│   │       ├── AppearanceRow.tsx                    # MODIFIED: 3-stop swatch palette picker UI
│   │       ├── AppearanceRow.module.css             # MODIFIED: swatch grid and active state styling
│   │       ├── FontSizeRow.tsx                      # Existing font size slider
│   │       ├── FontSizeRow.module.css               # Existing font size styling
│   │       ├── FontFamilyRow.tsx                    # NEW: optional font-family selector row
│   │       └── FontFamilyRow.module.css             # NEW: font-family selector styling
│   └── tests/
│       ├── theme.client.spec.ts                     # MODIFIED: verify 8 themes, custom ID persistence
│       ├── appearance-row.client.spec.tsx           # MODIFIED: swatch rendering, aria states, click events
│       └── boot-theme.client.spec.ts                # MODIFIED: verify custom theme bootstrap script output
├── ui-schedule/                                     # EXTENDED: @deepseek-ai/dsh-client-ui-schedule
│   └── src/client/
│       ├── ScheduleBuilder.tsx                      # NEW: rewritten Hermes schedule builder
│       └── ScheduleBuilder.module.css               # NEW: CSS Module for schedule builder
└── ui-settings-models/                              # EXTENDED: @deepseek-ai/dsh-client-ui-settings-models
    └── src/client/
        ├── CustomProviderCard.tsx                   # MODIFIED: enriched model capabilities layout
        └── CustomProviderCard.module.css            # MODIFIED: badge metrics and context limit bars
```

## 5. Public Contracts

### 5.1 Harness Theming Token Mapping

Hermes themes derive their entire color palette from a `{ background, midground }` layer model. The following explicit table defines the exact mapping to DeepSeek Harness `--dsw-alias-*` semantic tokens (`packages/client/ui-theme/src/styles/design-platform.css:157-247`):

| Hermes Source Layer / Expression | Harness Semantic Target Token | Visual Role in Harness UI |
| :--- | :--- | :--- |
| `palette.background.hex` | `--dsw-alias-bg-base` | Main window / conversation canvas background |
| `darken(palette.background.hex, 5%)` | `--dsw-specific-sidebar-fill` | Left navigation rail & sidebar column |
| `color-mix(in srgb, midground 4%, bg)` | `--dsw-alias-bg-layer-1` | Primary raised cards, bubbles, panel containers |
| `color-mix(in srgb, midground 6%, bg)` | `--dsw-alias-bg-layer-2` | Secondary nested containers, tool call cards |
| `color-mix(in srgb, midground 8%, bg)` | `--dsw-alias-bg-layer-3` | Tertiary input containers, status rows |
| `color-mix(in srgb, midground 12%, bg)` | `--dsw-alias-bg-overlay` | Popovers, modal dialogs, dropdown menus |
| `color-mix(in srgb, midground 12%, transparent)` | `--dsw-alias-border-l1` | Subtle hairline dividers, internal cell borders |
| `color-mix(in srgb, midground 20%, transparent)` | `--dsw-alias-border-l2` | Standard card borders, button outlines |
| `color-mix(in srgb, midground 30%, transparent)` | `--dsw-alias-border-l3` | Stronger interactive borders, active input focus |
| `color-mix(in srgb, midground 45%, transparent)` | `--dsw-alias-border-l4` | High-contrast boundaries, modal edges |
| `palette.midground.hex` | `--dsw-alias-label-primary` | High-contrast body text, headings, icons |
| `color-mix(in srgb, midground 72%, transparent)` | `--dsw-alias-label-secondary` | Secondary metadata, subtitles, descriptions |
| `color-mix(in srgb, midground 45%, transparent)` | `--dsw-alias-label-tertiary` | Placeholders, inactive tabs, disabled text |
| `color-mix(in srgb, midground 35%, transparent)` | `--dsw-alias-label-caption` | Fine print, timestamps, step counters |
| `palette.midground.hex` | `--dsw-alias-brand-primary` | Brand accent, primary button fill, focus rings |
| `color-mix(in srgb, midground 8%, transparent)` | `--dsw-alias-interactive-bg-hover` | Row hover highlight |
| `color-mix(in srgb, midground 15%, transparent)` | `--dsw-alias-interactive-bg-active` | Row pressed / active highlight |
| `colorOverrides.destructive ?? #fb2c36` | `--dsw-alias-state-error-primary` | Error badges, delete buttons, failure indicators |
| `colorOverrides.warning ?? #ffbd38` | `--dsw-alias-state-warn-primary` | Warning banners, caution dots, approval prompts |
| `colorOverrides.success ?? #4ade80` | `--dsw-alias-state-success-primary` | Success checkmarks, completed task pills |

#### Handling Tokens with No Harness Equivalent
- **`warmGlow`** (`rgba(255, 189, 56, 0.35)`): Harness features no full-bleed background glow canvas layer. Used exclusively as the third stop in swatch previews (`[bg, midground, warmGlow]`).
- **`noiseOpacity`**: Harness does not utilize SVG noise overlays on top of the DOM. Omitted from CSS tokens to prevent DOM bloat.
- **`terminalBackground` / `terminalForeground`**: Mapped to `--dsw-alias-markdown-code-block` and `--ds-font-family-code` for `TerminalBlock` cards; embedded raw xterm sessions are not used.
- **`seriesColors`**: Mapped to `--dsw-alias-brand-primary` and `--dsw-alias-interactive-bg-hover` in trajectory charts.
- **`layout.radius`**: Omitted. Harness mandates global superellipse smoothing (`corner-shape.css`) and strict 0.5px hairline borders (`docs/web-styling.md:23-25`). Modifying border radius per theme would violate the Harness design system.

### 5.2 The 8 Hermes Theme Definitions (`hermes-themes.ts`)

```typescript
// packages/client/ui-theme/src/client/hermes-themes.ts
import type { ThemeDefinition } from './index.ts'

export interface HermesThemeMeta {
  readonly id: string
  readonly nameKey: string
  readonly colorScheme: 'light' | 'dark'
  readonly swatches: readonly [string, string, string] // [bg, midground, warmGlow]
}

export const hermesTealTheme: ThemeDefinition = {
  id: 'hermes-teal',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#041c1c',
    '--dsw-specific-sidebar-fill': '#021414',
    '--dsw-alias-bg-layer-1': '#092525',
    '--dsw-alias-bg-layer-2': '#0e2f2f',
    '--dsw-alias-bg-layer-3': '#133838',
    '--dsw-alias-bg-overlay': '#174040',
    '--dsw-alias-border-l1': 'rgba(255, 230, 203, 0.08)',
    '--dsw-alias-border-l2': 'rgba(255, 230, 203, 0.15)',
    '--dsw-alias-border-l3': 'rgba(255, 230, 203, 0.25)',
    '--dsw-alias-border-l4': 'rgba(255, 230, 203, 0.38)',
    '--dsw-alias-label-primary': '#ffe6cb',
    '--dsw-alias-label-secondary': 'rgba(255, 230, 203, 0.72)',
    '--dsw-alias-label-tertiary': 'rgba(255, 230, 203, 0.45)',
    '--dsw-alias-label-caption': 'rgba(255, 230, 203, 0.32)',
    '--dsw-alias-brand-primary': '#ffe6cb',
    '--dsw-alias-button-primary-fill': '#ffe6cb',
    '--dsw-alias-interactive-bg-hover': 'rgba(255, 230, 203, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(255, 230, 203, 0.15)',
  },
}

export const hermesNousBlueTheme: ThemeDefinition = {
  id: 'hermes-nous-blue',
  colorScheme: 'light',
  tokens: {
    '--dsw-alias-bg-base': '#E8F2FD',
    '--dsw-specific-sidebar-fill': '#DCE9F8',
    '--dsw-alias-bg-layer-1': '#F0F6FE',
    '--dsw-alias-bg-layer-2': '#FFFFFF',
    '--dsw-alias-bg-layer-3': '#E2EEFC',
    '--dsw-alias-bg-overlay': '#FFFFFF',
    '--dsw-alias-border-l1': 'rgba(0, 83, 253, 0.08)',
    '--dsw-alias-border-l2': 'rgba(0, 83, 253, 0.15)',
    '--dsw-alias-border-l3': 'rgba(0, 83, 253, 0.28)',
    '--dsw-alias-border-l4': 'rgba(0, 83, 253, 0.42)',
    '--dsw-alias-label-primary': '#0a1d37',
    '--dsw-alias-label-secondary': 'rgba(10, 29, 55, 0.75)',
    '--dsw-alias-label-tertiary': 'rgba(10, 29, 55, 0.50)',
    '--dsw-alias-label-caption': 'rgba(10, 29, 55, 0.35)',
    '--dsw-alias-brand-primary': '#0053FD',
    '--dsw-alias-button-primary-fill': '#0053FD',
    '--dsw-alias-interactive-bg-hover': 'rgba(0, 83, 253, 0.06)',
    '--dsw-alias-interactive-bg-active': 'rgba(0, 83, 253, 0.12)',
  },
}

export const hermesMidnightTheme: ThemeDefinition = {
  id: 'hermes-midnight',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#0a0a1f',
    '--dsw-specific-sidebar-fill': '#070716',
    '--dsw-alias-bg-layer-1': '#12122b',
    '--dsw-alias-bg-layer-2': '#181836',
    '--dsw-alias-bg-layer-3': '#1e1e40',
    '--dsw-alias-bg-overlay': '#24244b',
    '--dsw-alias-border-l1': 'rgba(212, 200, 255, 0.08)',
    '--dsw-alias-border-l2': 'rgba(212, 200, 255, 0.16)',
    '--dsw-alias-border-l3': 'rgba(212, 200, 255, 0.28)',
    '--dsw-alias-border-l4': 'rgba(212, 200, 255, 0.40)',
    '--dsw-alias-label-primary': '#d4c8ff',
    '--dsw-alias-label-secondary': 'rgba(212, 200, 255, 0.70)',
    '--dsw-alias-label-tertiary': 'rgba(212, 200, 255, 0.45)',
    '--dsw-alias-label-caption': 'rgba(212, 200, 255, 0.30)',
    '--dsw-alias-brand-primary': '#a78bfa',
    '--dsw-alias-button-primary-fill': '#a78bfa',
    '--dsw-alias-interactive-bg-hover': 'rgba(212, 200, 255, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(212, 200, 255, 0.15)',
  },
}

export const hermesEmberTheme: ThemeDefinition = {
  id: 'hermes-ember',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#1a0a06',
    '--dsw-specific-sidebar-fill': '#120704',
    '--dsw-alias-bg-layer-1': '#26110a',
    '--dsw-alias-bg-layer-2': '#31170f',
    '--dsw-alias-bg-layer-3': '#3c1d13',
    '--dsw-alias-bg-overlay': '#482318',
    '--dsw-alias-border-l1': 'rgba(255, 216, 176, 0.08)',
    '--dsw-alias-border-l2': 'rgba(255, 216, 176, 0.16)',
    '--dsw-alias-border-l3': 'rgba(255, 216, 176, 0.28)',
    '--dsw-alias-border-l4': 'rgba(255, 216, 176, 0.40)',
    '--dsw-alias-label-primary': '#ffd8b0',
    '--dsw-alias-label-secondary': 'rgba(255, 216, 176, 0.72)',
    '--dsw-alias-label-tertiary': 'rgba(255, 216, 176, 0.45)',
    '--dsw-alias-label-caption': 'rgba(255, 216, 176, 0.30)',
    '--dsw-alias-brand-primary': '#f97316',
    '--dsw-alias-button-primary-fill': '#f97316',
    '--dsw-alias-interactive-bg-hover': 'rgba(255, 216, 176, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(255, 216, 176, 0.15)',
    '--dsw-alias-state-error-primary': '#c92d0f',
    '--dsw-alias-state-warn-primary': '#f97316',
  },
}

export const hermesMonoTheme: ThemeDefinition = {
  id: 'hermes-mono',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#0e0e0e',
    '--dsw-specific-sidebar-fill': '#080808',
    '--dsw-alias-bg-layer-1': '#161616',
    '--dsw-alias-bg-layer-2': '#1c1c1c',
    '--dsw-alias-bg-layer-3': '#242424',
    '--dsw-alias-bg-overlay': '#2c2c2c',
    '--dsw-alias-border-l1': 'rgba(234, 234, 234, 0.08)',
    '--dsw-alias-border-l2': 'rgba(234, 234, 234, 0.15)',
    '--dsw-alias-border-l3': 'rgba(234, 234, 234, 0.28)',
    '--dsw-alias-border-l4': 'rgba(234, 234, 234, 0.40)',
    '--dsw-alias-label-primary': '#eaeaea',
    '--dsw-alias-label-secondary': 'rgba(234, 234, 234, 0.70)',
    '--dsw-alias-label-tertiary': 'rgba(234, 234, 234, 0.45)',
    '--dsw-alias-label-caption': 'rgba(234, 234, 234, 0.30)',
    '--dsw-alias-brand-primary': '#eaeaea',
    '--dsw-alias-button-primary-fill': '#eaeaea',
    '--dsw-alias-interactive-bg-hover': 'rgba(234, 234, 234, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(234, 234, 234, 0.15)',
  },
}

export const hermesCyberpunkTheme: ThemeDefinition = {
  id: 'hermes-cyberpunk',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#040608',
    '--dsw-specific-sidebar-fill': '#020304',
    '--dsw-alias-bg-layer-1': '#090e12',
    '--dsw-alias-bg-layer-2': '#0e161c',
    '--dsw-alias-bg-layer-3': '#131e26',
    '--dsw-alias-bg-overlay': '#182630',
    '--dsw-alias-border-l1': 'rgba(155, 255, 207, 0.08)',
    '--dsw-alias-border-l2': 'rgba(155, 255, 207, 0.18)',
    '--dsw-alias-border-l3': 'rgba(155, 255, 207, 0.32)',
    '--dsw-alias-border-l4': 'rgba(155, 255, 207, 0.45)',
    '--dsw-alias-label-primary': '#9bffcf',
    '--dsw-alias-label-secondary': 'rgba(155, 255, 207, 0.70)',
    '--dsw-alias-label-tertiary': 'rgba(155, 255, 207, 0.45)',
    '--dsw-alias-label-caption': 'rgba(155, 255, 207, 0.30)',
    '--dsw-alias-brand-primary': '#00ff88',
    '--dsw-alias-button-primary-fill': '#00ff88',
    '--dsw-alias-interactive-bg-hover': 'rgba(155, 255, 207, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(155, 255, 207, 0.16)',
    '--dsw-alias-state-success-primary': '#00ff88',
    '--dsw-alias-state-warn-primary': '#ffd700',
    '--dsw-alias-state-error-primary': '#ff0055',
  },
}

export const hermesRoseTheme: ThemeDefinition = {
  id: 'hermes-rose',
  colorScheme: 'dark',
  tokens: {
    '--dsw-alias-bg-base': '#1a0f15',
    '--dsw-specific-sidebar-fill': '#120a0e',
    '--dsw-alias-bg-layer-1': '#26161f',
    '--dsw-alias-bg-layer-2': '#311d28',
    '--dsw-alias-bg-layer-3': '#3c2331',
    '--dsw-alias-bg-overlay': '#482a3a',
    '--dsw-alias-border-l1': 'rgba(255, 212, 225, 0.08)',
    '--dsw-alias-border-l2': 'rgba(255, 212, 225, 0.16)',
    '--dsw-alias-border-l3': 'rgba(255, 212, 225, 0.28)',
    '--dsw-alias-border-l4': 'rgba(255, 212, 225, 0.40)',
    '--dsw-alias-label-primary': '#ffd4e1',
    '--dsw-alias-label-secondary': 'rgba(255, 212, 225, 0.70)',
    '--dsw-alias-label-tertiary': 'rgba(255, 212, 225, 0.45)',
    '--dsw-alias-label-caption': 'rgba(255, 212, 225, 0.30)',
    '--dsw-alias-brand-primary': '#f472b6',
    '--dsw-alias-button-primary-fill': '#f472b6',
    '--dsw-alias-interactive-bg-hover': 'rgba(255, 212, 225, 0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(255, 212, 225, 0.15)',
  },
}

export const hermesTealLargeTheme: ThemeDefinition = {
  id: 'hermes-teal-large',
  colorScheme: 'dark',
  tokens: {
    ...hermesTealTheme.tokens,
    '--dsw-font-size-base': '16px',
    '--dsw-line-height-base': '24px',
  },
}

export const HERMES_THEMES: readonly ThemeDefinition[] = [
  hermesTealTheme,
  hermesNousBlueTheme,
  hermesMidnightTheme,
  hermesEmberTheme,
  hermesMonoTheme,
  hermesCyberpunkTheme,
  hermesRoseTheme,
  hermesTealLargeTheme,
]

export const HERMES_THEME_METAS: readonly HermesThemeMeta[] = [
  { id: 'hermes-teal', nameKey: 'appearance.theme.hermesTeal', colorScheme: 'dark', swatches: ['#041c1c', '#ffe6cb', '#ffbd38'] },
  { id: 'hermes-nous-blue', nameKey: 'appearance.theme.nousBlue', colorScheme: 'light', swatches: ['#E8F2FD', '#0053FD', '#170d02'] },
  { id: 'hermes-midnight', nameKey: 'appearance.theme.midnight', colorScheme: 'dark', swatches: ['#0a0a1f', '#d4c8ff', '#a78bfa'] },
  { id: 'hermes-ember', nameKey: 'appearance.theme.ember', colorScheme: 'dark', swatches: ['#1a0a06', '#ffd8b0', '#f97316'] },
  { id: 'hermes-mono', nameKey: 'appearance.theme.mono', colorScheme: 'dark', swatches: ['#0e0e0e', '#eaeaea', '#ffffff'] },
  { id: 'hermes-cyberpunk', nameKey: 'appearance.theme.cyberpunk', colorScheme: 'dark', swatches: ['#040608', '#9bffcf', '#00ff88'] },
  { id: 'hermes-rose', nameKey: 'appearance.theme.rose', colorScheme: 'dark', swatches: ['#1a0f15', '#ffd4e1', '#f472b6'] },
  { id: 'hermes-teal-large', nameKey: 'appearance.theme.hermesTealLarge', colorScheme: 'dark', swatches: ['#041c1c', '#ffe6cb', '#ffbd38'] },
]
```

### 5.3 Theme Settings Schema Contract

```typescript
// packages/client/ui-theme/src/theme-settings.ts
import z from '@deepseek-ai/schemastery'

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'
export const THEME_PREFERENCE_FIELD = 'preference'
export const FONT_SIZE_FIELD = 'fontSize'
export type BuiltinThemePreference = typeof THEME_PREFERENCES[number]
export type ThemePreference = string
export const DEFAULT_PREFERENCE: BuiltinThemePreference = 'system'

export interface ThemeSettings {
  preference: ThemePreference
  fontSize: number
}

export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.string().default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(12).max(17).default(14),
})
```

## 6. Lifecycle and Scoping

### 6.1 Application Lifecycle (`apply()`)

The client theme plugin mounts during browser boot via `packages/client/ui-theme/src/client/index.ts:428-478`:

```typescript
export const inject = ['slots', 'locale', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  installThemeStyles(ctx)
  const host = ctx.settingsScope.bind<ThemeSettings>({ namespace: THEME_SETTINGS_NAMESPACE })
  const theme = new ThemeRuntime(ctx, host)
  ctx.provide('theme', theme)

  // Register built-in Hermes themes
  for (const def of HERMES_THEMES) {
    theme.register(def)
  }

  // Register copy dictionaries
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings row dictionaries')

  // Register Appearance and Font Size settings rows into General settings slot
  const store = createAppearanceRowStore()
  let bound: BoundActions<typeof store> | undefined
  const fontSizeStore = createFontSizeRowStore()
  let fontSizeBound: BoundActions<typeof fontSizeStore> | undefined

  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot.preference, snapshot.revision)
    fontSizeBound?.sync(snapshot.fontSize, snapshot.revision)
  }
  ctx.on('theme/change', sync)

  const injected = (actions: BoundActions<typeof store>): AppearanceRowInjected => {
    bound = actions
    sync(theme.getTheme())
    return {
      setTheme: (id) => { theme.setTheme(id) },
    }
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'appearance',
    order: 10,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, AppearanceRow))
}
```

### 6.2 Scoping & Boundary Rules
- **Process Isolation**: Pure client browser execution. Not instantiated on the backend Node/Deno daemon.
- **Session Lifetime**: `ThemeRuntime` is a client singleton persisting across chat session switches. Switching active conversations does not reset the user's theme preference.
- **Disposer Behavior**: Disposing a theme definition via `theme.register()`'s returned disposer checks if `preference === definition.id`. If true, preference safely resets to `DEFAULT_PREFERENCE` (`system`).

## 7. Agent Preset Integration

Client UI packages reside strictly on the **Client Plane** and are loaded into the browser via `packages/bundle/web-app/cordis.patch.yml:243-244` and `packages/client/web/src/client/index.ts`.

```yaml
# packages/bundle/web-app/cordis.patch.yml
- id: ui-theme
  name: '@deepseek-ai/dsh-client-ui-theme'
- id: ui-layout
  name: '@deepseek-ai/dsh-client-ui-layout'
- id: ui-schedule
  name: '@deepseek-ai/dsh-client-ui-schedule'
- id: ui-settings-models
  name: '@deepseek-ai/dsh-client-ui-settings-models'
```

Per `PRESET-RULES.md`, agent presets (`packages/preset/agent-presets/presets/**/*.cordis.yml`) configure the **Agent Plane** (LLM tools, subagents, workflows). Client UI extensions do NOT appear in agent presets and do NOT use agent `isolate` realms.

## 8. Execution Flow

### 8.1 Scenario A: Initial Boot with Persisted Custom Theme (`hermes-teal`)

```
Browser UA                    bootThemeInjection           Cordis Client (ui-theme)         ThemePresenter (ui-layout)
    │                                  │                              │                                  │
    ├───── GET /index.html ───────────►│                              │                                  │
    │◄──── HTML + inline script ───────┤                              │                                  │
    │                                  │                              │                                  │
    ├───── Executes boot script ───────┤                              │                                  │
    │      data-ds-dark-theme = true   │                              │                                  │
    │      color-scheme = 'dark'       │                              │                                  │
    │      (Zero FOUC canvas paints)   │                              │                                  │
    │                                  │                              │                                  │
    ├───── Load Client JS Bundles ───────────────────────────────────►│                                  │
    │                                                                 ├─ theme.register(8 Hermes)        │
    │                                                                 ├─ host.getSnapshot() ('hermes-teal)
    │                                                                 ├─ theme.setTheme('hermes-teal')   │
    │                                                                 ├─ emit('theme/change') ──────────►│
    │                                                                 │                                  ├─ apply(snapshot)
    │                                                                 │                                  ├─ body.style.setProperty(--dsw-alias-*, val)
    │◄──── High-fidelity canvas rendered with Hermes Teal ────────────┴──────────────────────────────────┤
```

### 8.2 Scenario B: User Switches Theme via Settings UI

```
User (Click Swatch)             AppearanceRow               ThemeRuntime               Host SettingsScope        ThemePresenter
    │                                │                           │                             │                       │
    ├─ Click "Midnight" Swatch ─────►│                           │                             │                       │
    │                                ├─ setTheme('hermes-midnight)                             │                       │
    │                                │──────────────────────────►│                             │                       │
    │                                │                           ├─ host.set('preference', id)─►│ (Persists to host)    │
    │                                │                           ├─ buildSnapshot()            │                       │
    │                                │                           ├─ emit('theme/change') ──────┼──────────────────────►│
    │                                │                           │                             │                       ├─ Clear old inline CSS
    │                                │                           │                             │                       ├─ Apply new inline tokens
    │                                │                           │                             │                       ├─ Update theme-color meta
    │                                │◄─ store.sync(revision) ───┤                             │                       │
    │                                ├─ Render active border     │                             │                       │
    │◄─ Immediate smooth transition ─┴───────────────────────────┴─────────────────────────────┴───────────────────────┤
```

## 9. Error, Cancellation, and Lifecycle Behavior

1. **Unregistered Theme Selection**: Calling `theme.setTheme('unknown-id')` immediately throws `Error: theme "unknown-id" is not registered` (`packages/client/ui-theme/src/client/index.ts:233`). State remains unchanged.
2. **Corrupted Persisted Preference**: If Host settings returns an unrecognized preference string (e.g. from an old or invalid config), `ThemeRuntime.adopt()` falls back safely to `DEFAULT_PREFERENCE` (`system`).
3. **Disposal of Active Theme**: If a plugin or extension unregisters the currently active theme via its disposer, `ThemeRuntime` automatically resets preference to `system` and re-emits `theme/change` (`packages/client/ui-theme/src/client/index.ts:285-288`).
4. **Token Fallback**: Any `--dsw-alias-*` token omitted by a custom theme automatically inherits the underlying base stylesheet token from `design-platform.css` (`body` or `body[data-ds-dark-theme]`), preventing broken or invisible elements.
5. **System Scheme Transition**: While preference is set to `'system'`, changes from OS dark/light mode triggers the `matchMedia('(prefers-color-scheme: dark)')` listener and dispatches `theme/change` seamlessly (`packages/client/ui-theme/src/client/index.ts:184-192`).
6. **Reduced Motion**: All theme transition selectors respect `prefers-reduced-motion: reduce`, suppressing transitions per `docs/web-styling.md:22`.

## 10. Testing Strategy

### 10.1 Unit Tests (`packages/client/ui-theme/tests/theme.client.spec.ts`)
- **Theme Catalogue Coverage**: Assert `theme.getTheme().themes` contains exactly 10 definitions (2 built-in + 8 Hermes).
- **Custom Theme Switching**: Assert `theme.setTheme('hermes-teal')` updates `snapshot.active.tokens` with `#041c1c` and calls `host.set('preference', 'hermes-teal')`.
- **Light/Dark Scheme Resolution**: Assert `theme.setTheme('hermes-nous-blue')` switches `colorScheme` to `'light'` while `hermes-midnight` switches to `'dark'`.
- **Safe Disposer Behavior**: Assert disposing `hermes-cyberpunk` while active resets preference to `system` and triggers 3 snapshot publications.

### 10.2 Component & Settings Tests (`packages/client/ui-theme/tests/appearance-row.client.spec.tsx`)
- **Swatch Rendering**: Render `<AppearanceRow />` in `jsdom` environment. Verify that 3 default cubes (`light`, `dark`, `system`) and 8 Hermes theme swatch buttons are rendered.
- **Accessibility Contracts**: Verify each swatch has `role="button"`, `aria-pressed="true"` for the active theme, and accessible label from `t()`.
- **User Interaction**: Simulate click on `hermes-ember` swatch; assert `setTheme('hermes-ember')` is called.

### 10.3 Pre-Plugin Bootstrap Tests (`packages/client/ui-theme/tests/boot-theme.client.spec.ts`)
- **Custom Theme Bootstrap**: Assert `bootThemeInjection('hermes-teal')` outputs an inline script that sets `data-ds-dark-theme` to `true`.
- **Nous Blue Bootstrap**: Assert `bootThemeInjection('hermes-nous-blue')` outputs an inline script that sets `data-ds-dark-theme` to `false`.

### 10.4 Automated Verification Gates
- **i18n AST Linter**: Execute `pnpm run verify-client-ui-i18n`. Must pass with 0 violations. All natural language strings must reside in `src/client/locales.ts`.
- **Coverage Gate**: Execute `pnpm run test:coverage` on `packages/client/ui-theme`. Must achieve 100% statement, line, and branch coverage (`packages/client/AGENTS.md:118-123`).
- **Web Snapshot E2E**: Execute `DSH_SNAPSHOT=replay pnpm run test:web` to ensure zero visual regression on standard Light and Dark modes.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| 8 Canonical Hermes Theme Palettes | `/home/sic/Downloads/hermes-agent-main/web/src/themes/presets.ts:41-240` | 8 canonical palette color triplets (`background`, `midground`, `foreground`), warm glow values, and typography/layout attributes for default teal, midnight, ember, nous-blue, mono, cyberpunk, rose, and teal-large. | Translate Hermes two-layer palette model into DeepSeek Harness `--dsw-alias-*` semantic variables in `packages/client/ui-theme/src/client/hermes-themes.ts`. | direct port |
| Palette & Theme Definitions Types | `/home/sic/Downloads/hermes-agent-main/web/src/themes/types.ts:27-45, 156-186` | `ThemePalette`, `ThemeLayer` structure, color scheme hints (`colorScheme: 'dark' | 'light'`), and metadata types. | Adapt into Harness `ThemeDefinition` interface conforming to `@deepseek-ai/dsh-client-ui-theme` and `ThemeRuntime` contract. | direct port |
| Theme Swatch Picker & Appearance Settings UX | `/home/sic/Downloads/hermes-agent-main/web/src/components/ThemeSwitcher.tsx:27-159, 315-331` | Swatch rendering logic, active state highlighting, 3-stop preview bar layout (`[bg, midground, brand]`), and keyboard navigation. | Rewrite from Tailwind CSS and `@nous-research/ui` into CSS Modules (`AppearanceRow.module.css`) and Harness `@deepseek-ai/dsh-client-ui-primitives` (`Menu`, `Button`); integrate with Host `SettingsScope`. | port with adaptation |
| Interactive Visual Schedule Builder | `/home/sic/Downloads/hermes-agent-main/web/src/components/ScheduleBuilder.tsx:1-120` | Cron/interval mode state machine (`ScheduleBuilderState`), weekday index bitmasks (`WEEKDAY_INDEXES`), and human-friendly schedule builder logic. | Rewrite component into `@deepseek-ai/dsh-client-ui-schedule` using CSS Modules and Harness `ui-primitives` (`Input`, `Select`), replacing `@nous-research/ui` controls. | port with adaptation |
| Model Capability & Telemetry Card | `/home/sic/Downloads/hermes-agent-main/web/src/components/ModelInfoCard.tsx:1-85` | Layout and metrics display structure (token counts, reasoning capabilities, vision/tools flags, context window sizes). | Reimplement in `@deepseek-ai/dsh-client-ui-settings-models` (`CustomProviderCard.tsx`) using CSS Modules and Harness primitives, removing `lucide-react` icons. | reference only |
| Curated UI Font Family Selection | `/home/sic/Downloads/hermes-agent-main/web/src/themes/fonts.ts:22-85` | Vetted font catalog (`FONT_CHOICES`), system fallback stacks (`SYSTEM_SANS`, `SYSTEM_MONO`, `SYSTEM_SERIF`), and font family IDs. | Integrate into `packages/client/ui-theme/src/client/FontFamilyRow.tsx` modifying `--dsw-font-family` alongside the existing font-size slider. | port with adaptation |
| Durable Custom Theme Persistence & FOUC Prevention | no Hermes equivalent — new code | N/A (Hermes uses client-side localStorage/cookies for web dashboard theme switching, whereas Harness coordinates durable settings via Cordis Host `SettingsScope` and pre-hydration inline scripts). | Relax `ThemeSettingsSchema` in `packages/client/ui-theme/src/theme-settings.ts` to allow string theme IDs, and update `bootThemeScript` in `src/boot-theme.ts` to evaluate base color scheme pre-hydration. | no Hermes equivalent (new code) |

The single most valuable capability to port is the mathematical 8-palette token dictionary and swatch preview metadata (`web/src/themes/presets.ts:41-240`). Rather than re-engineering color contrast ratios, dark-room luminescence, and accent hierarchies from scratch, porting Hermes's battle-tested palette stops (`background`, `midground`, and `warmGlow`) directly onto Harness `--dsw-alias-*` tokens immediately gives the workspace its signature terminal-aesthetic identity while preserving full WCAG AAA legibility.

## 11. Implementation Steps

1. **Phase 1: Settings Schema & Bootstrap Core Adjustment (`packages/client/ui-theme`)**:
   - Update `packages/client/ui-theme/src/theme-settings.ts` to allow `string` in `ThemeSettingsSchema[THEME_PREFERENCE_FIELD]`.
   - Update `packages/client/ui-theme/src/boot-theme.ts` to determine base color scheme for custom themes (`nous-blue` is light; all other Hermes themes are dark).
   - Update `packages/client/ui-theme/src/index.ts` re-exports.
2. **Phase 2: Hermes Theme Definitions (`packages/client/ui-theme`)**:
   - Create `packages/client/ui-theme/src/client/hermes-themes.ts` implementing the 8 theme definitions and metadata array.
   - Verify all `--dsw-alias-*` token overrides against `design-platform.css`.
3. **Phase 3: Runtime Registration & Persistence (`packages/client/ui-theme`)**:
   - In `packages/client/ui-theme/src/client/index.ts`:
     - Register `HERMES_THEMES` inside `apply()`.
     - Update `ThemeRuntime.setTheme()` to call `this.host.set(THEME_PREFERENCE_FIELD, id)` for any valid registered theme ID.
4. **Phase 4: Appearance Settings Row & i18n (`packages/client/ui-theme`)**:
   - Update `packages/client/ui-theme/src/client/locales.ts`: add `appearance.themeSelect` and all 8 theme names in `zh` and `en`.
   - Update `packages/client/ui-theme/src/client/AppearanceRow.tsx`: add theme swatch strip displaying 3-stop color preview boxes.
   - Update `packages/client/ui-theme/src/client/AppearanceRow.module.css`: add swatch styles, hairline borders, and focus rings.
5. **Phase 5: Component Ports (`ui-schedule` & `ui-settings-models`)**:
   - Rewrite Hermes `ScheduleBuilder.tsx` in `packages/client/ui-schedule/src/client/` using CSS Modules and `ui-primitives`.
   - Rewrite Hermes `ModelInfoCard.tsx` in `packages/client/ui-settings-models/src/client/CustomProviderCard.tsx`.
6. **Phase 6: Verification & Test Ladder**:
   - Update existing unit tests in `theme.client.spec.ts` and `boot-theme.client.spec.ts`.
   - Add component tests in `appearance-row.client.spec.tsx`.
   - Run `pnpm run verify-client-ui-i18n` and ensure zero violations.
   - Run `pnpm run test:coverage` and assert 100% coverage.

## 12. Acceptance Criteria

1. **Theme Catalogue Availability**: Calling `theme.getTheme().themes` returns 10 registered themes (2 built-in + 8 Hermes presets).
2. **Mathematical Token Translation**: Selecting any of the 8 Hermes themes applies the exact `--dsw-alias-*` token overrides specified in Section 5.1 as inline styles on `document.body`.
3. **Durable Preference Persistence**: Selecting a Hermes theme calls `host.set('preference', id)`, persisting the choice in the Host user-settings document across browser reloads.
4. **FOUC Prevention on Boot**: `bootThemeInjection` embeds an inline script that correctly evaluates the custom theme's base color scheme (`data-ds-dark-theme`), preventing unstyled white flashes on page refresh.
5. **Interactive Swatch Selector**: The Appearance settings row renders 3-stop preview swatches (`[bg, midground, brand]`) for each Hermes theme with full keyboard accessibility and active indicators.
6. **Strict AST i18n Verification**: `pnpm run verify-client-ui-i18n` passes with 0 violations. All text strings are extracted into `locales.ts`.
7. **100% Test Coverage**: All new and modified code in `packages/client/ui-theme` achieves 100% statement, branch, and line test coverage under `vitest`.
8. **Zero Regression Safety**: Existing users with `'light'`, `'dark'`, or `'system'` preferences experience zero visual or functional regressions; standard `--dsw-*` tokens remain completely unchanged.
9. **Origin & Licensing Attribution**: `hermes-themes.ts` carries header attribution acknowledging Nous Research Hermes Agent under MIT / Apache-2.0.

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`web/src/themes/presets.ts`, `types.ts`, `fonts.ts`, `ThemeSwitcher.tsx`, `ScheduleBuilder.tsx`, and `ModelInfoCard.tsx`) to accelerate UI theme and presentation component adoption.
