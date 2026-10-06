---
name: new-story
description: Generate a Storybook story for a component using real components and project CSS classes
---

# New Story

`/new-story <ComponentPath>` (e.g. `frontend/src/ui/modals/MyModal.tsx`)
creates `<ComponentName>.stories.tsx` next to the component.

## Rules

1. Render the real component. Wrapper markup uses the project's real CSS
   classes; never approximate with inline styles.
2. Mock only data, never rendering: realistic props, and Go backend calls via
   `window.__storybookBackendOverrides` (installed by `frontend/.storybook/preview.ts`).
3. Before writing, read the component and every hook it uses to list the
   providers it needs instead of discovering them one crash at a time.
4. Reuse `frontend/.storybook/decorators/`: `SidebarProvidersDecorator`
   (Kubeconfig + Namespace providers), `AppearanceModeProviderDecorator`,
   `KeyboardProviderDecorator`, `KubeconfigProviderDecorator`,
   `ZoomProviderDecorator`.
5. Reuse backend mocks in `frontend/.storybook/mocks/` (`wailsBackendApp.ts`,
   `wailsBackendSettings.ts`).
6. Behavior and appearance changes belong in production code; stories only
   verify them.
7. Cover the main states: default, loading, error, empty, and notable prop
   variations.

## Template

```tsx
/**
 * <file path>
 *
 * Storybook stories for the <ComponentName> component.
 */

import type { Meta, StoryObj } from '@storybook/react';
import <ComponentName> from './<ComponentName>';

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

Run `mise exec -- npm run typecheck --prefix frontend`.
