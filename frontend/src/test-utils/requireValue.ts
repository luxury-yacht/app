export const requireValue = <T>(value: T, message: string): NonNullable<T> => {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value as NonNullable<T>;
};
