import type { types } from '@core/backend-api/models';
import { describe, expect, it } from 'vitest';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { buildObjectDetailModel } from './objectDetailModel';

const container = (
  overrides: Partial<types.PodDetailInfoContainer> = {}
): types.PodDetailInfoContainer =>
  ({
    name: 'app',
    image: 'app:latest',
    ports: ['8080/TCP'],
    ...overrides,
  }) as types.PodDetailInfoContainer;

describe('objectDetailModel', () => {
  it('exposes the active detail payload and cronjob suspend', () => {
    const cronJob = objectDetailOf('cronjob', { suspend: true });

    const model = buildObjectDetailModel(null, cronJob);

    expect(model.activeDetail).toBe(cronJob);
    expect(model.cronJobSuspended).toBe(true);
  });

  it('selects workload containers and active pod names', () => {
    const deploy = objectDetailOf('deployment', {
      desiredReplicas: 3,
      containers: [container({ name: 'api' })],
      initContainers: [container({ name: 'init' })],
      pods: [{ name: 'pod-a' }, { name: '  ' }, { name: 'pod-b' }],
    });

    const model = buildObjectDetailModel(null, deploy);

    expect(model.containerSection).toEqual({
      containers: deploy.details.containers,
      initContainers: deploy.details.initContainers,
    });
    expect(model.activePodNames).toEqual(['pod-a', 'pod-b']);
    expect(model.desiredScaleReplicas).toBe(3);
  });

  it('selects data sections for configmaps and secrets', () => {
    const configMapModel = buildObjectDetailModel(
      null,
      objectDetailOf('configmap', {
        data: { key: 'value' },
        binaryData: { cert: 'base64' },
      })
    );
    const secretModel = buildObjectDetailModel(
      null,
      objectDetailOf('secret', {
        data: { token: 'masked' },
      })
    );

    expect(configMapModel.dataSection).toEqual({
      data: { key: 'value' },
      binaryData: { cert: 'base64' },
      isSecret: false,
    });
    expect(secretModel.dataSection).toEqual({
      data: { token: 'masked' },
      binaryData: undefined,
      isSecret: true,
    });
  });

  it('detects port-forward availability for pod-like resources and services', () => {
    const tcpPod = buildObjectDetailModel(
      null,
      objectDetailOf('pod', {
        containers: [container({ ports: ['8080/TCP'] })],
      })
    );
    const udpPod = buildObjectDetailModel(
      null,
      objectDetailOf('pod', {
        containers: [container({ ports: ['53/UDP'] })],
      })
    );
    const tcpService = buildObjectDetailModel(
      null,
      objectDetailOf('service', {
        ports: [{ port: 443, targetPort: 'https', protocol: 'TCP' }],
      })
    );
    const udpService = buildObjectDetailModel(
      null,
      objectDetailOf('service', {
        ports: [{ port: 53, targetPort: 'dns', protocol: 'UDP' }],
      })
    );

    expect(tcpPod.portForwardAvailable).toBe(true);
    expect(udpPod.portForwardAvailable).toBe(false);
    expect(tcpService.portForwardAvailable).toBe(true);
    expect(udpService.portForwardAvailable).toBe(false);
  });

  // Port forwarding is offered per kind (its port-forward facet); a ReplicaSet
  // has none, even though its DTO carries forwardable container ports.
  it('reports no port-forward availability for a kind that cannot be port-forwarded', () => {
    const replicaSet = buildObjectDetailModel(
      null,
      objectDetailOf('replicaset', { containers: [container({ ports: ['8080/TCP'] })] })
    );

    expect(replicaSet.portForwardAvailable).toBeUndefined();
  });

  it('selects desired replicas only for scalable workload kinds', () => {
    expect(
      buildObjectDetailModel(
        null,
        objectDetailOf('statefulset', {
          desiredReplicas: 2,
        })
      ).desiredScaleReplicas
    ).toBe(2);
    expect(
      buildObjectDetailModel(
        null,
        objectDetailOf('replicaset', {
          desiredReplicas: 5,
        })
      ).desiredScaleReplicas
    ).toBe(5);
    expect(buildObjectDetailModel(null, objectDetailOf('job', {})).desiredScaleReplicas).toBe(0);
  });

  // Derivation exclusions: semantic, NOT structural — the DTO has the field but the section must not
  // appear. A pure field-presence chokepoint would regress each of these.
  it('excludes Jobs from the container section even though JobDetails carries containers', () => {
    const model = buildObjectDetailModel(
      null,
      objectDetailOf('job', {
        containers: [container()],
      })
    );
    expect(model.containerSection).toBeNull();
  });

  it('does not treat Ingress rules as RBAC roleRules', () => {
    const model = buildObjectDetailModel(
      null,
      objectDetailOf('ingress', {
        rules: [{ host: 'x' }],
      })
    );
    expect(model.roleRules).toBeUndefined();
  });

  it('reports zero desired scale replicas for HPA (not scalable via the scale action)', () => {
    const model = buildObjectDetailModel(
      null,
      objectDetailOf('horizontalpodautoscaler', {
        desiredReplicas: 9,
      })
    );
    expect(model.desiredScaleReplicas).toBe(0);
  });

  // The Logs tab hides lines of pods missing from a known pod list, and hides
  // nothing while the list is unknown.
  it('keeps a workload with no pods apart from one whose pods could not be listed', () => {
    const scaledToZero = buildObjectDetailModel(
      null,
      objectDetailOf('deployment', {
        pods: [],
      })
    );
    const unlisted = buildObjectDetailModel(
      null,
      objectDetailOf('cronjob', {
        pods: null,
      })
    );
    const loading = buildObjectDetailModel(null, null);

    expect(scaledToZero.activePodNames).toEqual([]);
    expect(unlisted.activePodNames).toBeNull();
    expect(loading.activePodNames).toBeNull();
  });

  it('lists the pods of a ReplicaSet', () => {
    const model = buildObjectDetailModel(
      null,
      objectDetailOf('replicaset', {
        pods: [{ name: 'web-abc12' }],
      })
    );

    expect(model.activePodNames).toEqual(['web-abc12']);
  });

  it('does not derive activePodNames for a Node even though NodeDetails carries pods', () => {
    const model = buildObjectDetailModel(null, objectDetailOf('node', { pods: '12' }));
    expect(model.activePodNames).toBeNull();
  });

  it('selects Namespace finalization diagnostics from the typed detail DTO', () => {
    const detail = objectDetailOf('namespace', {
      finalizers: ['kubernetes'],
      conditions: [
        {
          type: 'NamespaceDeletionDiscoveryFailure',
          status: 'True',
          reason: 'DiscoveryFailed',
          message: 'unable to retrieve the complete list of server APIs',
        },
      ],
    });

    const model = buildObjectDetailModel(null, detail);

    expect(model.namespaceFinalization).toEqual({
      finalizers: detail.details.finalizers,
      conditions: detail.details.conditions,
    });
  });
});
