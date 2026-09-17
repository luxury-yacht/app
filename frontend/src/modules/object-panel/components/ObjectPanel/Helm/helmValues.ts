/** Value selection for the Helm Defaults, Overrides, and Merged views. */
type HelmValue = string | number | boolean | null | HelmValue[] | HelmValueObject;
type HelmValueObject = { [key: string]: HelmValue };

export interface HelmValuesData {
  allValues?: HelmValueObject;
  userValues?: HelmValueObject;
  [key: string]: HelmValue | undefined;
}

export type HelmValuesMode = 'defaults' | 'overrides' | 'merged';

const isValuesObject = (value: HelmValue | undefined): value is HelmValueObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const ownsKey = (value: HelmValue | undefined, key: string): value is HelmValueObject =>
  isValuesObject(value) && Object.getOwnPropertyDescriptor(value, key) !== undefined;

function defaultValues(all: HelmValueObject, overrides: HelmValue | undefined): HelmValueObject {
  const result: HelmValueObject = {};
  for (const key of Object.keys(all)) {
    const value = all[key];
    if (isValuesObject(value)) {
      const nested = defaultValues(value, ownsKey(overrides, key) ? overrides[key] : undefined);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    } else if (!ownsKey(overrides, key)) {
      result[key] = value;
    }
  }
  return result;
}

function mergedValues(all: HelmValueObject, overrides: HelmValue | undefined): HelmValueObject {
  const result: HelmValueObject = {};
  for (const key of Object.keys(all)) {
    const value = all[key];
    if (isValuesObject(value)) {
      result[key] = mergedValues(value, ownsKey(overrides, key) ? overrides[key] : undefined);
    } else if (ownsKey(overrides, key)) {
      result[key] = overrides[key] ?? null;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function ownOverrides(value: HelmValue | undefined): HelmValue | undefined {
  if (!isValuesObject(value)) {
    return value;
  }
  const result: HelmValueObject = {};
  for (const key of Object.keys(value)) {
    result[key] = ownOverrides(value[key]) ?? null;
  }
  return result;
}

export function selectHelmValues(
  data: HelmValuesData,
  mode: HelmValuesMode
): HelmValue | undefined {
  const all = data.allValues ?? (data as HelmValueObject);
  const overrides = data.userValues ?? {};
  if (mode === 'overrides') {
    return ownOverrides(overrides);
  }
  if (all === null || all === undefined) {
    return all;
  }
  if (!isValuesObject(all)) {
    if (!isValuesObject(overrides)) {
      return all;
    }
    return mode === 'defaults' ? undefined : overrides;
  }
  return mode === 'defaults' ? defaultValues(all, overrides) : mergedValues(all, overrides);
}
