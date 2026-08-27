import { loadObjectPanelDetails } from '@modules/object-panel/objectPanelDetailsLazyModule';

type ObjectPanelModuleLoaders = {
  loadPanel: () => Promise<unknown>;
  loadDetails: () => Promise<unknown>;
};

export const loadObjectPanel = () =>
  import('@modules/object-panel/components/ObjectPanel/ObjectPanel');

const defaultLoaders: ObjectPanelModuleLoaders = {
  loadPanel: loadObjectPanel,
  loadDetails: loadObjectPanelDetails,
};

export const preloadObjectPanelModules = (
  loaders: ObjectPanelModuleLoaders = defaultLoaders
): Promise<unknown[]> => Promise.all([loaders.loadPanel(), loaders.loadDetails()]);
