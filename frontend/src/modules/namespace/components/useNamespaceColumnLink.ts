import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useMemo } from 'react';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { CanonicalResourceRef } from '@/core/refresh/types';
import type { NamespaceViewType } from '@/types/navigation/views';

interface NamespaceColumnRow {
  ref: Pick<CanonicalResourceRef, 'clusterId' | 'namespace'>;
}

export function useNamespaceColumnLink<T extends NamespaceColumnRow>(
  tab: NamespaceViewType,
  getNamespace?: (item: T) => string | null | undefined
) {
  const { setViewType, setActiveNamespaceTab } = useViewState();
  const { setSidebarSelection } = useSidebarState();
  const { setSelectedNamespace } = useNamespace();

  return useMemo(
    () => ({
      onClick: (item: T) => {
        const namespace = (getNamespace ? getNamespace(item) : item.ref.namespace)?.trim();
        if (!namespace) {
          return;
        }

        setSelectedNamespace(namespace, item.ref.clusterId);
        setViewType('namespace');
        setSidebarSelection({ type: 'namespace', value: namespace });
        setActiveNamespaceTab(tab);
      },
      getClassName: (item: T) =>
        ((getNamespace ? getNamespace(item) : item.ref.namespace) ?? '').trim()
          ? 'object-panel-link'
          : undefined,
      isInteractive: (item: T) =>
        Boolean(((getNamespace ? getNamespace(item) : item.ref.namespace) ?? '').trim()),
    }),
    [
      getNamespace,
      setActiveNamespaceTab,
      setSelectedNamespace,
      setSidebarSelection,
      setViewType,
      tab,
    ]
  );
}
