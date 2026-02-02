# Luxury Yacht UI Design Improvement Plan

> **Status**: Phase 4 Complete (Brand & Delight)
> **Created**: 2026-02-02
> **Last Updated**: 2026-02-02
> **Goal**: Transform Luxury Yacht from a generic enterprise tool into a distinctive, premium Kubernetes management experience

---

## Executive Summary

Luxury Yacht is a well-built, functional application with a comprehensive design token system and proper light/dark theming. However, the current UI is visually indistinguishable from any other admin dashboard—it uses Bootstrap-default colors, system fonts, and minimal animation. For an app named "Luxury Yacht," users should feel something premium when they use it.

This plan outlines a phased approach to elevate the design while maintaining stability and usability.

---

## Current State Assessment

### What Works Well

- Comprehensive CSS variable system (350+ design tokens)
- Proper light/dark theme implementation
- Functional component library (GridTable, modals, badges)
- Good accessibility foundation (keyboard navigation, focus states)
- Dockable/resizable panels
- Modal animations show capability for better motion

### Critical Issues

| Area         | Problem                               | Impact                         |
| ------------ | ------------------------------------- | ------------------------------ |
| Typography   | System fonts only                     | No brand identity              |
| Colors       | Bootstrap defaults (#007bff, #f8f9fa) | Forgettable, generic           |
| Motion       | Basic fades only                      | No delight, static feel        |
| Brand        | Zero nautical/luxury elements         | Name doesn't match experience  |
| Depth        | Flat design throughout                | No visual hierarchy            |
| Empty States | Plain text only                       | Missed personality opportunity |

---

## Design Direction

### Chosen Aesthetic: **Modern Nautical Luxury**

A refined, dark-mode-first design that evokes premium yacht instrumentation:

- **Deep navy** as the foundation
- **Gold/amber accents** for premium feel
- **Crisp whites and teals** for data clarity
- **Subtle depth** through shadows and layering
- **Purposeful motion** that feels smooth and controlled

This direction:

1. Connects to the "Luxury Yacht" brand
2. Works well for data-dense interfaces (dark backgrounds reduce eye strain)
3. Differentiates from competitors (Lens, k9s, Rancher)
4. Maintains professional credibility while adding character

---

## Phase 1: Foundation (Typography & Color)

### 1.1 Typography System

**Current:**

```css
--font-family-base:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto... --font-family-mono: 'SF Mono', Monaco,
  'Cascadia Code'...;
```

**Approach: Web Fonts with Graceful Fallbacks**

Since Wails uses a WebView, we can load web fonts from Google Fonts. If the user is offline or the CDN is unreachable, the system font fallbacks provide a fully functional experience. The `display=swap` parameter ensures text renders immediately with fallbacks, then swaps when the web font loads—no flash of invisible text.

**Font Loading (in index.html or CSS):**

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

**Proposed Font Stacks:**

```css
/* Display font for headers, branding, titles */
/* Falls back to system fonts if Google Fonts unavailable */
--font-family-display:
  'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

/* Body font - keep system fonts for optimal native rendering */
--font-family-base:
  -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;

/* Monospace - JetBrains Mono adds character, with solid fallbacks */
--font-family-mono:
  'JetBrains Mono', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
```

**Rationale:**

- **Display font (Plus Jakarta Sans)**: Only used for headers/titles, so minimal impact if it doesn't load. Geometric, modern, premium feel.
- **Body font (system)**: Keep system fonts for body text—they render optimally on each OS and are always available.
- **Mono font (JetBrains Mono)**: Popular developer font with excellent readability for YAML/code. Falls back to platform-native mono fonts.

**Implementation:**

- [ ] Add Google Fonts preconnect and stylesheet link to `index.html`
- [ ] Update `typography.css` with new font stacks
- [ ] Apply display font to: app title, modal headers, section headers, empty state titles
- [ ] Keep system fonts for body text (data tables, sidebar items, form labels)
- [ ] Test offline behavior to ensure fallbacks work correctly

**Files to modify:**

- `frontend/index.html` (font imports)
- `frontend/styles/tokens/typography.css`
- `frontend/src/ui/layout/AppHeader.css`
- `frontend/src/components/modals/modals.css`

---

### 1.2 Color Palette

**Current (Light):**

```css
--color-bg: #ffffff --color-accent: #007bff /* Bootstrap blue */;
```

**Proposed Brand Palette:**

```css
/* === NAUTICAL LUXURY PALETTE === */

/* Primary: Deep Navy */
--color-navy-950: #0a0f1a;
--color-navy-900: #0f172a;
--color-navy-800: #1e293b;
--color-navy-700: #334155;
--color-navy-600: #475569;
--color-navy-500: #64748b;

/* Accent: Gold/Amber */
--color-gold-500: #f59e0b;
--color-gold-400: #fbbf24;
--color-gold-300: #fcd34d;
--color-gold-600: #d97706;

/* Secondary: Ocean Teal */
--color-teal-500: #14b8a6;
--color-teal-400: #2dd4bf;
--color-teal-600: #0d9488;

/* Semantic: Status Colors */
--color-success: #22c55e;
--color-warning: #f59e0b;
--color-error: #ef4444;
--color-info: #0ea5e9;

/* Neutrals */
--color-slate-50: #f8fafc;
--color-slate-100: #f1f5f9;
--color-slate-200: #e2e8f0;
--color-slate-300: #cbd5e1;
--color-slate-400: #94a3b8;
```

**Dark Theme (Primary):**

```css
:root {
  --color-bg: var(--color-navy-900);
  --color-bg-secondary: var(--color-navy-800);
  --color-bg-tertiary: var(--color-navy-700);
  --color-text: var(--color-slate-100);
  --color-text-secondary: var(--color-slate-400);
  --color-accent: var(--color-gold-500);
  --color-accent-hover: var(--color-gold-400);
}
```

**Light Theme (Secondary):**

```css
[data-theme='light'] {
  --color-bg: var(--color-slate-50);
  --color-bg-secondary: #ffffff;
  --color-bg-tertiary: var(--color-slate-100);
  --color-text: var(--color-navy-900);
  --color-text-secondary: var(--color-navy-600);
  --color-accent: var(--color-teal-600);
  --color-accent-hover: var(--color-teal-500);
}
```

**Implementation:**

- [ ] Create new `frontend/styles/tokens/colors.css` with full palette
- [ ] Update `frontend/styles/themes/dark.css` as new default
- [ ] Update `frontend/styles/themes/light.css` with refined palette
- [ ] Update badge colors to use new palette
- [ ] Update button colors for premium feel

**Files to modify:**

- `frontend/styles/tokens/` (new colors.css)
- `frontend/styles/themes/dark.css`
- `frontend/styles/themes/light.css`
- `frontend/styles/components/badges.css`
- `frontend/styles/components/buttons.css`

---

## Phase 2: Motion & Interaction

### 2.1 Animation System

**Current animations are basic fades. Add orchestrated motion.**

**New Keyframes:**

```css
/* Staggered list reveal */
@keyframes staggerFadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Subtle scale on hover */
@keyframes subtleLift {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-2px);
  }
}

/* Shimmer loading effect */
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* Smooth pulse for active states */
@keyframes smoothPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
```

**Implementation:**

- [ ] Add staggered animation to sidebar items on load
- [ ] Add staggered animation to table rows on data load
- [ ] Add hover lift effect to badges and buttons
- [ ] Add shimmer loading skeletons for tables
- [ ] Add smooth transitions to all interactive elements

**Files to modify:**

- `frontend/styles/utilities/motion.css`
- `frontend/src/ui/layout/Sidebar.css`
- `frontend/styles/components/gridtables.css`
- `frontend/styles/components/badges.css`
- `frontend/styles/components/buttons.css`

---

### 2.2 Micro-interactions

**Button States:**

```css
.button {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.button:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
```

**Badge Hover:**

```css
.kind-badge.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
```

**Table Row Hover:**

```css
.gridtable-row {
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;
}

.gridtable-row:hover {
  background-color: var(--color-bg-tertiary);
  /* Subtle left border accent */
}
```

**Implementation:**

- [ ] Add lift effect to primary buttons
- [ ] Add scale effect to clickable badges
- [ ] Add left-accent border on table row hover
- [ ] Add smooth focus ring animations
- [ ] Add ripple effect consideration for buttons (optional)

---

## Phase 3: Component Refinement

### 3.1 Buttons

**Current:** Flat, minimal, forgettable
**Target:** Substantial, premium feel

```css
.button {
  padding: 0.5rem 1rem; /* More generous */
  font-size: 0.8125rem;
  font-weight: 500;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.button.primary {
  background: linear-gradient(135deg, var(--color-gold-500) 0%, var(--color-gold-600) 100%);
  color: var(--color-navy-900);
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.button.primary:hover {
  background: linear-gradient(135deg, var(--color-gold-400) 0%, var(--color-gold-500) 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}
```

**Implementation:**

- [ ] Increase button padding for more presence
- [ ] Add subtle gradients to primary buttons
- [ ] Add inset highlight for depth
- [ ] Improve disabled state styling
- [ ] Add loading state with spinner

---

### 3.2 Badges

**Current:** Muted pastels, all similar
**Target:** Clear differentiation, premium feel

```css
.kind-badge {
  padding: 0.25rem 0.625rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

/* More vibrant, differentiated colors */
.kind-badge.deployment {
  background-color: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.3);
}

.kind-badge.pod {
  background-color: rgba(168, 85, 247, 0.15);
  color: #a855f7;
  border-color: rgba(168, 85, 247, 0.3);
}

.kind-badge.service {
  background-color: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
}
```

**Implementation:**

- [ ] Add subtle border to badges for definition
- [ ] Increase color saturation for better differentiation
- [ ] Add letter-spacing for premium feel
- [ ] Ensure dark mode contrast

---

### 3.3 Tables (GridTable)

**Current:** Dense, utilitarian
**Target:** Scannable, refined

**Improvements:**

```css
.gridtable-header {
  background: linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg-tertiary) 100%);
  border-bottom: 2px solid var(--color-border);
}

.grid-cell-header {
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
}

.gridtable-row {
  border-left: 3px solid transparent;
  transition: all 0.15s ease;
}

.gridtable-row:hover {
  border-left-color: var(--color-accent);
  background-color: var(--color-bg-secondary);
}

.gridtable-row.selected {
  border-left-color: var(--color-gold-500);
  background-color: rgba(245, 158, 11, 0.1);
}
```

**Implementation:**

- [ ] Add gradient to table headers
- [ ] Add left accent border on hover/select
- [ ] Improve row spacing slightly
- [ ] Add staggered load animation for rows
- [ ] Add skeleton loading state

---

### 3.4 Sidebar

**Current:** Basic list
**Target:** Polished navigation

```css
.sidebar {
  background: linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg) 100%);
}

.sidebar-item {
  border-radius: 6px;
  transition: all 0.15s ease;
  position: relative;
}

.sidebar-item.active {
  background: linear-gradient(90deg, var(--color-accent) 0%, transparent 100%);
  color: var(--color-text);
}

.sidebar-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-gold-500);
  border-radius: 0 2px 2px 0;
}
```

**Implementation:**

- [ ] Add subtle gradient to active state
- [ ] Add left accent indicator
- [ ] Improve section header styling
- [ ] Add collapse animation refinement
- [ ] Add stagger animation on initial load

---

### 3.5 Modals

**Current:** Best component (good shadows, bounce animation)
**Target:** Polish further

**Improvements:**

```css
.modal-container {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.05),
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 100px -20px rgba(245, 158, 11, 0.15); /* Subtle gold glow */
}

.modal-header {
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg) 100%);
}

.modal-header h2 {
  font-family: var(--font-family-display);
  font-weight: 700;
  letter-spacing: -0.02em;
}
```

**Implementation:**

- [ ] Add subtle accent glow to modal shadow
- [ ] Apply display font to modal titles
- [ ] Improve header gradient
- [ ] Add backdrop blur refinement

---

### 3.6 Command Palette

**Current:** Good foundation
**Target:** Premium spotlight feel

```css
.command-palette {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
}

.command-palette-input {
  font-size: 1rem;
  padding: 1rem;
  background: transparent;
  border-bottom: 1px solid var(--color-border);
}

.command-palette-item.selected {
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.15) 0%, transparent 100%);
}
```

**Implementation:**

- [ ] Add backdrop blur
- [ ] Increase input prominence
- [ ] Improve selected state styling
- [ ] Add keyboard hint styling refinement

---

## Phase 4: Brand & Delight

### 4.1 App Header

**Add subtle branding elements:**

```css
.app-header {
  background: linear-gradient(90deg, var(--color-navy-900) 0%, var(--color-navy-800) 100%);
  border-bottom: 1px solid rgba(245, 158, 11, 0.2); /* Gold accent line */
}

.app-header-title {
  font-family: var(--font-family-display);
  font-weight: 700;
  letter-spacing: -0.01em;
}
```

**Implementation:**

- [ ] Add gradient background
- [ ] Add subtle gold accent border
- [ ] Apply display font to title
- [ ] Consider subtle logo treatment

---

### 4.2 Empty States

**Current:** Plain text
**Target:** Personality + helpfulness

**Create illustrated empty states for:**

- No clusters connected
- No resources found
- No logs available
- No events

**Implementation:**

- [ ] Design simple line illustrations (nautical theme optional)
- [ ] Add helpful action buttons
- [ ] Include keyboard shortcut hints
- [ ] Add subtle animations

---

### 4.3 Loading States

**Current:** Basic spinner
**Target:** Polished skeleton loading

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-secondary) 0%,
    var(--color-bg-tertiary) 50%,
    var(--color-bg-secondary) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}
```

**Implementation:**

- [ ] Create skeleton components for tables
- [ ] Create skeleton for sidebar
- [ ] Create skeleton for object panel
- [ ] Ensure smooth transition to loaded content

---

### 4.4 Focus States

**Improve keyboard navigation visibility:**

```css
:focus-visible {
  outline: 2px solid var(--color-gold-500);
  outline-offset: 2px;
}

.sidebar-item:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-gold-500);
}
```

**Implementation:**

- [ ] Add consistent focus ring to all interactive elements
- [ ] Use accent color for focus states
- [ ] Ensure sufficient contrast

---

## Phase 5: Polish & Details

### 5.1 Scrollbars

```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-navy-600);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-navy-500);
}
```

---

### 5.2 Tooltips

Add refined tooltip styling with subtle animation.

---

### 5.3 Context Menus

Match the premium feel with proper shadows and animations.

---

## Implementation Checklist

### Phase 1: Foundation

- [x] Add Google Fonts preconnect and stylesheet link to index.html (Plus Jakarta Sans, JetBrains Mono) ✅
- [x] Update typography.css with new font stacks (web fonts + fallbacks) ✅
- [ ] Test offline behavior to ensure system font fallbacks work
- [x] Create colors.css with full palette ✅
- [x] Update dark.css as new default theme ✅
- [x] Update light.css with refined colors ✅
- [x] Update badge colors (in theme files) ✅
- [x] Update button colors (in theme files) ✅

### Phase 2: Motion

- [x] Add new keyframes to motion.css ✅
- [x] Add stagger animation CSS to sidebar (`.animate-items` class ready) ✅
- [x] Add stagger animation CSS to tables (`.gridtable-animate-rows` class ready) ✅
- [x] Add hover effects to buttons (lift + color-specific shadows) ✅
- [x] Add hover effects to badges (scale on clickable badges) ✅
- [x] Add loading skeleton component (CSS utility classes) ✅
- [x] Add left-accent border on table row hover/focus ✅
- [x] Add left-accent border on sidebar item hover ✅
- [x] Add `prefers-reduced-motion` support ✅

**Note:** Stagger animations are CSS-ready. To enable them, add the `.animate-items` class to `.cluster-items` or `.gridtable-animate-rows` class to table containers in the React components.

### Phase 3: Components

- [x] Refine button styles (already refined in Phase 2 with lift effects) ✅
- [x] Refine badge styles (already refined in Phase 2 with scale effects) ✅
- [x] Refine table styles (gradient header, letter-spacing, transparent cells) ✅
- [x] Refine sidebar styles (display font on headers, gradient active state) ✅
- [x] Refine modal styles (display font, header gradient, close button animation, button lift) ✅
- [x] Refine command palette styles (entry animation, gradient selected state, kbd styling) ✅
- [x] Update app header styling (gradient background, display font, accent border) ✅

### Phase 4: Brand & Delight

- [x] Update app header styling (moved to Phase 3) ✅
- [x] Create empty state designs (new `empty-states.css` with animation, icon, variants) ✅
- [x] Create loading skeletons (CSS utility classes in `motion.css`: `.skeleton`, `.skeleton-text`, `.skeleton-row`) ✅
- [x] Improve focus states (new `focus.css` with consistent accent-colored focus rings) ✅
- [x] Add focus states to dropdowns (highlighted border, input glow) ✅
- [x] Add focus states to inputs (accent border + glow) ✅

### Phase 5: Polish

- [ ] Refine scrollbar styling
- [ ] Add tooltip styling
- [ ] Refine context menu styling
- [ ] Final accessibility review
- [ ] Cross-browser testing

---

## Success Metrics

1. **Visual Distinction**: App is immediately recognizable, not generic
2. **Premium Feel**: Interactions feel smooth and intentional
3. **Brand Alignment**: "Luxury Yacht" name matches the experience
4. **Usability Maintained**: No regression in functionality or accessibility
5. **Performance**: No perceptible lag from animations

---

## Risk Mitigation

1. **All changes are CSS-only** - No React component refactoring required
2. **Phased approach** - Can stop at any phase with a coherent design
3. **Design tokens** - Changes propagate through existing variable system
4. **Dark mode first** - Primary use case optimized first
5. **Reversible** - Git history allows easy rollback
6. **Font fallbacks** - Web fonts gracefully degrade to system fonts when offline or CDN unavailable; app remains fully functional

---

## Timeline Estimate

| Phase   | Scope                | Complexity |
| ------- | -------------------- | ---------- |
| Phase 1 | Typography & Color   | Low        |
| Phase 2 | Motion & Interaction | Medium     |
| Phase 3 | Component Refinement | Medium     |
| Phase 4 | Brand & Delight      | Medium     |
| Phase 5 | Polish & Details     | Low        |

---

## Appendix: Color Reference

### Full Palette

```css
/* Navy (Primary Background) */
--color-navy-950: #0a0f1a;
--color-navy-900: #0f172a;
--color-navy-800: #1e293b;
--color-navy-700: #334155;
--color-navy-600: #475569;
--color-navy-500: #64748b;

/* Gold (Primary Accent) */
--color-gold-600: #d97706;
--color-gold-500: #f59e0b;
--color-gold-400: #fbbf24;
--color-gold-300: #fcd34d;

/* Teal (Secondary Accent) */
--color-teal-600: #0d9488;
--color-teal-500: #14b8a6;
--color-teal-400: #2dd4bf;

/* Slate (Neutrals) */
--color-slate-50: #f8fafc;
--color-slate-100: #f1f5f9;
--color-slate-200: #e2e8f0;
--color-slate-300: #cbd5e1;
--color-slate-400: #94a3b8;

/* Semantic */
--color-success: #22c55e;
--color-warning: #f59e0b;
--color-error: #ef4444;
--color-info: #0ea5e9;
```

### Badge Color Mapping

| Resource   | Color  | Hex     |
| ---------- | ------ | ------- |
| Deployment | Blue   | #3b82f6 |
| Pod        | Purple | #a855f7 |
| Service    | Green  | #22c55e |
| ConfigMap  | Cyan   | #06b6d4 |
| Secret     | Pink   | #ec4899 |
| Node       | Lime   | #84cc16 |
| Namespace  | Teal   | #14b8a6 |
| Job        | Orange | #f97316 |
| CronJob    | Amber  | #f59e0b |
| Event      | Slate  | #64748b |
