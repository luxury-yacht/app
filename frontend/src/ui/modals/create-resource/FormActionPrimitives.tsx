import React from 'react';
import { AddIcon, MinusIcon } from '@shared/components/icons/MenuIcons';

type FormIconActionVariant = 'add' | 'remove';

interface FormIconActionButtonProps {
  variant: FormIconActionVariant;
  label?: string;
  onClick?: () => void;
  hidden?: boolean;
  placeholder?: boolean;
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
  ghostText?: string | null;
  includeRemovePlaceholder?: boolean;
}

/**
 * Shared icon action button used by add/remove controls across form rows.
 */
export function FormIconActionButton({
  variant,
  label,
  onClick,
  hidden = false,
  placeholder = false,
  className,
}: FormIconActionButtonProps): React.ReactElement {
  const variantClass = variant === 'add' ? 'resource-form-add-btn' : 'resource-form-remove-btn';
  const hiddenClass = hidden ? ' resource-form-icon-btn--hidden' : '';
  const extraClass = className ? ` ${className}` : '';
  const resolvedClassName = `${variantClass} resource-form-icon-btn${hiddenClass}${extraClass}`;
  const inactive = hidden || placeholder;
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
  ghostText,
  includeRemovePlaceholder = true,
}: FormEmptyActionRowProps): React.ReactElement {
  const actionsAlignmentClass = alignLeft && alignLeftClassName ? ` ${alignLeftClassName}` : '';
  const resolvedRemoveLabel = removeLabel ?? addLabel.replace(/^Add\b/, 'Remove');

  return (
    <div className={rowClassName}>
      {spacerClassName ? <div className={spacerClassName} /> : null}
      <div className={`${actionsClassName}${actionsAlignmentClass}`}>
        <FormIconActionButton variant="add" label={addLabel} onClick={onAdd} />
        <FormGhostAddText text={ghostText} />
        {includeRemovePlaceholder ? (
          <FormIconActionButton variant="remove" label={resolvedRemoveLabel} hidden placeholder />
        ) : null}
      </div>
    </div>
  );
}
