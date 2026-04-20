export type AppStateAdapter = 'rpc-read' | 'persistence-read' | 'runtime-read';

export interface AppStateRequest<T> {
  resource: string;
  adapter?: AppStateAdapter;
  label?: string;
  scope?: string;
  read: () => Promise<T>;
}
