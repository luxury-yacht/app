/**
 * frontend/src/modules/object-map/ObjectMap.stories.tsx
 *
 * Storybook stories for the ObjectMap component, including large fixtures
 * used to compare SVG and G6 renderer behavior during manual performance checks.
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

/** G6 renderer with 500 nodes and 1,000 edges. */
export const G6FiveHundredNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={fiveHundredNodeFixture} rendererKind="g6" />
    </ObjectMapStoryShell>
  ),
};

/** SVG renderer with 500 nodes and 1,000 edges, for side-by-side comparison. */
export const SvgFiveHundredNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={fiveHundredNodeFixture} rendererKind="svg" />
    </ObjectMapStoryShell>
  ),
};

/** G6 renderer with 1,000 nodes and 2,000 edges. */
export const G6ThousandNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={thousandNodeFixture} rendererKind="g6" />
    </ObjectMapStoryShell>
  ),
};
