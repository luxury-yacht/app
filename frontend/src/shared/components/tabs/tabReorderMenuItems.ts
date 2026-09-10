import type { ContextMenuItem } from '@shared/components/ContextMenu';

export const tabReorderMenuItems = (
  ids: string[],
  id: string,
  onReorder: (newIndex: number) => void
): ContextMenuItem[] => {
  const index = ids.indexOf(id);
  return [-1, 1].map((direction) => ({
    label: direction < 0 ? 'Move tab left' : 'Move tab right',
    disabled: index < 0 || index + direction < 0 || index + direction >= ids.length,
    onClick: () => onReorder(index + direction),
  }));
};
