import { runBrokerRead } from '@/core/read-diagnostics';
import type { AppStateRequest } from './types';

export const requestAppState = async <T>({
  resource,
  adapter = 'rpc-read',
  label,
  scope,
  read,
}: AppStateRequest<T>): Promise<T> => {
  return runBrokerRead({ broker: 'app-state-access', resource, adapter, label, scope }, () =>
    read()
  );
};
