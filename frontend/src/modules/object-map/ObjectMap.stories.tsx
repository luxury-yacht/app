/**
 * frontend/src/modules/object-map/ObjectMap.stories.tsx
 *
 * Storybook stories for the ObjectMap component, including large fixtures
 * used for manual G6 renderer performance checks.
 */

import type { Meta, StoryObj } from '@storybook/react';
import ObjectMap from './ObjectMap';
import { createObjectMapPerformanceFixture } from './objectMapPerformanceFixtures';

const fiveHundredNodeFixture = createObjectMapPerformanceFixture({
  nodeCount: 500,
  edgeCount: 1000,
});

const thousandNodeFixture = createObjectMapPerformanceFixture({
  nodeCount: 1000,
  edgeCount: 2000,
});

const ObjectMapStoryShell = ({ children }: { children: React.ReactNode }) => (
  <div className="object-map-story-shell">{children}</div>
);

const meta: Meta<typeof ObjectMap> = {
  title: 'Views/ObjectMap',
  component: ObjectMap,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof ObjectMap>;

/** 500 nodes and 1,000 edges. */
export const FiveHundredNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={fiveHundredNodeFixture} />
    </ObjectMapStoryShell>
  ),
};

/** 1,000 nodes and 2,000 edges. */
export const ThousandNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={thousandNodeFixture} />
    </ObjectMapStoryShell>
  ),
};
