/**
 * frontend/src/test-utils/objectDetail.ts
 *
 * Tagged object-details fixtures: tests state only the DTO fields they exercise.
 */

import type { ObjectDetail, ObjectDetailType, ObjectDetailTypes } from '@/core/refresh/types';

// Field names and value types stay checked against the DTO; any field may be left out.
type DeepPartial<T> = T extends readonly (infer Item)[]
  ? DeepPartial<Item>[]
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

export const objectDetailOf = <K extends ObjectDetailType>(
  detailType: K,
  details?: DeepPartial<ObjectDetailTypes[K]>
): ObjectDetail<K> => ({ detailType, details: details ?? {} }) as ObjectDetail<K>;
