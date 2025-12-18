/**
 * Parse CPU value to millicores
 */
export const parseCpuToMillicores = (val: string | undefined): number => {
  if (!val || val === '-' || val === 'not set') return 0;
  if (val.endsWith('m')) {
    return parseFloat(val.slice(0, -1));
  }
  return parseFloat(val) * 1000; // Convert cores to millicores
};

/**
 * Parse memory value to MB
 */
export const parseMemToMB = (val: string | undefined): number => {
  if (!val || val === '-' || val === 'not set') return 0;
  const num = parseFloat(val);
  if (isNaN(num)) return 0;
  if (val.endsWith('Ki')) return num / 1024; // Convert Ki to Mi
  if (val.endsWith('Mi')) return num;
  if (val.endsWith('Gi')) return num * 1024; // Convert Gi to Mi
  if (val.endsWith('GB')) return num * 1024;
  if (val.endsWith('MB')) return num;
  return num / (1024 * 1024); // Assume bytes
};

/**
 * Calculate overcommitted percentage for CPU
 */
export const calculateCpuOvercommitted = (
  limits: string | undefined,
  allocatable: string | undefined
): number => {
  const limitsValue = parseCpuToMillicores(limits);
  const allocatableValue = parseCpuToMillicores(allocatable);
  if (allocatableValue > 0 && limitsValue > allocatableValue) {
    return Math.round(((limitsValue - allocatableValue) / allocatableValue) * 100);
  }
  return 0;
};

/**
 * Calculate overcommitted percentage for Memory
 */
export const calculateMemoryOvercommitted = (
  limits: string | undefined,
  allocatable: string | undefined
): number => {
  const limitsValue = parseMemToMB(limits);
  const allocatableValue = parseMemToMB(allocatable);
  if (allocatableValue > 0 && limitsValue > allocatableValue) {
    return Math.round(((limitsValue - allocatableValue) / allocatableValue) * 100);
  }
  return 0;
};
