let nextTestId = 1;

export const createTestId = (prefix: string): string => {
  const id = `${prefix}-${nextTestId}`;
  nextTestId += 1;
  return id;
};
