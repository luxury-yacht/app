---
name: new-story
description: Generate a Storybook story for a component using real components and project CSS classes
---

# New Story

Generate a Storybook story for a given component.

## Arguments

`/new-story <ComponentPath>` — path to the component (e.g. `frontend/src/ui/modals/MyModal.tsx`)

## Rules

1. **Use real components.** Import and render the actual component. Never approximate with inline styles.
2. **Use real CSS classes.** If you need wrapper markup, use the project's actual CSS classes — never inline styles that mimic them.
3. **Mock only data, not rendering.** Mock Go backend calls via `window.__storybookGoOverrides`, mock props with realistic data. Never mock the component's visual output.
4. **Trace ALL hook dependencies before writing.** Read the component and every hook it uses. Identify which providers are needed. Don't discover them one crash at a time.
5. **Use existing decorators.** Check `frontend/.storybook/decorators/` for providers:
   - `SidebarProvidersDecorator` — KubeconfigProvider + NamespaceProvider
   - `ThemeProviderDecorator` — theme context
   - `KeyboardProviderDecorator` — keyboard shortcuts
   - `KubeconfigProviderDecorator` — kubeconfig only
   - `ZoomProviderDecorator` — zoom context
6. **Use existing mocks.** Check `frontend/.storybook/mocks/` for Go backend mocks (`wailsBackendApp.ts`, `wailsBackendSettings.ts`, `wailsModels.ts`).
7. **Story file location.** Place the `.stories.tsx` file next to the component it tests.
8. **Multiple stories per file.** Create stories for the main states: default, loading, error, empty, and any interesting prop variations.

## Template

```tsx
/**
 * <file path>
 *
 * Storybook stories for the <ComponentName> component.
 */

import type { Meta, StoryObj } from '@storybook/react';
import <ComponentName> from './<ComponentName>';
// import decorators as needed

const meta: Meta<typeof <ComponentName>> = {
  title: '<Category>/<ComponentName>',
  component: <ComponentName>,
  // decorators: [SidebarProvidersDecorator],
};

export default meta;
type Story = StoryObj<typeof <ComponentName>>;

/** Default state. */
export const Default: Story = {
  args: {
    // realistic props
  },
};
```

## Verification

After creating the story, run `npx tsc --noEmit` from the `frontend/` directory to confirm it compiles without errors.
