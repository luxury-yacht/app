let windowIdentity = 'browser-workspace';

export const setWindowIdentity = (identity: string): void => {
  if (identity.trim()) {
    windowIdentity = identity;
  }
};

export const getWindowIdentity = (): string => windowIdentity;
