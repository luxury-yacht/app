import { Dropdown, type DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { DeleteIcon, MetadataIcon } from '@shared/components/icons/SharedIcons';
import ModalHeader from '@shared/components/modals/ModalHeader';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import {
  type AvailableCustomMetadataKey,
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
  availableKeys: AvailableCustomMetadataKey[];
  onChange: (definitions: CustomMetadataColumnDefinition[]) => void;
  onClose: () => void;
}

export default function CustomMetadataColumnEditor({
  state,
  definitions,
  availableKeys,
  onChange,
  onClose,
}: Readonly<CustomMetadataColumnEditorProps>) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const metadataKeyLabelId = useId();
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
  const editorKeys =
    state.mode === 'edit' &&
    !availableKeys.some(
      (key) =>
        key.source === state.definition.source && key.metadataKey === state.definition.metadataKey
    )
      ? [
          ...availableKeys,
          {
            source: state.definition.source,
            metadataKey: state.definition.metadataKey,
            sampleValues: [],
          },
        ]
      : availableKeys;
  const metadataKeyOptions: DropdownOption<AvailableCustomMetadataKey>[] = (
    ['label', 'annotation'] as const
  ).flatMap((optionSource) => {
    const sourceKeys = editorKeys.filter((key) => key.source === optionSource);
    if (sourceKeys.length === 0) {
      return [];
    }
    return [
      {
        value: `__${optionSource}_header__`,
        label: optionSource === 'label' ? 'Labels' : 'Annotations',
        group: 'header',
      },
      ...sourceKeys.map((key) => ({
        value: `metadata:${key.source}:${key.metadataKey}`,
        label: key.metadataKey,
        metadata: key,
        disabled:
          state.mode === 'create' &&
          definitions.some(
            (definition) =>
              definition.source === key.source && definition.metadataKey === key.metadataKey
          ),
      })),
    ];
  });
  const selectedOptionValue = normalizedKey ? `metadata:${source}:${normalizedKey}` : '';
  const selectedMetadata = editorKeys.find(
    (key) => key.source === source && key.metadataKey === normalizedKey
  );
  const metadataKeyPlaceholder =
    availableKeys.length === 0 ? 'No metadata keys available' : 'Select a key';

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      onClose={onClose}
      containerClassName="custom-metadata-column-editor"
      closeOnBackdrop
    >
      <ModalHeader
        title={state.mode === 'edit' ? `Edit ${state.definition.header}` : 'Add Custom Column'}
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
          <div>Select a metadata Label or Annotation to use as a custom column.</div>
          <div className="custom-metadata-column-editor__field">
            <span id={metadataKeyLabelId}>Metadata Key</span>
            <Dropdown
              options={metadataKeyOptions}
              value={selectedOptionValue}
              onChange={(value) => {
                const nextValue = Array.isArray(value) ? (value[0] ?? '') : value;
                const nextMetadata = metadataKeyOptions.find(
                  (option) => option.value === nextValue
                )?.metadata;
                if (!nextMetadata) {
                  return;
                }
                setSource(nextMetadata.source);
                setMetadataKey(nextMetadata.metadataKey);
                if (!headerEdited) {
                  setHeader(defaultCustomMetadataColumnHeader(nextMetadata.metadataKey));
                }
              }}
              displayValue={(value) => {
                const selected = metadataKeyOptions.find(
                  (option) => option.value === value
                )?.metadata;
                return selected
                  ? `${selected.source === 'label' ? 'Label' : 'Annotation'} · ${selected.metadataKey}`
                  : value || metadataKeyPlaceholder;
              }}
              placeholder={metadataKeyPlaceholder}
              ariaLabel="Metadata Key"
              ariaLabelledBy={metadataKeyLabelId}
              searchable
              disabled={state.mode === 'edit' || availableKeys.length === 0}
              error={duplicate}
              className="custom-metadata-column-editor__key-dropdown"
              dropdownClassName="custom-metadata-column-editor__key-menu"
            />
            {state.mode === 'create' && availableKeys.length === 0 && (
              <span className="modal-field-message">
                No label or annotation keys are available in the current rows.
              </span>
            )}
            {!!duplicate && (
              <span className="modal-field-message modal-field-error">Already added</span>
            )}
          </div>
          {!!normalizedKey && (
            <div className="custom-metadata-column-editor__samples">
              <span>Sample values</span>
              {selectedMetadata?.sampleValues.length ? (
                <div className="custom-metadata-column-editor__sample-list">
                  {selectedMetadata.sampleValues.map((value) => (
                    <code key={value}>{value || '(empty)'}</code>
                  ))}
                </div>
              ) : (
                <div className="custom-metadata-column-editor__no-samples">
                  No sample values in the current rows.
                </div>
              )}
            </div>
          )}
          <label className="custom-metadata-column-editor__field">
            <span>Column Name</span>
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
            {state.mode === 'edit' ? 'Save changes' : 'Add'}
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
