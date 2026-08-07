import type { ComponentPropsWithRef } from 'react';

export type ListboxOptionButtonProps = ComponentPropsWithRef<'button'> & {
  selected: boolean;
};

const listboxOptionAttributes = (selected: boolean) => ({
  'aria-selected': selected,
  role: 'option' as const,
  tabIndex: -1,
});

/**
 * A listbox option that retains native button activation for rich custom
 * options that cannot be represented by an HTML option element.
 */
export const ListboxOptionButton = ({
  selected,
  type = 'button',
  ref,
  ...props
}: ListboxOptionButtonProps) => (
  <button ref={ref} type={type} {...props} {...listboxOptionAttributes(selected)} />
);
