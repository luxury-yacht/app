export interface AppStateRequest<T> {
  resource: string;
  read: () => Promise<T>;
}
