import React from 'react';

interface FormSectionCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  titleClassName?: string;
  titleAction?: React.ReactNode;
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
}: FormSectionCardProps): React.ReactElement {
  const extraClass = className ? ` ${className}` : '';

  return (
    <div className={`resource-form-section${extraClass}`}>
      <h3 className={titleClassName}>
        {title}
        {titleAction}
      </h3>
      {children}
    </div>
  );
}
