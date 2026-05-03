import { BaseEdge, ExtensionCategory, register } from '@antv/g6';
import type { DisplayObjectConfig } from '@antv/g';
import type { BaseEdgeStyleProps, PathArray } from '@antv/g6';
import { OBJECT_MAP_G6_PATH_EDGE } from './objectMapG6Constants';

interface ObjectMapG6PathEdgeStyleProps extends BaseEdgeStyleProps {
  objectMapPath?: PathArray;
}

class ObjectMapG6PathEdge extends BaseEdge {
  constructor(options: DisplayObjectConfig<ObjectMapG6PathEdgeStyleProps>) {
    super(options);
  }

  protected getKeyPath(attributes: Required<ObjectMapG6PathEdgeStyleProps>): PathArray {
    if (attributes.objectMapPath) {
      return attributes.objectMapPath;
    }
    const [sourcePoint, targetPoint] = this.getEndpoints(attributes);
    return [
      ['M', sourcePoint[0], sourcePoint[1]],
      ['L', targetPoint[0], targetPoint[1]],
    ];
  }
}

let isRegistered = false;

export const ensureObjectMapG6PathEdgeRegistered = (): void => {
  if (isRegistered) return;
  register(ExtensionCategory.EDGE, OBJECT_MAP_G6_PATH_EDGE, ObjectMapG6PathEdge);
  isRegistered = true;
};
