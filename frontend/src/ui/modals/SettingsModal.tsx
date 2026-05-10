/**
 * frontend/src/ui/modals/SettingsModal.tsx
 *
 * Two-pane Settings modal: sidebar tab nav + content panel with breadcrumb
 * header. Each tab's content lives in its own component under
 * @ui/settings/sections/.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '@wailsjs/go/models';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { CloseIcon, SettingsIcon } from '@shared/components/icons/SharedIcons';
import { FloatPanelIcon } from '@shared/components/icons/DockableIcons';
import {
  AppearanceModeIcon,
  KubeconfigsIcon,
  DisplayIcon,
  AdvancedIcon,
} from '@shared/components/icons/SettingsIcons';
import { readAppInfo, requestAppState } from '@/core/app-state-access';
import AppearanceSection from '@ui/settings/sections/AppearanceSection';
import KubeconfigsSection from '@ui/settings/sections/KubeconfigsSection';
import DisplaySection from '@ui/settings/sections/DisplaySection';
import ObjectPanelSection from '@ui/settings/sections/ObjectPanelSection';
import AdvancedSection from '@ui/settings/sections/AdvancedSection';
import {
  DEFAULT_SETTINGS_TAB,
  getLastSettingsTab,
  setLastSettingsTab,
  type SettingsTabId,
} from '@ui/settings/settingsTabPreference';
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
  { id: 'advanced', label: 'Advanced', icon: AdvancedIcon },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(
    () => initialTab ?? getLastSettingsTab() ?? DEFAULT_SETTINGS_TAB
  );
  const [appInfo, setAppInfo] = useState<backend.AppInfo | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Open/close animation gating.
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      // When opening, honor an explicit initialTab override; otherwise restore
      // the last-used tab (falling back to default).
      setActiveTab(initialTab ?? getLastSettingsTab() ?? DEFAULT_SETTINGS_TAB);
    } else if (shouldRender) {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, initialTab, shouldRender]);

  // Lock body scroll while open.
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Fetch app version for the sidebar footer.
  useEffect(() => {
    if (!isOpen) return;
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
    onEscape: () => {
      if (!isOpen) return false;
      onClose();
      return true;
    },
  });

  const handleTabChange = (tab: SettingsTabId) => {
    setActiveTab(tab);
    setLastSettingsTab(tab);
  };

  const activeTabDef = useMemo(() => TABS.find((t) => t.id === activeTab) ?? TABS[0], [activeTab]);

  if (!shouldRender) return null;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="settings-modal-title"
      onClose={onClose}
      overlayClassName="settings-modal-overlay"
      containerClassName="settings-modal"
      isClosing={isClosing}
    >
      <div className="modal-header settings-modal-header">
        <div className="settings-modal-breadcrumb" id="settings-modal-title">
          <SettingsIcon width={18} height={18} />
          <span className="settings-modal-breadcrumb-root">Settings</span>
          <span className="settings-modal-breadcrumb-sep">›</span>
          <span className="settings-modal-breadcrumb-leaf">{activeTabDef.label}</span>
        </div>
        <button
          className="modal-close settings-modal-close"
          onClick={onClose}
          aria-label="Close Settings"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="settings-modal-body">
        <nav className="settings-modal-sidebar" aria-label="Settings sections">
          <ul className="settings-modal-tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <li key={tab.id}>
                  <button
                    type="button"
                    className={`settings-modal-tab${isActive ? ' settings-modal-tab--active' : ''}`}
                    onClick={() => handleTabChange(tab.id)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon width={16} height={16} />
                    <span>{tab.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {appInfo?.version && (
            <div className="settings-modal-version" aria-label="App version">
              {appInfo.version}
            </div>
          )}
        </nav>

        <div className="settings-modal-content">
          {activeTab === 'appearance' && <AppearanceSection />}
          {activeTab === 'kubeconfigs' && <KubeconfigsSection />}
          {activeTab === 'display' && <DisplaySection />}
          {activeTab === 'object-panel' && <ObjectPanelSection />}
          {activeTab === 'advanced' && <AdvancedSection />}
        </div>
      </div>
    </ModalSurface>
  );
};

export default SettingsModal;
