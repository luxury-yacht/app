/**
 * frontend/src/core/refresh/refresherConfig.ts
 *
 * Module source for refresherConfig.
 * Implements refresherConfig logic for the core layer.
 */

import { REFRESHER_TIMING_BY_NAME, type RefresherTiming } from './domainRegistry';
import type { StaticRefresherName } from './refresherTypes';

export type { RefresherTiming };

const resolveTiming = (name: StaticRefresherName): RefresherTiming => {
  const timing = REFRESHER_TIMING_BY_NAME[name];
  if (!timing) {
    throw new Error(`No refresh timing registered for ${name}`);
  }

  return timing;
};

export const refresherConfig = (name: StaticRefresherName): RefresherTiming => resolveTiming(name);
