import { useId, useRef, useState } from 'react';
import { ListNamedWorkspaces, SaveNamedWorkspace } from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { useEventBus } from '@/core/events';
import { ErrorSurface } from '@/shared/components/errors/ErrorSurface';
import ModalHeader from '@/shared/components/modals/ModalHeader';
import ModalSurface from '@/shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@/shared/components/modals/useModalFocusTrap';
import './NamedWorkspaceSaveDialog.css';

export function NamedWorkspaceSaveDialog() {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<panelwindow.NamedWorkspaceEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; action: string } | null>(null);
  // A replacement names the snapshot this dialog listed, not just its name.
  const listed = entries.find((entry) => entry.name === name.trim());
  const replacing = listed !== undefined;
  const idleLabel = replacing ? 'Replace Workspace' : 'Save';
  const submitLabel = saving ? 'Saving…' : idleLabel;
  const close = () => {
    if (!saving) {
      setOpen(false);
    }
  };

  const load = () =>
    ListNamedWorkspaces()
      .then((saved) => setEntries(saved ?? []))
      .catch((error) => setFailure({ error, action: 'list' }));

  useEventBus('named-workspace:save-dialog', () => {
    if (!open) {
      setName('');
      setFailure(null);
      setOpen(true);
      void load();
    }
  });
  useModalFocusTrap({
    ref: modalRef,
    disabled: !open,
    onEscape: () => {
      close();
      return true;
    },
  });

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await SaveNamedWorkspace(getWindowIdentity(), name.trim(), replacing, listed?.revision ?? '');
      setOpen(false);
    } catch (error) {
      // A refused save means the list is out of date: another window may have
      // saved, renamed, deleted or replaced this name. Read it again, then say
      // why nothing was saved.
      await load();
      setFailure({ error, action: 'save' });
    } finally {
      setSaving(false);
    }
  };
  if (!open) {
    return null;
  }
  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      onClose={close}
      containerClassName="named-workspace-save-modal"
    >
      <ModalHeader
        title="Save Workspace"
        titleId={titleId}
        onClose={close}
        closeDisabled={saving}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="modal-content">
          <label className="modal-form-field">
            <span>Workspace name</span>
            <input
              className="modal-input"
              name="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
              required
            />
          </label>
          {!!failure && (
            <div role="alert">
              <ErrorSurface
                kind="operational"
                error={failure.error}
                context={{ source: 'NamedWorkspace', action: failure.action }}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button cancel" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button save" disabled={saving || !name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
