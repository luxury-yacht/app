import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import IconBar, { type IconBarItem } from '@shared/components/IconBar/IconBar';
import { CheckIcon, CloseIcon, DeleteIcon, EditIcon } from '@shared/components/icons/SharedIcons';
import { useEffect, useId, useRef, useState } from 'react';
import { DeleteNamedWorkspace, OpenNamedWorkspace, RenameNamedWorkspace } from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { eventBus, useEventBus } from '@/core/events';
import { listNamedWorkspaces } from '@/core/persistence/namedWorkspaces';
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
  const stopRenaming = () => {
    if (!busy) {
      setFailure(null);
      setRenaming(false);
    }
  };

  // The backend owns the order of the list, so every change to it is read back.
  const load = (preferred?: string) =>
    listNamedWorkspaces()
      .then((list) => {
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
    // Escape leaves an inline rename before it closes the dialog.
    onEscape: () => {
      if (renaming) {
        stopRenaming();
      } else {
        close();
      }
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
        <ModalHeader title="Open Workspace" titleId={title} onClose={close} closeDisabled={busy} />
        <div className="modal-content named-workspace-content">
          <SavedWorkspacePicker
            names={names}
            selected={selected}
            busy={busy}
            renaming={renaming}
            onSelect={setSelected}
            onStartRename={() => {
              setFailure(null);
              setRenaming(true);
            }}
            onDelete={() => setConfirmingDelete(true)}
            onCancelRename={stopRenaming}
            onRename={(newName) => void rename(newName)}
          />
          {alert}
        </div>
        <OpenWorkspaceFooter
          empty={names?.length === 0}
          busy={busy}
          canOpen={!!selected && !renaming}
          opening={work === 'open'}
          onCancel={close}
          onSaveCurrent={() => {
            close();
            eventBus.emit('named-workspace:save-dialog');
          }}
          onOpen={() => void open()}
        />
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

function SavedWorkspacePicker({
  names,
  selected,
  busy,
  renaming,
  onSelect,
  onStartRename,
  onDelete,
  onCancelRename,
  onRename,
}: Readonly<{
  names: string[] | null;
  selected: string;
  busy: boolean;
  renaming: boolean;
  onSelect: (name: string) => void;
  onStartRename: () => void;
  onDelete: () => void;
  onCancelRename: () => void;
  onRename: (newName: string) => void;
}>) {
  if (!names) {
    return null;
  }
  if (names.length === 0) {
    return (
      <div className="named-workspace-empty">
        <p className="named-workspace-empty-title">No saved workspaces</p>
        <p className="named-workspace-hint">Save the current windows to reopen them later.</p>
      </div>
    );
  }
  return (
    <>
      {renaming ? (
        <RenameWorkspaceField
          current={selected}
          names={names}
          busy={busy}
          onCancel={onCancelRename}
          onRename={onRename}
        />
      ) : (
        <WorkspaceChoice
          names={names}
          selected={selected}
          busy={busy}
          onSelect={onSelect}
          onStartRename={onStartRename}
          onDelete={onDelete}
        />
      )}
      <p className="named-workspace-hint">Opening a workspace replaces the current windows.</p>
    </>
  );
}

// Rename and Delete act on the selection, so they wait for one: after a refused
// change nothing is selected, and a retry must not reach another workspace.
function WorkspaceChoice({
  names,
  selected,
  busy,
  onSelect,
  onStartRename,
  onDelete,
}: Readonly<{
  names: string[];
  selected: string;
  busy: boolean;
  onSelect: (name: string) => void;
  onStartRename: () => void;
  onDelete: () => void;
}>) {
  const pickerId = useId();
  const unavailable = busy || !selected;
  const actions: IconBarItem[] = [
    {
      type: 'action',
      id: 'rename-workspace',
      icon: <EditIcon width={16} height={16} />,
      title: 'Rename workspace',
      onClick: onStartRename,
      disabled: unavailable,
    },
    {
      type: 'action',
      id: 'delete-workspace',
      icon: <DeleteIcon width={16} height={16} />,
      title: 'Delete workspace',
      onClick: onDelete,
      disabled: unavailable,
    },
  ];
  return (
    <div className="named-workspace-field">
      <label htmlFor={pickerId}>Workspace</label>
      <div className="named-workspace-field-row">
        <Dropdown
          id={pickerId}
          options={names.map((name) => ({ value: name, label: name }))}
          value={selected}
          onChange={(value) => onSelect(String(value))}
          placeholder="Choose a workspace"
          disabled={busy}
        />
        <IconBar items={actions} />
      </div>
    </div>
  );
}

// Renaming never takes another workspace's name: that would discard its layout.
function RenameWorkspaceField({
  current,
  names,
  busy,
  onCancel,
  onRename,
}: Readonly<{
  current: string;
  names: string[];
  busy: boolean;
  onCancel: () => void;
  onRename: (newName: string) => void;
}>) {
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(current);
  const newName = draft.trim();
  const taken = newName !== current && names.includes(newName);
  const blocked = busy || !newName || newName === current || taken;
  const save = () => {
    if (!blocked) {
      onRename(newName);
    }
  };
  const actions: IconBarItem[] = [
    {
      type: 'action',
      id: 'save-workspace-name',
      icon: <CheckIcon width={16} height={16} />,
      title: 'Save new name',
      onClick: save,
      disabled: blocked,
    },
    {
      type: 'action',
      id: 'cancel-workspace-rename',
      icon: <CloseIcon width={14} height={14} />,
      title: 'Cancel rename',
      onClick: onCancel,
      disabled: busy,
    },
  ];
  return (
    <div className="named-workspace-field">
      <label htmlFor={inputId}>New name</label>
      <div className="named-workspace-field-row">
        <input
          id={inputId}
          className="modal-input"
          name="workspace-new-name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
          disabled={busy}
          aria-invalid={taken || undefined}
          aria-describedby={taken ? errorId : undefined}
          data-modal-initial-focus
        />
        <IconBar items={actions} />
      </div>
      {taken ? (
        <p id={errorId} className="modal-field-message modal-field-error">
          A workspace with this name already exists.
        </p>
      ) : null}
    </div>
  );
}

function OpenWorkspaceFooter({
  empty,
  busy,
  canOpen,
  opening,
  onCancel,
  onSaveCurrent,
  onOpen,
}: Readonly<{
  empty: boolean;
  busy: boolean;
  canOpen: boolean;
  opening: boolean;
  onCancel: () => void;
  onSaveCurrent: () => void;
  onOpen: () => void;
}>) {
  // With nothing saved there is nothing to open: saving is the dialog's action.
  if (empty) {
    return (
      <div className="modal-footer">
        <button type="button" className="button cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button save" disabled={busy} onClick={onSaveCurrent}>
          Save Current As…
        </button>
      </div>
    );
  }
  return (
    <div className="modal-footer">
      <button
        type="button"
        className="button generic named-workspace-footer-start"
        disabled={busy}
        onClick={onSaveCurrent}
      >
        Save Current As…
      </button>
      <button type="button" className="button cancel" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="button save" disabled={busy || !canOpen} onClick={onOpen}>
        {opening ? 'Opening…' : 'Open'}
      </button>
    </div>
  );
}
