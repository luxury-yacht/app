/** Reproduces Array.prototype.sort's default UTF-16 ordering without implicit coercion. */
export const compareUtf16Strings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};
