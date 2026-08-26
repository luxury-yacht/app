import { DeleteIcon, MetadataIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import {
  type CustomMetadataColumnDefinition,
  type CustomMetadataColumnSource,
  createCustomMetadataColumnDefinition,
  defaultCustomMetadataColumnHeader,
} from '@shared/components/tables/customMetadataColumns';
import { useEffect, useId, useRef, useState } from 'react';
import './CustomMetadataColumnEditor.css';

export type CustomMetadataColumnEditorState =
  | { mode: 'create' }
  | { mode: 'edit'; definition: CustomMetadataColumnDefinition };

interface CustomMetadataColumnEditorProps {
  state: CustomMetadataColumnEditorState | null;
  definitions: CustomMetadataColumnDefinition[];
  onChange: (definitions: CustomMetadataColumnDefinition[]) => void;
  onClose: () => void;
}

export default function CustomMetadataColumnEditor({
  state,
  definitions,
  onChange,
  onClose,
}: Readonly<CustomMetadataColumnEditorProps>) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const sourceName = useId();
  const [source, setSource] = useState<CustomMetadataColumnSource>('label');
  const [metadataKey, setMetadataKey] = useState('');
  const [header, setHeader] = useState('');
  const [headerEdited, setHeaderEdited] = useState(false);

  useEffect(() => {
    if (!state) {
      return;
    }
    if (state.mode === 'edit') {
      setSource(state.definition.source);
      setMetadataKey(state.definition.metadataKey);
      setHeader(state.definition.header);
      setHeaderEdited(true);
      return;
    }
    setSource('label');
    setMetadataKey('');
    setHeader('');
    setHeaderEdited(false);
  }, [state]);

  useModalFocusTrap({
    ref: modalRef,
    disabled: !state,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  if (!state) {
    return null;
  }

  const normalizedKey = metadataKey.trim();
  const normalizedHeader = header.trim() || defaultCustomMetadataColumnHeader(normalizedKey);
  const candidate = normalizedKey
    ? createCustomMetadataColumnDefinition({
        source,
        metadataKey: normalizedKey,
        header: normalizedHeader,
      })
    : null;
  const duplicate =
    state.mode === 'create' &&
    candidate !== null &&
    definitions.some((definition) => definition.key === candidate.key);
  const canSave = candidate !== null && normalizedHeader.length > 0 && !duplicate;

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      onClose={onClose}
      containerClassName="custom-metadata-column-editor"
      closeOnBackdrop
    >
      <ModalHeader
        title={state.mode === 'edit' ? `Edit ${state.definition.header}` : 'Add custom column'}
        titleId={titleId}
        icon={MetadataIcon}
        onClose={onClose}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave || !candidate) {
            return;
          }
          onChange(
            state.mode === 'create'
              ? [...definitions, candidate]
              : definitions.map((definition) =>
                  definition.key === state.definition.key
                    ? { ...definition, header: normalizedHeader }
                    : definition
                )
          );
          onClose();
        }}
      >
        <div className="modal-content modal-form custom-metadata-column-editor__content">
          <div className="custom-metadata-column-editor__intro">
            Values come from the exact metadata key. Objects without it display <code>-</code>.
          </div>
          <fieldset
            className="custom-metadata-column-editor__source"
            disabled={state.mode === 'edit'}
          >
            <legend>Source</legend>
            <label className="modal-radio-label">
              <input
                type="radio"
                name={sourceName}
                value="label"
                checked={source === 'label'}
                onChange={() => setSource('label')}
              />
              Label
            </label>
            <label className="modal-radio-label">
              <input
                type="radio"
                name={sourceName}
                value="annotation"
                checked={source === 'annotation'}
                onChange={() => setSource('annotation')}
              />
              Annotation
            </label>
          </fieldset>
          <label className="custom-metadata-column-editor__field">
            <span>Metadata key</span>
            <input
              className={duplicate ? 'modal-input modal-input-error' : 'modal-input'}
              value={metadataKey}
              placeholder={source === 'label' ? 'app.kubernetes.io/owner' : 'example.com/owner'}
              disabled={state.mode === 'edit'}
              data-modal-initial-focus={state.mode === 'create' ? true : undefined}
              onChange={(event) => {
                const nextKey = event.target.value;
                setMetadataKey(nextKey);
                if (!headerEdited) {
                  setHeader(defaultCustomMetadataColumnHeader(nextKey));
                }
              }}
            />
            {!!duplicate && (
              <span className="modal-field-message modal-field-error">Already added</span>
            )}
          </label>
          <label className="custom-metadata-column-editor__field">
            <span>Column heading</span>
            <input
              className="modal-input"
              value={header}
              placeholder={
                normalizedKey ? defaultCustomMetadataColumnHeader(normalizedKey) : 'Owner'
              }
              data-modal-initial-focus={state.mode === 'edit' ? true : undefined}
              onChange={(event) => {
                setHeaderEdited(true);
                setHeader(event.target.value);
              }}
            />
          </label>
          {state.mode === 'edit' && (
            <div className="custom-metadata-column-editor__stable-id">
              Renaming keeps the column’s width, order, visibility, and favorite reference.
            </div>
          )}
        </div>
        <div className="modal-footer custom-metadata-column-editor__footer">
          {state.mode === 'edit' && (
            <button
              type="button"
              className="button danger custom-metadata-column-editor__remove"
              onClick={() => {
                onChange(
                  definitions.filter((definition) => definition.key !== state.definition.key)
                );
                onClose();
              }}
            >
              <DeleteIcon width={14} height={14} />
              Remove column
            </button>
          )}
          <button type="button" className="button cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button save" disabled={!canSave}>
            {state.mode === 'edit' ? 'Save changes' : 'Add column'}
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
