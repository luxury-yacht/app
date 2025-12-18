import { createContext, useContext, useMemo, useState, ReactNode } from 'react';

export type ConnectionState = 'healthy' | 'retrying' | 'offline' | 'auth_failed' | 'rebuilding';

export interface ConnectionStatusEvent {
  state: ConnectionState;
  label?: string;
  description?: string;
  message?: string;
  nextRetryMs?: number;
  updatedAt?: number;
}

export interface ConnectionStatus {
  state: ConnectionState;
  label: string;
  description?: string;
  message: string;
  nextRetryMs?: number;
  updatedAt: number;
}

const defaultStatus: ConnectionStatus = {
  state: 'healthy',
  label: 'Connected',
  description: 'Connected to cluster',
  message: 'Connected to cluster',
  nextRetryMs: 0,
  updatedAt: Date.now(),
};

interface ConnectionStatusContextValue {
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;
}

const ConnectionStatusContext = createContext<ConnectionStatusContextValue | undefined>(undefined);

const normalizeStatus = (payload: ConnectionStatusEvent): ConnectionStatus => {
  const label = payload.label ?? defaultStatus.label;
  return {
    state: payload.state ?? defaultStatus.state,
    label,
    description: payload.description ?? defaultStatus.description,
    message: payload.message ?? label,
    nextRetryMs: payload.nextRetryMs,
    updatedAt: payload.updatedAt ?? Date.now(),
  };
};

export const ConnectionStatusProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<ConnectionStatus>(defaultStatus);
  const value = useMemo(() => ({ status, setStatus }), [status]);
  return (
    <ConnectionStatusContext.Provider value={value}>{children}</ConnectionStatusContext.Provider>
  );
};

const useConnectionStatusContext = () => {
  const context = useContext(ConnectionStatusContext);
  if (!context) {
    throw new Error('useConnectionStatus must be used within ConnectionStatusProvider');
  }
  return context;
};

export const useConnectionStatus = () => useConnectionStatusContext().status;

export const useConnectionStatusActions = () => {
  const { setStatus } = useConnectionStatusContext();
  const updateFromEvent = (payload?: ConnectionStatusEvent) => {
    if (!payload?.state) {
      return;
    }
    setStatus(normalizeStatus(payload));
  };
  return { updateFromEvent };
};

export const getDefaultConnectionStatus = () => defaultStatus;
export const mapConnectionStatusEvent = (payload: ConnectionStatusEvent) =>
  normalizeStatus(payload);
