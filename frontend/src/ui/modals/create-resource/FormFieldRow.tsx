import React from 'react';

interface FormFieldRowProps {
  children: React.ReactNode;
  label?: string;
  fullWidth?: boolean;
  className?: string;
  labelClassName?: string;
}

/**
 * Shared row wrapper for form label/value alignment.
 * Preserves existing ResourceForm classes to avoid visual regressions.
 */
export function FormFieldRow({
  children,
  label,
  fullWidth = false,
  className,
  labelClassName = 'resource-form-label',
}: FormFieldRowProps): React.ReactElement {
  const fullWidthClass = fullWidth ? ' resource-form-field--full-width' : '';
  const extraClass = className ? ` ${className}` : '';

  return (
    <div className={`resource-form-field${fullWidthClass}${extraClass}`}>
      {!fullWidth && label ? <label className={labelClassName}>{label}</label> : null}
      {children}
    </div>
  );
}
