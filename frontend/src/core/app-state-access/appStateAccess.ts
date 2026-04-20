import type { AppStateRequest } from './types';

export const requestAppState = async <T>({ read }: AppStateRequest<T>): Promise<T> => {
  return read();
};
