/**
 * frontend/src/shared/components/modals/ConfirmationModal.target.test.tsx
 *
 * The object a confirmation names, read through the real cluster workspace
 * store. Callers' wiring is covered where they run, in ActionsMenu.test.tsx.
 */

import { describe, expect, it, vi } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import ConfirmationModal from './ConfirmationModal';

const app = installAppStateHarness();

describe('ConfirmationModal target', () => {
  it('still identifies the cluster when the workspace does not know its name', async () => {
    const view = await app.render(null);

    await view.show(
      <ConfirmationModal
        isOpen
        title="Delete Pod"
        target={{
          clusterId: 'closed:ctx',
          group: '',
          kind: 'Pod',
          name: 'api',
          namespace: 'team-a',
        }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await app.settle();

    expect(
      Array.from(document.querySelectorAll('.confirmation-modal-target-line')).map(
        (line) => line.textContent
      )
    ).toEqual(['Namespace team-a', 'Cluster closed:ctx']);
  });
});
