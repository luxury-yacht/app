/**
 * frontend/src/core/refresh/refresherConfig.ts
 *
 * Module source for refresherConfig.
 * Implements refresherConfig logic for the core layer.
 */

import type {
  ClusterRefresherName,
  NamespaceRefresherName,
  StaticRefresherName,
  SystemRefresherName,
} from './refresherTypes';
import { REFRESHER_TIMING_BY_NAME, type RefresherTiming } from './domainRegistry';

export type { RefresherTiming };

const resolveTiming = (name: StaticRefresherName): RefresherTiming => {
  const timing = REFRESHER_TIMING_BY_NAME[name];
  if (!timing) {
    throw new Error(`No refresh timing registered for ${name}`);
  }

  return timing;
};

export const refresherConfig = (name: StaticRefresherName): RefresherTiming => resolveTiming(name);

export const namespaceRefresherConfig = (name: NamespaceRefresherName): RefresherTiming =>
  resolveTiming(name);

export const clusterRefresherConfig = (name: ClusterRefresherName): RefresherTiming =>
  resolveTiming(name);

export const systemRefresherConfig = (name: SystemRefresherName): RefresherTiming =>
  resolveTiming(name);
