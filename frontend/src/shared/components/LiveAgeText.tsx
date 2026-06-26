import React from 'react';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { type AgeTimestampInput, useAgeClock } from '@shared/hooks/useAgeClock';

export const formatLiveAgeText = (
  timestamp: AgeTimestampInput,
  now: Date | string | number = Date.now(),
  fallback = '-'
): string => {
  const age = formatAge(timestamp, now);
  return age === '-' ? fallback : age;
};

export interface LiveAgeTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  timestamp: AgeTimestampInput;
  fallback?: React.ReactNode;
  fullDateTitle?: boolean;
  title?: string;
  'data-gridtable-export-text'?: string;
}

export function LiveAgeText({
  timestamp,
  fallback = '-',
  fullDateTitle = false,
  title,
  ...spanProps
}: LiveAgeTextProps) {
  const now = useAgeClock(timestamp);
  const age = formatAge(timestamp, now);
  const hasAge = age !== '-';
  const text = hasAge ? age : fallback;
  const resolvedTitle = title ?? (fullDateTitle && hasAge ? formatFullDate(timestamp) : undefined);

  if (text === null || text === undefined || text === false) {
    return null;
  }

  return (
    <span {...spanProps} title={resolvedTitle}>
      {text}
    </span>
  );
}
