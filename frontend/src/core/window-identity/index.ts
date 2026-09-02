let windowIdentity = 'browser-workspace';
let workspaceProjectionIdentity: string | null = null;

export const setWindowIdentity = (identity: string): void => {
  if (identity.trim()) {
    windowIdentity = identity;
  }
};

export const getWindowIdentity = (): string => windowIdentity;

export const setWorkspaceProjectionIdentity = (identity: string): void => {
  workspaceProjectionIdentity = identity.trim() || null;
};

export const getWorkspaceProjectionIdentity = (): string =>
  workspaceProjectionIdentity ?? windowIdentity;
