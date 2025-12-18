import { ReactNode } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  metadata?: any;
}

export interface DropdownProps {
  // Core props
  options: DropdownOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;

  // Display props
  placeholder?: string;
  displayValue?: string | ((value: string) => string);
  size?: 'default' | 'compact' | 'small';
  variant?: 'default' | 'minimal' | 'outlined';

  // State props
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;

  // Behavior props
  multiple?: boolean;
  searchable?: boolean;
  clearable?: boolean;

  // Customization props
  renderOption?: (option: DropdownOption, isSelected: boolean) => ReactNode;
  renderValue?: (value: string | string[], options: DropdownOption[]) => ReactNode;
  className?: string;
  dropdownClassName?: string;

  // Lifecycle callbacks
  onOpen?: (value: string | string[]) => void;
  onClose?: (value: string | string[]) => void;

  // Accessibility props
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaLabelledBy?: string;
  name?: string;
  id?: string;
}
