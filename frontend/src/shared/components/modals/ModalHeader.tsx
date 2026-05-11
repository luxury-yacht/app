import React from 'react';
import { CategoryIcon, CloseIcon, type IconProps } from '@shared/components/icons/SharedIcons';

interface ModalHeaderProps {
  title: React.ReactNode;
  titleId: string;
  icon?: React.FC<IconProps>;
  onClose: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  className?: string;
  closeClassName?: string;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  titleId,
  icon: Icon = CategoryIcon,
  onClose,
  closeLabel = 'Close',
  closeDisabled = false,
  className,
  closeClassName,
}) => (
  <div className={['modal-header', className].filter(Boolean).join(' ')}>
    <div className="modal-title-group" id={titleId}>
      <Icon width={18} height={18} />
      <h2>{title}</h2>
    </div>
    <button
      className={['modal-close', closeClassName].filter(Boolean).join(' ')}
      onClick={onClose}
      disabled={closeDisabled}
      aria-label={closeLabel}
    >
      <CloseIcon />
    </button>
  </div>
);

export default ModalHeader;
