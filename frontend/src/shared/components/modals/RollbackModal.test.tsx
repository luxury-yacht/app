/**
 * frontend/src/shared/components/modals/RollbackModal.test.tsx
 *
 * Test suite for RollbackModal.
 * Covers loading, error, empty, auto-select, comparison sides, and revision picking.
 */

import { KeyboardProvider } from '@ui/shortcuts/context';
import { act, type ComponentProps } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RollbackModal from './RollbackModal';

// Hoisted mock for the Wails backend bindings.
const backendMocks = vi.hoisted(() => ({
  GetClusterWorkspaceStateForWindow: vi.fn(),
  GetRevisionHistory: vi.fn(),
  RunObjectAction: vi.fn(),
}));
const handleInlineMock = vi.hoisted(() => vi.fn());

vi.mock('@core/backend-api', () => ({
  GetClusterWorkspaceStateForWindow: backendMocks.GetClusterWorkspaceStateForWindow,
  GetRevisionHistory: backendMocks.GetRevisionHistory,
  RunObjectAction: backendMocks.RunObjectAction,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handleInline: (...args: unknown[]) => handleInlineMock(...args),
  },
}));

/** Helper to build a RevisionEntry-like object. */
const makeRevision = (
  revision: number,
  current: boolean,
  opts?: { changeCause?: string; content?: string; createdAt?: string }
) => ({
  revision,
  createdAt: opts?.createdAt ?? new Date(Date.now() - revision * 3600_000).toISOString(),
  changeCause: opts?.changeCause ?? '',
  current,
  content: opts?.content ?? `template-v${revision}`,
});

const buildLargeRollbackTemplate = (lineCount: number) =>
  Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join('\n');

const currentSide = () =>
  document.querySelector('[data-testid="rollback-current"]')?.textContent ?? '';

const targetSide = () =>
  document.querySelector('[data-testid="rollback-target"]')?.textContent ?? '';

const revisionPicker = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="Revision to roll back to"]');

const revisionOptions = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.dropdown-option'));

const openRevisionPicker = async () => {
  await act(async () => {
    revisionPicker()?.click();
  });
};

const diffSide = (side: 'left' | 'right') =>
  Array.from(document.querySelectorAll(`.object-diff-cell-${side} .object-diff-line-text`))
    .map((line) => line.textContent)
    .join('\n');

const diffOnlyToggle = () =>
  document.querySelector<HTMLInputElement>('.rollback-modal-footer input[type="checkbox"]');

describe('RollbackModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    clusterId: 'cluster-1',
    namespace: 'default',
    group: 'apps',
    version: 'v1',
    name: 'my-deploy',
    kind: 'Deployment',
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    // The confirmation names its cluster through the workspace store.
    backendMocks.GetClusterWorkspaceStateForWindow.mockResolvedValue({
      selectedKubeconfigs: [],
      visibleClusterId: '',
      clusters: {},
    });
    // jsdom has no layout, so it does not implement scrollIntoView for the open menu.
    HTMLElement.prototype.scrollIntoView = vi.fn();
    backendMocks.GetRevisionHistory.mockReset();
    backendMocks.RunObjectAction.mockReset();
    handleInlineMock.mockReset();
    handleInlineMock.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : String(error),
    }));
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
  const renderModal = async (props?: Partial<ComponentProps<typeof RollbackModal>>) => {
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

  it('renders loading state then both revisions being compared', async () => {
    // Create a deferred promise so we can assert the loading state.
    let resolveRevisions!: (value: unknown) => void;
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

    // Loading should be gone; the comparison should name both revisions.
    expect(document.querySelector('[data-testid="rollback-loading"]')).toBeNull();
    expect(currentSide()).toContain('Revision 3');
    expect(revisionPicker()?.textContent).toContain('Revision 2');
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
    const error = new Error('cluster unreachable');
    backendMocks.GetRevisionHistory.mockRejectedValue(error);

    await renderModal();

    await act(async () => {
      await Promise.resolve();
    });

    const errorEl = document.querySelector('[data-testid="rollback-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain('cluster unreachable');
    expect(handleInlineMock).toHaveBeenCalledWith(error, {
      action: 'loadRevisionHistory',
      source: 'RollbackModal',
      clusterId: 'cluster-1',
    });
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
    expect(diffOnlyToggle()).toBeNull();
  });

  it('compares the current revision on the left with the rollback target on the right', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true, { content: 'image: demo:v3', changeCause: 'canary' }),
      makeRevision(2, false, { content: 'image: demo:v2', changeCause: 'hotfix' }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentSide()).toContain('canary');
    expect(targetSide()).toContain('hotfix');
    expect(diffSide('left')).toContain('image: demo:v3');
    expect(diffSide('right')).toContain('image: demo:v2');
  });

  it('offers only earlier revisions as rollback targets, newest first', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(1, false),
      makeRevision(3, true),
      makeRevision(2, false),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });
    await openRevisionPicker();

    const labels = revisionOptions().map((option) => option.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Revision 2');
    expect(labels[1]).toContain('Revision 1');
  });

  it('rolls back to the revision chosen in the picker', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true, { content: 'image: demo:v3' }),
      makeRevision(2, false, { content: 'image: demo:v2' }),
      makeRevision(1, false, { content: 'image: demo:v1', changeCause: 'first release' }),
    ]);
    backendMocks.RunObjectAction.mockResolvedValue({});

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });
    await openRevisionPicker();
    await act(async () => {
      revisionOptions()[1]?.click();
    });

    expect(targetSide()).toContain('first release');
    expect(diffSide('left')).toContain('image: demo:v3');
    expect(diffSide('right')).toContain('image: demo:v1');

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.rollback-modal-footer .button.warning')?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('.confirmation-modal-footer .button.warning')
        ?.click();
    });

    expect(backendMocks.RunObjectAction).toHaveBeenCalledWith({
      action: 'rollback',
      revision: 1,
      target: expect.objectContaining({
        clusterId: 'cluster-1',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'default',
        name: 'my-deploy',
      }),
    });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not name a current revision when the history marks none', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, false),
      makeRevision(1, false),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    expect(currentSide()).not.toContain('Revision');
    expect(revisionPicker()?.textContent).toContain('Revision 2');
    expect(document.querySelector('.object-diff-table')).toBeNull();
  });

  it('narrows the comparison to changed lines with Diff only', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true, { content: 'kind: same\nimage: demo:v2' }),
      makeRevision(1, false, { content: 'kind: same\nimage: demo:v1' }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });
    expect(diffSide('left')).toContain('kind: same');

    await act(async () => {
      diffOnlyToggle()?.click();
    });

    expect(diffSide('left')).not.toContain('kind: same');
    expect(diffSide('left')).toContain('image: demo:v2');
  });

  it('closes the open revision picker on Escape before closing the modal', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true),
      makeRevision(2, false),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });
    revisionPicker()?.focus();
    await openRevisionPicker();
    expect(revisionOptions()).toHaveLength(1);

    const pressEscape = async () => {
      await act(async () => {
        revisionPicker()?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        await Promise.resolve();
      });
    };

    await pressEscape();
    expect(revisionOptions()).toHaveLength(0);
    expect(defaultProps.onClose).not.toHaveBeenCalled();

    await pressEscape();
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
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

    expect(backendMocks.GetRevisionHistory).toHaveBeenCalledWith({
      clusterId: 'prod-cluster',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'default',
      name: 'my-deploy',
    });
  });

  it('renders the shared diff viewer for selectable revisions', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true, { content: 'image: demo:v2' }),
      makeRevision(1, false, { content: 'image: demo:v1' }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.object-diff-table')).not.toBeNull();
  });

  it('shows the shared too-large warning when a rollback diff exceeds budget', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(2, true, { content: buildLargeRollbackTemplate(15_001) }),
      makeRevision(1, false, { content: buildLargeRollbackTemplate(15_001) }),
    ]);

    await renderModal();
    await act(async () => {
      await Promise.resolve();
    });

    const warning = document.querySelector('[data-testid="rollback-diff-warning"]');
    expect(warning).not.toBeNull();
    expect(document.querySelector('.object-diff-table')).toBeNull();
  });
  it('keeps the new cluster history when an earlier request finishes late', async () => {
    let finishOld!: (value: ReturnType<typeof makeRevision>[]) => void;
    backendMocks.GetRevisionHistory.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      })
    );
    await renderModal();
    backendMocks.GetRevisionHistory.mockResolvedValueOnce([
      makeRevision(8, true),
      makeRevision(7, false),
    ]);
    await renderModal({ clusterId: 'cluster-2' });
    await act(async () => {
      finishOld([makeRevision(3, true), makeRevision(2, false)]);
    });
    expect(currentSide()).toContain('Revision 8');
    expect(revisionPicker()?.textContent).toContain('Revision 7');
  });

  it('releases the mutation boundary and reports invalid action identity', async () => {
    backendMocks.GetRevisionHistory.mockResolvedValue([
      makeRevision(3, true),
      makeRevision(2, false),
    ]);
    const onMutationChange = vi.fn();
    await renderModal({ version: 'v99', onMutationChange });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.rollback-modal-footer .button.warning')?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('.confirmation-modal-footer .button.warning')
        ?.click();
    });
    expect(onMutationChange.mock.calls).toEqual([[true], [false]]);
    expect(document.querySelector('.rollback-modal-footer-error')?.textContent).toContain(
      'unsupported group/version'
    );
    expect(backendMocks.RunObjectAction).not.toHaveBeenCalled();
  });
});
