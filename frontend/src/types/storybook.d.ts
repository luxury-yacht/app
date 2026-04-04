/**
 * frontend/src/types/storybook.d.ts
 *
 * Ambient type declarations for @storybook/react.
 * Provides minimal type stubs so that story files and storybook decorators
 * pass type-checking without requiring the full @storybook/react package
 * to be installed (it is an optional devDependency).
 */

declare module '@storybook/react' {
  import type { ComponentType, ReactNode } from 'react';

  export type Decorator<TArgs = any> = (
    Story: ComponentType,
    context?: { args: TArgs }
  ) => ReactNode;

  export interface Meta<T = any> {
    title?: string;
    component?: T;
    decorators?: Decorator[];
    args?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export type StoryObj<T = any> = {
    args?: Partial<T extends ComponentType<infer P> ? P : Record<string, unknown>>;
    decorators?: Decorator[];
    [key: string]: unknown;
  };
}
