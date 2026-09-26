/**
 * frontend/src/ui/modals/SettingsModal.tsx
 *
 * Two-pane Settings modal: sidebar tab nav + content panel with breadcrumb
 * header. Each tab's content lives in its own component under
 * @ui/settings/sections/.
 */

import type { backend } from '@core/backend-api/models';
import { FloatPanelIcon } from '@shared/components/icons/DockableIcons';
import {
  AdvancedIcon,
  AppearanceModeIcon,
  DisplayIcon,
  KubeconfigsIcon,
} from '@shared/components/icons/SettingsIcons';
import { CategoryIcon, CloseIcon, SettingsIcon } from '@shared/components/icons/SharedIcons';
import {
  handleModalSidebarKeyDown,
  ModalSidebarNav,
  type ModalSidebarNavItem,
} from '@shared/components/modals/ModalSidebarNav';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { useModalPresence } from '@shared/components/modals/useModalPresence';
import AdvancedSection from '@ui/settings/sections/AdvancedSection';
import AppearanceSection from '@ui/settings/sections/AppearanceSection';
import DataManagementSection from '@ui/settings/sections/DataManagementSection';
import DisplaySection from '@ui/settings/sections/DisplaySection';
import KubeconfigsSection from '@ui/settings/sections/KubeconfigsSection';
import ObjectPanelSection from '@ui/settings/sections/ObjectPanelSection';
import {
  DEFAULT_SETTINGS_TAB,
  getLastSettingsTab,
  type SettingsTabId,
  setLastSettingsTab,
} from '@ui/settings/settingsTabPreference';
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import '@ui/settings/Settings.css';
import './SettingsModal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional tab to open straight to. Falls back to last-used or default. */
  initialTab?: SettingsTabId;
}

interface TabDefinition {
  id: SettingsTabId;
  label: string;
  icon: React.FC<{ width?: number; height?: number; fill?: string }>;
}

const TABS: TabDefinition[] = [
  { id: 'appearance', label: 'Appearance', icon: AppearanceModeIcon },
  { id: 'kubeconfigs', label: 'Kubeconfigs', icon: KubeconfigsIcon },
  { id: 'display', label: 'Display', icon: DisplayIcon },
  { id: 'object-panel', label: 'Object Panel', icon: FloatPanelIcon },
  { id: 'data-management', label: 'Data Management', icon: CategoryIcon },
  { id: 'advanced', label: 'Advanced', icon: AdvancedIcon },
];

const KNOWN_TAB_IDS = new Set<SettingsTabId>(TABS.map((tab) => tab.id));

const SIDEBAR_ITEMS: ReadonlyArray<ModalSidebarNavItem<SettingsTabId>> = TABS.map(
  ({ id, label, icon: Icon }) => ({ id, label, icon: <Icon width={16} height={16} /> })
);

// A previously-persisted tab that no longer exists (e.g. the removed Kubeconfigs
// tab) falls back to the default so the settings panel is never blank.
const resolveTab = (tab: SettingsTabId | null | undefined): SettingsTabId =>
  tab && KNOWN_TAB_IDS.has(tab) ? tab : DEFAULT_SETTINGS_TAB;

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab }) => {
  const elementIdPrefix = useId();
  const { isClosing, shouldRender } = useModalPresence(isOpen);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() =>
    resolveTab(initialTab ?? getLastSettingsTab())
  );
  const [appInfo, setAppInfo] = useState<backend.AppInfo | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Restore the selected section whenever the modal opens or its override changes.
  useEffect(() => {
    if (isOpen) {
      setActiveTab(resolveTab(initialTab ?? getLastSettingsTab()));
    }
  }, [isOpen, initialTab]);

  // Lock body scroll while open.
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Fetch app version for the sidebar footer.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    requestAppState({
      resource: 'app-info',
      read: () => readAppInfo(),
    })
      .then((info) => setAppInfo(info))
      .catch(() => {
        // Silent fallback — version footer just won't render.
      });
  }, [isOpen]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !shouldRender,
    onKeyDown: handleModalSidebarKeyDown,
    onEscape: () => {
      if (!isOpen) {
        return false;
      }
      onClose();
      return true;
    },
  });

  const handleTabChange = (tab: SettingsTabId) => {
    setActiveTab(tab);
    setLastSettingsTab(tab);
  };

  const activeTabDef = useMemo(() => TABS.find((t) => t.id === activeTab) ?? TABS[0], [activeTab]);

  if (!shouldRender) {
    return null;
  }

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={`${elementIdPrefix}-settings-modal-title`}
      onClose={onClose}
      overlayClassName="settings-modal-overlay"
      containerClassName="settings-modal"
      isClosing={isClosing}
    >
      <div className="modal-header settings-modal-header">
        <div className="settings-modal-breadcrumb" id={`${elementIdPrefix}-settings-modal-title`}>
          <SettingsIcon width={18} height={18} />
          <span className="settings-modal-breadcrumb-root">Settings</span>
          <span className="settings-modal-breadcrumb-sep">›</span>
          <span className="settings-modal-breadcrumb-leaf">{activeTabDef.label}</span>
        </div>
        <button
          type="button"
          className="modal-close settings-modal-close"
          onClick={onClose}
          aria-label="Close Settings"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="modal-split-body">
        <ModalSidebarNav
          label="Settings sections"
          items={SIDEBAR_ITEMS}
          activeId={activeTab}
          onSelect={handleTabChange}
          footer={
            !!appInfo?.version && (
              <div className="settings-modal-version" role="status" aria-label="App version">
                {appInfo.version}
              </div>
            )
          }
        />

        <div className="settings-modal-content">
          {activeTab === 'appearance' && <AppearanceSection />}
          {activeTab === 'kubeconfigs' && <KubeconfigsSection />}
          {activeTab === 'display' && <DisplaySection />}
          {activeTab === 'object-panel' && <ObjectPanelSection />}
          {activeTab === 'data-management' && <DataManagementSection />}
          {activeTab === 'advanced' && <AdvancedSection />}
        </div>
      </div>
    </ModalSurface>
  );
};

export default SettingsModal;
