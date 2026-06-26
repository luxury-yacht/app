import { useEffect, useRef, useState } from 'react';

export type AgeTimestampInput = Date | string | number | null | undefined;

type TimerHandle = ReturnType<typeof setTimeout>;
type AgeClockListener = (now: number) => void;

const listeners = new Set<AgeClockListener>();
const activeTimestamps = new Map<symbol, number | null>();
let timer: TimerHandle | null = null;
let currentNow = Date.now();

export const parseAgeTimestampMillis = (timestamp: AgeTimestampInput): number | null => {
  if (!timestamp) return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const millis = date.getTime();
  return Number.isNaN(millis) ? null : millis;
};

const hasSecondLevelAge = (): boolean => {
  for (const timestamp of activeTimestamps.values()) {
    if (timestamp === null) continue;
    if (Math.max(0, currentNow - timestamp) < 60_000) {
      return true;
    }
  }
  return false;
};

const clearAgeTimer = () => {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
};

const scheduleAgeTimer = () => {
  clearAgeTimer();
  if (listeners.size === 0) return;

  const delay = hasSecondLevelAge() ? 1000 : 60_000;
  timer = setTimeout(() => {
    timer = null;
    currentNow = Date.now();
    for (const listener of listeners) {
      listener(currentNow);
    }
    scheduleAgeTimer();
  }, delay);
};

const subscribeAgeClock = (listener: AgeClockListener): (() => void) => {
  listeners.add(listener);
  currentNow = Date.now();
  listener(currentNow);
  scheduleAgeTimer();

  return () => {
    listeners.delete(listener);
    scheduleAgeTimer();
  };
};

const registerAgeTimestamp = (key: symbol, timestamp: number | null): (() => void) => {
  activeTimestamps.set(key, timestamp);
  scheduleAgeTimer();

  return () => {
    activeTimestamps.delete(key);
    scheduleAgeTimer();
  };
};

export const useAgeClock = (timestamp: AgeTimestampInput): number => {
  const [now, setNow] = useState(() => Date.now());
  const keyRef = useRef<symbol>(Symbol('age-clock-subscriber'));
  const timestampMillis = parseAgeTimestampMillis(timestamp);

  useEffect(() => registerAgeTimestamp(keyRef.current, timestampMillis), [timestampMillis]);

  useEffect(() => subscribeAgeClock(setNow), []);

  return now;
};
