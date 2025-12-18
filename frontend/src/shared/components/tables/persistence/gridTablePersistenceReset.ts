const PREFIX = 'gridtable:';
type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const notifyResetAll = () => {
  resetListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
};

export const clearAllGridTableState = (storage: Storage | null = getStorage()): number => {
  if (!storage) {
    notifyResetAll();
    return 0;
  }
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  });
  notifyResetAll();
  return keys.length;
};

export const subscribeGridTableResetAll = (listener: ResetListener): (() => void) => {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
};
