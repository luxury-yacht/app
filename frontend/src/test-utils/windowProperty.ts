export const installWindowProperty = (key: PropertyKey, value: unknown): (() => void) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, key);
  Object.defineProperty(window, key, {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, key, previousDescriptor);
      return;
    }
    Reflect.deleteProperty(window, key);
  };
};
