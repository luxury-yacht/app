import { useId, useRef, useState } from 'react';
import { ListNamedWorkspaces, OpenNamedWorkspace } from '@/core/backend-api';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { eventBus, useEventBus } from '@/core/events';
import { ErrorSurface } from '@/shared/components/errors/ErrorSurface';
import ModalHeader from '@/shared/components/modals/ModalHeader';
import ModalSurface from '@/shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@/shared/components/modals/useModalFocusTrap';
import './NamedWorkspaceSaveDialog.css';

export function NamedWorkspaceOpenDialog() {
  const title = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; action: string } | null>(null);
  const close = () => {
    if (!busy) {
      setShown(false);
    }
  };

  useEventBus('named-workspace:open-dialog', () => {
    if (shown) {
      return;
    }
    setShown(true);
    setNames(null);
    setSelected('');
    setFailure(null);
    void ListNamedWorkspaces()
      .then((saved) => {
        setNames(saved ?? []);
        setSelected(saved?.[0] ?? '');
      })
      .catch((error) => setFailure({ error, action: 'list' }));
  });
  useModalFocusTrap({
    ref,
    disabled: !shown,
    onEscape: () => {
      close();
      return true;
    },
  });

  const open = async () => {
    if (busy || !selected) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await OpenNamedWorkspace(getWindowIdentity(), selected);
      setShown(false);
    } catch (error) {
      setFailure({ error, action: 'open' });
    } finally {
      setBusy(false);
    }
  };

  if (!shown) {
    return null;
  }
  return (
    <ModalSurface
      modalRef={ref}
      labelledBy={title}
      onClose={close}
      containerClassName="named-workspace-save-modal"
    >
      <ModalHeader title="Open Workspace" titleId={title} onClose={close} closeDisabled={busy} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <div className="modal-content">
          {names?.length ? (
            <>
              <p>Opening a workspace replaces the current windows.</p>
              <label className="modal-form-field">
                Workspace
                <select
                  className="modal-input"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  disabled={busy}
                >
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : names ? (
            <p>No saved workspaces.</p>
          ) : null}
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
          <button type="button" className="button cancel" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="button generic"
            disabled={busy}
            onClick={() => {
              close();
              eventBus.emit('named-workspace:save-dialog');
            }}
          >
            Save Current As…
          </button>
          <button type="submit" className="button save" disabled={busy || !selected}>
            {busy ? 'Opening…' : 'Open'}
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
