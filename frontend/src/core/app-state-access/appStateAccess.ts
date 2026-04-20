import type { AppStateRequest } from './types';
import { beginBrokerRead, completeBrokerRead } from '@/core/read-diagnostics';

export const requestAppState = async <T>({
  resource,
  adapter = 'rpc-read',
  label,
  scope,
  read,
}: AppStateRequest<T>): Promise<T> => {
  const token = beginBrokerRead({
    broker: 'app-state-access',
    resource,
    adapter,
    label,
    scope,
  });

  try {
    const data = await read();
    completeBrokerRead({ token, status: 'success' });
    return data;
  } catch (error) {
    completeBrokerRead({ token, status: 'error', error });
    throw error;
  }
};
