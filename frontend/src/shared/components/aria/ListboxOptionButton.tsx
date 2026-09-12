import type { ComponentPropsWithRef } from 'react';

export type ListboxOptionButtonProps = ComponentPropsWithRef<'button'> & {
  selected: boolean;
};

const listboxOptionAttributes = (selected: boolean, tabIndex: number) => ({
  'aria-selected': selected,
  role: 'option' as const,
  tabIndex,
});

/**
 * A listbox option that retains native button activation for rich custom
 * options that cannot be represented by an HTML option element.
 */
export const ListboxOptionButton = ({
  selected,
  type = 'button',
  tabIndex = -1,
  ref,
  ...props
}: ListboxOptionButtonProps) => (
  <button ref={ref} type={type} {...props} {...listboxOptionAttributes(selected, tabIndex)} />
);
