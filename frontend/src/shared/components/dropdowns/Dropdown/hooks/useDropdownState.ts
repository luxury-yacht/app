import { useState, useRef, useCallback, useEffect } from 'react';

export function useDropdownState(
  value: string | string[],
  onChange: (value: string | string[]) => void,
  multiple = false,
  disabled = false
) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openDropdown = useCallback(() => {
    if (!disabled) {
      setIsOpen(true);
      setHighlightedIndex(-1);
      setSearchQuery('');
    }
  }, [disabled]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    setSearchQuery('');
  }, []);

  const toggleDropdown = useCallback(() => {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }, [isOpen, openDropdown, closeDropdown]);

  const selectOption = useCallback(
    (optionValue: string) => {
      if (multiple) {
        const currentValues = Array.isArray(value) ? value : [];
        const newValues = currentValues.includes(optionValue)
          ? currentValues.filter((v) => v !== optionValue)
          : [...currentValues, optionValue];
        onChange(newValues);
      } else {
        onChange(optionValue);
        // Close dropdown after selection unless it's a menu-style dropdown
        closeDropdown();
      }
    },
    [multiple, value, onChange, closeDropdown]
  );

  const isSelected = useCallback(
    (optionValue: string) => {
      if (multiple) {
        return Array.isArray(value) && value.includes(optionValue);
      }
      return value === optionValue;
    },
    [multiple, value]
  );

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen, closeDropdown]);

  return {
    isOpen,
    highlightedIndex,
    searchQuery,
    dropdownRef,
    triggerRef,
    menuRef,
    openDropdown,
    closeDropdown,
    toggleDropdown,
    selectOption,
    isSelected,
    setHighlightedIndex,
    setSearchQuery,
  };
}
