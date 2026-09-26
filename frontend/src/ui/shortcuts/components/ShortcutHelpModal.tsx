/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx
 *
 * Keyboard shortcut help: a category sidebar and a filterable list of the
 * shortcuts registered for the focused view.
 */

import { CategoryIcon, ShortcutArrowIcon } from '@shared/components/icons/SharedIcons';
import SearchInput from '@shared/components/inputs/SearchInput';
import ModalHeader from '@shared/components/modals/ModalHeader';
import {
  handleModalSidebarKeyDown,
  ModalSidebarNav,
  type ModalSidebarNavItem,
} from '@shared/components/modals/ModalSidebarNav';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { useModalPresence } from '@shared/components/modals/useModalPresence';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ShortcutHelpRow, ShortcutModifiers } from '@/types/shortcuts';
import { useKeyboardContext } from '../context';
import { buildShortcutHelpRows } from '../shortcutHelp';
import { getShortcutKey, isInputElement } from '../utils';
import './ShortcutHelpModal.css';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Binding = ShortcutHelpRow['bindings'][number];
type ModifierName = keyof ShortcutModifiers;
type CategoryId = 'all' | `category:${string}`;

interface HelpSection {
  category: string;
  rows: ShortcutHelpRow[];
}

const ALL_CATEGORIES: CategoryId = 'all';
const categoryId = (category: string): CategoryId => `category:${category}`;

const MODIFIER_KEYCAPS: Array<{
  modifier: ModifierName;
  macLabel: string;
  defaultLabel: string;
}> = [
  { modifier: 'meta', macLabel: '⌘', defaultLabel: 'Win' },
  { modifier: 'ctrl', macLabel: '⌃', defaultLabel: 'Ctrl' },
  { modifier: 'alt', macLabel: '⌥', defaultLabel: 'Alt' },
  { modifier: 'shift', macLabel: '⇧', defaultLabel: 'Shift' },
];

const ARROW_DIRECTIONS: Partial<
  Record<string, React.ComponentProps<typeof ShortcutArrowIcon>['direction']>
> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// Keys whose event value is blank or longer than the label users know.
const KEY_LABELS: Partial<Record<string, string>> = {
  ' ': 'Space',
  Escape: 'Esc',
};

const buildModifierKeycaps = (binding: Binding, isMac: boolean) =>
  MODIFIER_KEYCAPS.filter(
    ({ modifier }) =>
      binding.modifiers?.[modifier] &&
      // The question-mark character already represents the shifted key.
      (modifier !== 'shift' || binding.key !== '?')
  ).map(({ modifier, macLabel, defaultLabel }) => {
    const label = isMac ? macLabel : defaultLabel;
    return <kbd key={modifier}>{label}</kbd>;
  });

const ShortcutKeyContent = ({ shortcutKey }: { shortcutKey: string }) => {
  const arrowDirection = ARROW_DIRECTIONS[shortcutKey];
  if (arrowDirection) {
    return <ShortcutArrowIcon direction={arrowDirection} />;
  }
  return (
    KEY_LABELS[shortcutKey] ?? (shortcutKey.length === 1 ? shortcutKey.toUpperCase() : shortcutKey)
  );
};

const ShortcutBinding = ({ binding, isMac }: { binding: Binding; isMac: boolean }) => (
  <span className="shortcut-binding">
    {buildModifierKeycaps(binding, isMac)}
    <kbd>
      <ShortcutKeyContent shortcutKey={binding.key} />
    </kbd>
  </span>
);

const ShortcutRow = ({ row, isMac }: { row: ShortcutHelpRow; isMac: boolean }) => (
  <div className="shortcut-item">
    <span className="shortcut-description">{row.description}</span>
    <span className="keycap">
      {row.bindings.map((binding, index) => (
        <React.Fragment key={getShortcutKey(binding.key, binding.modifiers)}>
          {index > 0 && <span className="shortcut-binding-separator">or</span>}
          <ShortcutBinding binding={binding} isMac={isMac} />
        </React.Fragment>
      ))}
    </span>
  </div>
);

const ShortcutResults = ({
  sections,
  query,
  isMac,
}: {
  sections: HelpSection[];
  query: string;
  isMac: boolean;
}) => {
  if (sections.length === 0) {
    return (
      <p className="shortcut-help-empty">
        {query.trim()
          ? `No shortcuts match “${query.trim()}”`
          : 'No shortcuts available in this context'}
      </p>
    );
  }
  return (
    <>
      {sections.map((section) => (
        <section key={section.category} className="shortcut-group">
          <h3>{section.category}</h3>
          {section.rows.map((row) => (
            <ShortcutRow key={row.description} row={row} isMac={isMac} />
          ))}
        </section>
      ))}
    </>
  );
};

const filterSections = (
  sections: HelpSection[],
  activeId: CategoryId,
  query: string
): HelpSection[] => {
  const needle = query.trim().toLowerCase();
  return sections
    .filter((section) => activeId === ALL_CATEGORIES || categoryId(section.category) === activeId)
    .map((section) => ({
      category: section.category,
      rows: needle
        ? section.rows.filter((row) => row.description.toLowerCase().includes(needle))
        : section.rows,
    }))
    .filter((section) => section.rows.length > 0);
};

const buildCategoryItems = (sections: HelpSection[]): ModalSidebarNavItem<CategoryId>[] => [
  {
    id: ALL_CATEGORIES,
    label: 'All',
    count: sections.reduce((total, section) => total + section.rows.length, 0),
  },
  ...sections.map((section) => ({
    id: categoryId(section.category),
    label: section.category,
    count: section.rows.length,
  })),
];

export function ShortcutHelpModal({ isOpen, onClose }: Readonly<ShortcutHelpModalProps>) {
  const { getAvailableShortcuts } = useKeyboardContext();
  const [shortcuts, setShortcuts] = useState(getAvailableShortcuts);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<CategoryId>(ALL_CATEGORIES);
  const { isClosing, shouldRender } = useModalPresence(isOpen);
  const modalRef = useRef<HTMLDivElement>(null);
  const filterId = useId();
  const isMac = navigator.userAgent.includes('Mac');

  // Refresh the snapshot when opened or when registrations change while open.
  useEffect(() => {
    if (isOpen) {
      setShortcuts(getAvailableShortcuts());
    }
  }, [isOpen, getAvailableShortcuts]);

  // Every opening starts a new browse: all categories and no filter.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveId(ALL_CATEGORIES);
    }
  }, [isOpen]);

  const sections = useMemo(
    () =>
      shortcuts.map((group) => ({ category: group.category, rows: buildShortcutHelpRows(group) })),
    [shortcuts]
  );
  const categoryItems = useMemo(() => buildCategoryItems(sections), [sections]);
  // A category that disappears from a refreshed snapshot falls back to All.
  const selectedId = categoryItems.some((item) => item.id === activeId) ? activeId : ALL_CATEGORIES;
  const visibleSections = useMemo(
    () => filterSections(sections, selectedId, query),
    [sections, selectedId, query]
  );

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    suppressShortcuts: true,
    onEscape: () => {
      onClose();
      return true;
    },
    onKeyDown: (event) => {
      if (handleModalSidebarKeyDown(event)) {
        return true;
      }
      // The help toggles closed on ? or /, except while typing in the filter.
      if ((event.key === '/' || event.key === '?') && !isInputElement(event.target)) {
        onClose();
        return true;
      }
      return false;
    },
  });

  if (!shouldRender) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="shortcut-help-modal-title"
      onClose={onClose}
      overlayClassName="shortcut-help-modal-overlay"
      containerClassName="shortcut-help-modal"
      isClosing={isClosing}
      closeOnBackdrop={true}
    >
      <ModalHeader
        title="Keyboard Shortcuts"
        titleId="shortcut-help-modal-title"
        icon={CategoryIcon}
        onClose={onClose}
        closeClassName="shortcut-help-modal-close"
      />

      <div className="modal-split-body">
        <ModalSidebarNav
          label="Shortcut categories"
          items={categoryItems}
          activeId={selectedId}
          onSelect={setActiveId}
          footer={<p className="shortcut-help-context">Showing shortcuts for the focused view</p>}
        />
        <div className="shortcut-help-content">
          <label className="sr-only" htmlFor={filterId}>
            Filter shortcuts
          </label>
          <SearchInput
            id={filterId}
            className="shortcut-help-filter"
            placeholder="Filter shortcuts…"
            value={query}
            onChange={setQuery}
          />
          <div className="shortcut-help-results">
            <ShortcutResults sections={visibleSections} query={query} isMac={isMac} />
          </div>
        </div>
      </div>
    </ModalSurface>
  );
}
