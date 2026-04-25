import React from 'react';

type FormIconActionVariant = 'add' | 'remove';

interface FormIconActionButtonProps {
  variant: FormIconActionVariant;
  label?: string;
  onClick?: () => void;
  hidden?: boolean;
  placeholder?: boolean;
  disabled?: boolean;
  className?: string;
}

interface FormGhostAddTextProps {
  text?: string | null;
}

interface FormEmptyActionRowProps {
  rowClassName: string;
  spacerClassName?: string;
  actionsClassName: string;
  alignLeft?: boolean;
  alignLeftClassName?: string;
  addLabel: string;
  removeLabel?: string;
  onAdd: () => void;
  addDisabled?: boolean;
  ghostText?: string | null;
  includeRemovePlaceholder?: boolean;
}

const AddIcon: React.FC<{ width?: number; height?: number }> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2V14M2 8H14" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const MinusIcon: React.FC<{ width?: number; height?: number }> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 8H14" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/**
 * Shared icon action button used by add/remove controls across form rows.
 */
export function FormIconActionButton({
  variant,
  label,
  onClick,
  hidden = false,
  placeholder = false,
  disabled = false,
  className,
}: FormIconActionButtonProps): React.ReactElement {
  const variantClass = variant === 'add' ? 'resource-form-add-btn' : 'resource-form-remove-btn';
  const hiddenClass = hidden ? ' resource-form-icon-btn--hidden' : '';
  const extraClass = className ? ` ${className}` : '';
  const resolvedClassName = `${variantClass} resource-form-icon-btn${hiddenClass}${extraClass}`;
  const inactive = hidden || placeholder || disabled;
  const resolvedLabel = placeholder ? undefined : label;

  return (
    <button
      type="button"
      className={resolvedClassName}
      aria-label={resolvedLabel}
      title={resolvedLabel}
      aria-hidden={placeholder ? 'true' : undefined}
      onClick={inactive ? undefined : onClick}
      disabled={inactive}
      tabIndex={inactive ? -1 : undefined}
    >
      {variant === 'add' ? (
        <AddIcon width={12} height={12} />
      ) : (
        <MinusIcon width={12} height={12} />
      )}
    </button>
  );
}

/**
 * Shared ghost helper text shown next to empty-state add actions.
 */
export function FormGhostAddText({ text }: FormGhostAddTextProps): React.ReactElement | null {
  if (!text) return null;
  return <span className="resource-form-action-ghost-text">{text}</span>;
}

/**
 * Shared empty-state action row with optional spacer and hidden remove placeholder.
 */
export function FormEmptyActionRow({
  rowClassName,
  spacerClassName,
  actionsClassName,
  alignLeft = false,
  alignLeftClassName,
  addLabel,
  removeLabel,
  onAdd,
  addDisabled = false,
  ghostText,
  includeRemovePlaceholder = true,
}: FormEmptyActionRowProps): React.ReactElement {
  const actionsAlignmentClass = alignLeft && alignLeftClassName ? ` ${alignLeftClassName}` : '';
  const resolvedRemoveLabel = removeLabel ?? addLabel.replace(/^Add\b/, 'Remove');

  return (
    <div className={rowClassName}>
      {spacerClassName ? <div className={spacerClassName} /> : null}
      <div className={`${actionsClassName}${actionsAlignmentClass}`}>
        <FormIconActionButton
          variant="add"
          label={addLabel}
          onClick={onAdd}
          disabled={addDisabled}
        />
        <FormGhostAddText text={ghostText} />
        {includeRemovePlaceholder ? (
          <FormIconActionButton variant="remove" label={resolvedRemoveLabel} hidden placeholder />
        ) : null}
      </div>
    </div>
  );
}
