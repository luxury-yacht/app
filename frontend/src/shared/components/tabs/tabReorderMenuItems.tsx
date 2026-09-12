import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { ShortcutArrowIcon } from '@shared/components/icons/SharedIcons';

export const tabReorderMenuItems = (
  ids: string[],
  id: string,
  onReorder: (newIndex: number) => void
): ContextMenuItem[] => {
  const index = ids.indexOf(id);
  if (index < 0) {
    return [];
  }
  return [-1, 1]
    .filter((direction) => index + direction >= 0 && index + direction < ids.length)
    .map((direction) => ({
      label: direction < 0 ? 'Move tab left' : 'Move tab right',
      icon: (
        <ShortcutArrowIcon direction={direction < 0 ? 'left' : 'right'} width={16} height={16} />
      ),
      onClick: () => onReorder(index + direction),
    }));
};
