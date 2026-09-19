/**
 * frontend/src/shared/components/dropdowns/Dropdown/hooks/useAriaAnnouncements.ts
 *
 * React hook for useAriaAnnouncements.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { DropdownOption } from '../types';

interface UseAriaAnnouncementsProps {
  value: string | string[];
  options: DropdownOption[];
  isOpen: boolean;
  highlightedIndex: number;
}

export function useAriaAnnouncements({
  value,
  options,
  isOpen,
  highlightedIndex,
}: UseAriaAnnouncementsProps) {
  const announcementRef = useRef<HTMLDivElement>(null);
  const previousValueRef = useRef<string | string[]>(value);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((message: string, duration: number) => {
    clearTimeout(timerRef.current);
    const region = announcementRef.current;
    if (!region) {
      return;
    }
    region.textContent = message;
    timerRef.current = setTimeout(() => {
      region.textContent = '';
    }, duration);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Announce selection changes
  useEffect(() => {
    if (announcementRef.current && value !== previousValueRef.current) {
      const selectedOptions = options.filter((opt) => {
        if (Array.isArray(value)) {
          return value.includes(opt.value);
        }
        return value === opt.value;
      });

      const announcement =
        selectedOptions.length > 0
          ? `Selected: ${selectedOptions.map((opt) => opt.label).join(', ')}`
          : 'No selection';

      previousValueRef.current = value;
      announce(announcement, 1000);
    }
  }, [value, options, announce]);

  // Announce highlighted option
  useEffect(() => {
    if (announcementRef.current && isOpen && highlightedIndex >= 0) {
      const highlightedOption = options[highlightedIndex];
      if (highlightedOption) {
        const announcement = highlightedOption.disabled
          ? `${highlightedOption.label}, disabled`
          : highlightedOption.label;
        announce(announcement, 500);
      }
    }
  }, [highlightedIndex, isOpen, options, announce]);

  // Announce dropdown state changes
  useEffect(() => {
    if (announcementRef.current) {
      const announcement = isOpen
        ? `Dropdown expanded, ${options.length} options available`
        : 'Dropdown collapsed';
      announce(announcement, 500);
    }
  }, [isOpen, options.length, announce]);

  return { announcementRef };
}
