export type AppStateAdapter = 'rpc-read' | 'persistence-read' | 'runtime-read';

export interface AppStateRequest<T> {
  resource: string;
  adapter?: AppStateAdapter;
  read: () => Promise<T>;
}
