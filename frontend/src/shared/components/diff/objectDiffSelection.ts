export interface ObjectDiffSelectionSeed {
  clusterId: string;
  namespace?: string;
  group: string;
  version: string;
  kind: string;
  name: string;
}

export interface ObjectDiffOpenRequest {
  requestId: number;
  left?: ObjectDiffSelectionSeed | null;
}
