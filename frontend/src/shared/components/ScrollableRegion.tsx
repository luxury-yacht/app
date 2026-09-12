import type { ComponentPropsWithRef } from 'react';

type ScrollableRegionProps = ComponentPropsWithRef<'section'> & {
  'aria-label': string;
};

/** A named viewport that can receive focus for native keyboard scrolling. */
export default function ScrollableRegion({ tabIndex = 0, ...props }: ScrollableRegionProps) {
  return <section {...props} tabIndex={tabIndex} />;
}
