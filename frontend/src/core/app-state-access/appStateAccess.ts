import type { AppStateRequest } from './types';
import { beginBrokerRead, completeBrokerRead } from '@/core/read-diagnostics';

export const requestAppState = async <T>({
  resource,
  adapter = 'rpc-read',
  read,
}: AppStateRequest<T>): Promise<T> => {
  const token = beginBrokerRead({
    broker: 'app-state-access',
    resource,
    adapter,
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
