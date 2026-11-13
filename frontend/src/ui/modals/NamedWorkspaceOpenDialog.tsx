import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  DeleteNamedWorkspace,
  ListNamedWorkspaces,
  OpenNamedWorkspace,
  RenameNamedWorkspace,
} from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { eventBus, useEventBus } from '@/core/events';
import { ErrorSurface } from '@/shared/components/errors/ErrorSurface';
import ConfirmationModal from '@/shared/components/modals/ConfirmationModal';
import ModalHeader from '@/shared/components/modals/ModalHeader';
import ModalSurface from '@/shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@/shared/components/modals/useModalFocusTrap';
import './NamedWorkspaceSaveDialog.css';

export function NamedWorkspaceOpenDialog() {
  const title = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [entries, setEntries] = useState<panelwindow.NamedWorkspaceEntry[] | null>(null);
  const [selected, setSelected] = useState('');
  const [work, setWork] = useState<'open' | 'delete' | 'rename' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; action: string } | null>(null);
  const busy = work !== null;
  const names = entries?.map((entry) => entry.name) ?? null;
  // Every change names the snapshot this dialog listed, not just its name.
  const revision = entries?.find((entry) => entry.name === selected)?.revision ?? '';
  const close = () => {
    if (!busy) {
      setShown(false);
    }
  };

  // The backend owns the order of the list, so every change to it is read back.
  const load = (preferred?: string) =>
    ListNamedWorkspaces()
      .then((saved) => {
        const list = saved ?? [];
        setEntries(list);
        // After a change, keep what the user was acting on. If it is gone,
        // select nothing: a retry must not land on a different workspace.
        if (preferred === undefined) {
          setSelected(list[0]?.name ?? '');
        } else {
          setSelected(list.some((entry) => entry.name === preferred) ? preferred : '');
        }
        return list;
      })
      .catch((error) => {
        setFailure({ error, action: 'list' });
        return null;
      });

  // A refused change means the list is out of date: another window may have
  // renamed, deleted or replaced what this dialog offered. Read it again, then
  // say why the change did not happen.
  const refused = async (action: string, error: unknown) => {
    const list = await load(selected);
    setFailure({ error, action });
    return list;
  };

  useEventBus('named-workspace:open-dialog', () => {
    if (shown) {
      return;
    }
    setShown(true);
    setEntries(null);
    setSelected('');
    setFailure(null);
    setConfirmingDelete(false);
    setRenaming(false);
    void load();
  });
  const { focusDefaultControl } = useModalFocusTrap({
    ref,
    disabled: !shown || confirmingDelete,
    onEscape: () => {
      close();
      return true;
    },
  });
  // Switching between picking and renaming replaces the focused control.
  const lastRenaming = useRef(renaming);
  useEffect(() => {
    if (renaming !== lastRenaming.current) {
      focusDefaultControl();
    }
    lastRenaming.current = renaming;
  }, [renaming, focusDefaultControl]);

  const open = async () => {
    if (busy || !selected) {
      return;
    }
    setWork('open');
    setFailure(null);
    try {
      await OpenNamedWorkspace(getWindowIdentity(), selected, revision);
      setShown(false);
    } catch (error) {
      await refused('open', error);
    } finally {
      setWork(null);
    }
  };

  // Deleting removes the saved layout only; the open windows are untouched.
  const remove = async () => {
    setConfirmingDelete(false);
    setWork('delete');
    setFailure(null);
    try {
      await DeleteNamedWorkspace(getWindowIdentity(), selected, revision);
      const remaining = (entries ?? []).filter((entry) => entry.name !== selected);
      setEntries(remaining);
      setSelected(remaining[0]?.name ?? '');
    } catch (error) {
      await refused('delete', error);
    } finally {
      setWork(null);
    }
  };

  const rename = async (newName: string) => {
    setWork('rename');
    setFailure(null);
    try {
      await RenameNamedWorkspace(getWindowIdentity(), selected, newName, revision);
      await load(newName);
      setRenaming(false);
    } catch (error) {
      const list = await refused('rename', error);
      // The form must not go on to rename whichever workspace is selected next.
      if (list && !list.some((entry) => entry.name === selected)) {
        setRenaming(false);
      }
    } finally {
      setWork(null);
    }
  };

  if (!shown) {
    return null;
  }
  const alert = !!failure && (
    <div role="alert">
      <ErrorSurface
        kind="operational"
        error={failure.error}
        context={{ source: 'NamedWorkspace', action: failure.action }}
      />
    </div>
  );
  return (
    <>
      <ModalSurface
        modalRef={ref}
        labelledBy={title}
        onClose={close}
        containerClassName="named-workspace-save-modal"
      >
        <ModalHeader
          title={renaming ? 'Rename Workspace' : 'Open Workspace'}
          titleId={title}
          onClose={close}
          closeDisabled={busy}
        />
        {renaming ? (
          <RenameWorkspaceForm
            current={selected}
            names={names ?? []}
            busy={busy}
            onCancel={() => {
              setFailure(null);
              setRenaming(false);
            }}
            onRename={(newName) => void rename(newName)}
          >
            {alert}
          </RenameWorkspaceForm>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void open();
            }}
          >
            <div className="modal-content">
              <SavedWorkspacePicker
                names={names}
                selected={selected}
                disabled={busy}
                onSelect={setSelected}
              />
              {alert}
            </div>
            <div className="modal-footer">
              {!!selected && (
                <>
                  <button
                    type="button"
                    className="button generic"
                    disabled={busy}
                    onClick={() => {
                      setFailure(null);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="button danger named-workspace-delete"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete
                  </button>
                </>
              )}
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
                {work === 'open' ? 'Opening…' : 'Open'}
              </button>
            </div>
          </form>
        )}
      </ModalSurface>
      <ConfirmationModal
        isOpen={confirmingDelete}
        title="Delete Workspace"
        message={`Delete "${selected}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

// Renaming never takes another workspace's name: that would discard its layout.
function RenameWorkspaceForm({
  current,
  names,
  busy,
  onCancel,
  onRename,
  children,
}: Readonly<{
  current: string;
  names: string[];
  busy: boolean;
  onCancel: () => void;
  onRename: (newName: string) => void;
  children: ReactNode;
}>) {
  const [draft, setDraft] = useState(current);
  const newName = draft.trim();
  const taken = newName !== current && names.includes(newName);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onRename(newName);
      }}
    >
      <div className="modal-content">
        <label className="modal-form-field">
          <span>New name</span>
          <input
            className="modal-input"
            name="workspace-new-name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            required
            data-modal-initial-focus
          />
        </label>
        {taken ? (
          <p className="modal-field-error">A workspace with this name already exists.</p>
        ) : null}
        {children}
      </div>
      <div className="modal-footer">
        <button type="button" className="button cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="button save"
          disabled={busy || !newName || newName === current || taken}
        >
          {busy ? 'Renaming…' : 'Rename'}
        </button>
      </div>
    </form>
  );
}

function SavedWorkspacePicker({
  names,
  selected,
  disabled,
  onSelect,
}: Readonly<{
  names: string[] | null;
  selected: string;
  disabled: boolean;
  onSelect: (name: string) => void;
}>) {
  if (!names) {
    return null;
  }
  if (names.length === 0) {
    return <p>No saved workspaces.</p>;
  }
  return (
    <>
      <p>Opening a workspace replaces the current windows.</p>
      <label className="modal-form-field">
        <span>Workspace</span>
        <select
          className="modal-input"
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
          disabled={disabled}
        >
          {selected === '' ? (
            <option value="" disabled>
              Choose a workspace
            </option>
          ) : null}
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
