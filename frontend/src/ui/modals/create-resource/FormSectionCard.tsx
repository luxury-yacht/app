import React from 'react';

interface FormSectionCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  titleClassName?: string;
  titleAction?: React.ReactNode;
  /** Override label min-width for fields in this section. */
  labelWidth?: string;
}

/**
 * Shared section card wrapper for Create Resource form sections.
 * Keeps existing section/title classes so spacing and typography remain unchanged.
 */
export function FormSectionCard({
  title,
  children,
  className,
  titleClassName = 'resource-form-section-title',
  titleAction,
  labelWidth,
}: FormSectionCardProps): React.ReactElement {
  const extraClass = className ? ` ${className}` : '';
  const style = labelWidth
    ? ({ '--section-label-width': labelWidth } as React.CSSProperties)
    : undefined;

  return (
    <div className={`resource-form-section${extraClass}`} style={style}>
      <h3 className={titleClassName}>
        {title}
        {titleAction}
      </h3>
      {children}
    </div>
  );
}
