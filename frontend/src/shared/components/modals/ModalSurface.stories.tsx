import { useZoom, ZoomProvider } from '@core/contexts/ZoomContext';
import type { Meta, StoryObj } from '@storybook/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { expect, waitFor, within } from 'storybook/test';
import { KeyboardProviderDecorator } from '../../../../.storybook/decorators/KeyboardProviderDecorator';
import ModalSurface from './ModalSurface';
import { useModalFocusTrap } from './useModalFocusTrap';
import '@/ui/modals/SettingsModal.css';
import '@/ui/modals/ObjectDiffModal.css';
import '@/modules/cluster/components/AttentionIgnoredModal.css';
import '@/modules/port-forward/PortForwardModal.css';
import './DrainNodeModal.css';
import './RollbackModal.css';

interface ModalSizingProps {
  zoomLevel: number;
  containerClassName: string;
}

// Exercise the production surface with enough content to reach its height cap.
function ModalSizingExample({ containerClassName }: ModalSizingProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);
  const { zoomLevel } = useZoom();
  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      setIsOpen(false);
      return true;
    },
  });
  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)}>
        Reopen modal
      </button>
    );
  }
  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      containerClassName={containerClassName}
      onClose={() => setIsOpen(false)}
    >
      <header className="modal-header">
        <h2 id={titleId}>Modal at {zoomLevel}% zoom</h2>
        <button
          type="button"
          className="modal-close"
          onClick={() => setIsOpen(false)}
          aria-label="Close"
        >
          ×
        </button>
      </header>
      <div className="modal-content">
        <div className="modal-form">
          {Array.from({ length: 30 }, (_, index) => `Setting ${index + 1}`).map((label) => (
            <label className="modal-form-field" key={label}>
              {label}
              <input className="modal-input" defaultValue={label} />
            </label>
          ))}
        </div>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button" onClick={() => setIsOpen(false)}>
          Cancel
        </button>
        <button type="button" className="button" onClick={() => setIsOpen(false)}>
          Save
        </button>
      </footer>
    </ModalSurface>
  );
}

function ModalSizingStory(props: ModalSizingProps) {
  useLayoutEffect(() => {
    const overrides = window.__storybookBackendOverrides;
    const previousRead = overrides.GetZoomLevel;
    const previousZoom = document.body.style.zoom;
    const previousFactor = document.documentElement.style.getPropertyValue('--app-zoom-factor');
    overrides.GetZoomLevel = () => Promise.resolve(props.zoomLevel);
    return () => {
      if (previousRead) {
        overrides.GetZoomLevel = previousRead;
      } else {
        Reflect.deleteProperty(overrides, 'GetZoomLevel');
      }
      document.body.style.zoom = previousZoom;
      document.documentElement.style.setProperty('--app-zoom-factor', previousFactor);
    };
  }, [props.zoomLevel]);
  return (
    <ZoomProvider key={props.zoomLevel}>
      <ModalSizingExample {...props} />
    </ZoomProvider>
  );
}

const meta: Meta<typeof ModalSizingStory> = {
  title: 'Modals/ModalSurface/Sizing',
  component: ModalSizingStory,
  decorators: [KeyboardProviderDecorator],
  args: { zoomLevel: 200, containerClassName: '' },
  play: async ({ canvasElement, args }: { canvasElement: HTMLElement; args: ModalSizingProps }) => {
    const document = canvasElement.ownerDocument;
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() => expect(document.body.style.zoom).toBe(`${args.zoomLevel}%`));
    await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
    const backdrop = dialog.parentElement;
    if (!backdrop) {
      throw new Error('Expected the shared modal backdrop');
    }
    const backdropRect = backdrop.getBoundingClientRect();
    const backdropStyle = getComputedStyle(backdrop);
    const zoom = args.zoomLevel / 100;
    const top = backdropRect.top + Number.parseFloat(backdropStyle.paddingTop) * zoom;
    const bottom = backdropRect.bottom - Number.parseFloat(backdropStyle.paddingBottom) * zoom;
    const rect = dialog.getBoundingClientRect();
    await expect(rect.top).toBeGreaterThanOrEqual(top - 1);
    await expect(rect.bottom).toBeLessThanOrEqual(bottom + 1);
    const left = backdropRect.left + Number.parseFloat(backdropStyle.paddingLeft) * zoom;
    const right = backdropRect.right - Number.parseFloat(backdropStyle.paddingRight) * zoom;
    await expect(rect.left).toBeGreaterThanOrEqual(left - 1);
    await expect(rect.right).toBeLessThanOrEqual(right + 1);
    await expect(Math.abs((rect.top + rect.bottom) / 2 - (top + bottom) / 2)).toBeLessThan(1);
    for (const selector of ['.modal-header', '.modal-footer']) {
      const element = dialog.querySelector(selector);
      if (!element) {
        throw new Error(`Expected ${selector}`);
      }
      element.scrollIntoView({ block: 'nearest' });
      const bounds = element.getBoundingClientRect();
      await expect(bounds.top).toBeGreaterThanOrEqual(rect.top);
      await expect(bounds.bottom).toBeLessThanOrEqual(rect.bottom);
    }
    const content = dialog.querySelector('.modal-content');
    if (!content) {
      throw new Error('Expected scrollable modal content');
    }
    content.scrollTop = content.scrollHeight;
    await expect(content.scrollTop).toBeGreaterThan(0);
    const lastField = within(dialog).getByLabelText('Setting 30');
    lastField.scrollIntoView({ block: 'nearest' });
    await expect(lastField.getBoundingClientRect().bottom).toBeLessThanOrEqual(rect.bottom);
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const TallContent: Story = {};
export const Settings: Story = { args: { containerClassName: 'settings-modal' } };
export const Rollback: Story = { args: { containerClassName: 'rollback-modal' } };
export const Drain: Story = { args: { containerClassName: 'drain-node-modal' } };
export const PortForward: Story = { args: { containerClassName: 'port-forward-modal' } };
export const AttentionIgnored: Story = { args: { containerClassName: 'attention-ignored-modal' } };
export const ObjectDiff: Story = { args: { containerClassName: 'object-diff-modal' } };
