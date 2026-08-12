/**
 * Builds a deliberately partial generated-model fixture for tests. Production
 * code must construct complete interface values at its boundary adapters.
 */
type DeepPartial<T> = T extends readonly (infer Item)[]
  ? DeepPartial<Item>[]
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

export const partialModelFixture = <T>(source: DeepPartial<T>): T => source as T;
