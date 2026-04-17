/**
 * frontend/src/shared/components/modals/RollbackModal.test.tsx
 *
 * Test suite for RollbackModal.
 * Covers loading, error, empty, auto-select, and title rendering behaviors.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import RollbackModal from './RollbackModal';
import { KeyboardProvider } from '@ui/shortcuts/context';

// Hoisted mock for the Wails backend bindings.
const backendMocks = vi.hoisted(() => ({
  GetRevisionHistory: vi.fn(),
  RollbackWorkload: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetRevisionHistory: backendMocks.GetRevisionHistory,
  RollbackWorkload: backendMocks.RollbackWorkload,
}));

/** Helper to build a RevisionEntry-like object. */
const makeRevision = (
  revision: number,
  current: boolean,
  opts?: { changeCause?: string; podTemplate?: string; createdAt?: string }
) => ({
  revision,
  createdAt: opts?.createdAt ?? new Date(Date.now() - revision * 3600_000).toISOString(),
  changeCause: opts?.changeCause ?? '',
  current,
  podTemplate: opts?.podTemplate ?? `template-v${revision}`,
});

const buildLargeRollbackTemplate = (lineCount: number) =>
  Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join('\n');

describe('RollbackModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    clusterId: 'cluster-1',
    namespace: 'default',
    name: 'my-deploy',
    kind: 'Deployment',
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    backendMocks.GetRevisionHistory.mockReset();
    backendMocks.RollbackWorkload.mockReset();
    defaultProps.onClose.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    // Clean up any portaled content.
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  /** Render the modal and wait for async effects. */
  const renderModal = async (props?: Partial<typeof defaultProps>) => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <RollbackModal {...defaultProps} {...props} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  };

  it('does not render when isOpen is false', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([]);

    await renderModal({ isOpen: false });

    expect(document.querySelector('.rollback-modal')).toBeNull();
    // Should not even call the backend when closed.
    expect(backendMocks.GetRevisionHistory).not.toHaveBeenCalled();
  });

  it('renders loading state then revision list', async () => {
    // Create a deferred promise so we can assert the loading state.
    let resolveRevisions!: (value: any) => void;
    const pending = new Promise((resolve) => {
      resolveRevisions = resolve;
    });
    backendMocks.GetRevisionHistory.mockReturnValue(pending);

    await renderModal();

    // Loading state should be visible.
    expect(document.querySelector('[data-testid="rollback-loading"]')).not.toBeNull();

    // Resolve the promise with revision data.
    await act(async () => {
      resolveRevisions([makeRevision(3, true), makeRevision(2, false), makeRevision(1, false)]);
      await Promise.resolve();
    });

    // Loading should be gone; revision list should be present.
    expect(document.querySelector('[data-testid="rollback-loading"]')).toBeNull();
    expect(document.querySelector('[data-testid="rollback-revision-list"]')).not.toBeNull();
    expect(document.querySelectorAll('.rollback-revision-item')).toHaveLength(3);
  });

  it('auto-selects most recent non-current revision', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true),
      makeRevision(2, false),
      makeRevision(1, false),
    ]);

    await renderModal();

    // Wait for async fetch to resolve.
    await act(async () => {
      await Promise.resolve();
    });

    // The rollback button should reference revision 2 (most recent non-current).
    const rollbackBtn = document.querySelector('.button.warning') as HTMLButtonElement;
    expect(rollbackBtn).not.toBeNull();
    expect(rollbackBtn.textContent).toContain('Rollback to Revision 2');
  });

  it('shows error when fetch fails', async () => {
    backendMocks.GetRevisionHistory.mockRejectedValue(new Error('cluster unreachable'));

    await renderModal();

    await act(async () => {
      await Promise.resolve();
    });

    const errorEl = document.querySelector('[data-testid="rollback-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('cluster unreachable');
  });

  it('shows empty message when only current revision exists', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([makeRevision(1, true)]);

    await renderModal();

    await act(async () => {
      await Promise.resolve();
    });

    const emptyEl = document.querySelector('[data-testid="rollback-empty"]');
    expect(emptyEl).not.toBeNull();
    expect(emptyEl?.textContent).toBe('No previous revisions available for rollback');
  });

  it('displays correct modal title', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true),
      makeRevision(1, false),
    ]);

    await renderModal({ kind: 'StatefulSet', name: 'redis' });

    await act(async () => {
      await Promise.resolve();
    });

    const header = document.querySelector('.modal-header h2');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('Rollback StatefulSet');
    expect(header?.textContent).toContain('redis');
  });

  it('marks the current revision as disabled and unselectable', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true),
      makeRevision(2, false),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    const currentItem = document.querySelector('[data-testid="revision-item-3"]');
    expect(currentItem?.classList.contains('rollback-revision-item--disabled')).toBe(true);

    // It should have the "current" badge.
    expect(currentItem?.querySelector('.rollback-revision-badge')?.textContent).toBe('current');
  });

  it('closes on Escape through the keyboard surface manager', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true),
      makeRevision(2, false),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    const closeButton = document.querySelector('.modal-close') as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    closeButton?.focus();

    await act(async () => {
      closeButton?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('passes clusterId to GetRevisionHistory for multi-cluster awareness', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([]);

    await renderModal({ clusterId: 'prod-cluster' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(backendMocks.GetRevisionHistory).toHaveBeenCalledWith(
      'prod-cluster',
      'default',
      'my-deploy',
      'Deployment'
    );
  });

  it('renders the shared diff viewer for selectable revisions', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true, { podTemplate: 'image: demo:v2' }),
      makeRevision(1, false, { podTemplate: 'image: demo:v1' }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.object-diff-table')).not.toBeNull();
  });

  it('shows the shared too-large warning when a rollback diff exceeds budget', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true, { podTemplate: buildLargeRollbackTemplate(15_001) }),
      makeRevision(1, false, { podTemplate: buildLargeRollbackTemplate(15_001) }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    const warning = document.querySelector('[data-testid="rollback-diff-warning"]');
    expect(warning?.textContent).toContain(
      'The diff is too large to display in the current view (15,001 lines exceed the limit of 15,000).'
    );
    expect(document.querySelector('.object-diff-table')).toBeNull();
  });
});
