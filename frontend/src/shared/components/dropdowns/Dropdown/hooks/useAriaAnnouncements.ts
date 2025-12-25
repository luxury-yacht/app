/**
 * frontend/src/shared/components/dropdowns/Dropdown/hooks/useAriaAnnouncements.ts
 *
 * React hook for useAriaAnnouncements.
 * Encapsulates state and side effects for the shared components.
 */

import { useEffect, useRef } from 'react';
import { DropdownOption } from '../types';

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

      announcementRef.current.textContent = announcement;
      previousValueRef.current = value;

      // Clear announcement after a delay to allow screen readers to read it
      setTimeout(() => {
        if (announcementRef.current) {
          announcementRef.current.textContent = '';
        }
      }, 1000);
    }
  }, [value, options]);

  // Announce highlighted option
  useEffect(() => {
    if (announcementRef.current && isOpen && highlightedIndex >= 0) {
      const highlightedOption = options[highlightedIndex];
      if (highlightedOption) {
        const announcement = highlightedOption.disabled
          ? `${highlightedOption.label}, disabled`
          : highlightedOption.label;
        announcementRef.current.textContent = announcement;

        setTimeout(() => {
          if (announcementRef.current) {
            announcementRef.current.textContent = '';
          }
        }, 500);
      }
    }
  }, [highlightedIndex, isOpen, options]);

  // Announce dropdown state changes
  useEffect(() => {
    if (announcementRef.current) {
      const announcement = isOpen
        ? `Dropdown expanded, ${options.length} options available`
        : 'Dropdown collapsed';
      announcementRef.current.textContent = announcement;

      setTimeout(() => {
        if (announcementRef.current) {
          announcementRef.current.textContent = '';
        }
      }, 500);
    }
  }, [isOpen, options.length]);

  return { announcementRef };
}
