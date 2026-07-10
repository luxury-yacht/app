/**
 * frontend/src/shared/components/dropdowns/Dropdown/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the shared components.
 */

import type { ReactNode } from 'react';

export interface DropdownOption<TMetadata = unknown> {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
  metadata?: TMetadata;
}

export interface DropdownProps<TMetadata = unknown> {
  // Core props
  options: DropdownOption<TMetadata>[];
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
  searchMode?: 'local' | 'remote';
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  clearable?: boolean;
  showBulkActions?: boolean;

  // Customization props
  renderOption?: (option: DropdownOption<TMetadata>, isSelected: boolean) => ReactNode;
  renderValue?: (value: string | string[], options: DropdownOption<TMetadata>[]) => ReactNode;
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
