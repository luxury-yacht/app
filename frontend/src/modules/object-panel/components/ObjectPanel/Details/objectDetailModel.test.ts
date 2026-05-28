import { describe, expect, it } from 'vitest';
import { types } from '@wailsjs/go/models';
import {
  buildObjectDetailModel,
  createObjectDetailModelFromSlots,
  type DetailSlots,
} from './objectDetailModel';

const emptySlots = (overrides: Partial<DetailSlots> = {}): DetailSlots => ({
  podDetails: null,
  deploymentDetails: null,
  replicaSetDetails: null,
  daemonSetDetails: null,
  statefulSetDetails: null,
  jobDetails: null,
  cronJobDetails: null,
  configMapDetails: null,
  secretDetails: null,
  helmReleaseDetails: null,
  serviceDetails: null,
  ingressDetails: null,
  networkPolicyDetails: null,
  endpointSliceDetails: null,
  gatewayDetails: null,
  httpRouteDetails: null,
  grpcRouteDetails: null,
  tlsRouteDetails: null,
  listenerSetDetails: null,
  referenceGrantDetails: null,
  backendTLSPolicyDetails: null,
  pvcDetails: null,
  pvDetails: null,
  storageClassDetails: null,
  serviceAccountDetails: null,
  roleDetails: null,
  roleBindingDetails: null,
  clusterRoleDetails: null,
  clusterRoleBindingDetails: null,
  hpaDetails: null,
  pdbDetails: null,
  resourceQuotaDetails: null,
  limitRangeDetails: null,
  nodeDetails: null,
  namespaceDetails: null,
  ingressClassDetails: null,
  gatewayClassDetails: null,
  crdDetails: null,
  mutatingWebhookDetails: null,
  validatingWebhookDetails: null,
  ...overrides,
});

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
  it('maps detail payloads into the matching slot', () => {
    const cronJob = { suspend: true } as types.CronJobDetails;

    const model = buildObjectDetailModel(null, 'cronjob', cronJob);

    expect(model.slots.cronJobDetails).toBe(cronJob);
    expect(model.cronJobSuspended).toBe(true);
  });

  it('selects workload containers and active pod names', () => {
    const deployment = {
      desiredReplicas: 3,
      containers: [container({ name: 'api' })],
      initContainers: [container({ name: 'init' })],
      pods: [{ name: 'pod-a' }, { name: '  ' }, { name: 'pod-b' }],
    } as types.DeploymentDetails;

    const model = createObjectDetailModelFromSlots(
      null,
      'deployment',
      emptySlots({ deploymentDetails: deployment })
    );

    expect(model.containerSection).toEqual({
      containers: deployment.containers,
      initContainers: deployment.initContainers,
    });
    expect(model.activePodNames).toEqual(['pod-a', 'pod-b']);
    expect(model.desiredScaleReplicas).toBe(3);
  });

  it('selects data sections for configmaps and secrets', () => {
    const configMapModel = createObjectDetailModelFromSlots(
      null,
      'configmap',
      emptySlots({
        configMapDetails: {
          data: { key: 'value' },
          binaryData: { cert: 'base64' },
        } as unknown as types.ConfigMapDetails,
      })
    );
    const secretModel = createObjectDetailModelFromSlots(
      null,
      'secret',
      emptySlots({
        secretDetails: {
          data: { token: 'masked' },
        } as unknown as types.SecretDetails,
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
    const tcpPod = createObjectDetailModelFromSlots(
      null,
      'pod',
      emptySlots({
        podDetails: { containers: [container({ ports: ['8080/TCP'] })] } as types.PodDetailInfo,
      })
    );
    const udpPod = createObjectDetailModelFromSlots(
      null,
      'pod',
      emptySlots({
        podDetails: { containers: [container({ ports: ['53/UDP'] })] } as types.PodDetailInfo,
      })
    );
    const tcpService = createObjectDetailModelFromSlots(
      null,
      'service',
      emptySlots({
        serviceDetails: {
          ports: [{ port: 443, targetPort: 'https', protocol: 'TCP' }],
        } as types.ServiceDetails,
      })
    );
    const udpService = createObjectDetailModelFromSlots(
      null,
      'service',
      emptySlots({
        serviceDetails: {
          ports: [{ port: 53, targetPort: 'dns', protocol: 'UDP' }],
        } as types.ServiceDetails,
      })
    );

    expect(tcpPod.portForwardAvailable).toBe(true);
    expect(udpPod.portForwardAvailable).toBe(false);
    expect(tcpService.portForwardAvailable).toBe(true);
    expect(udpService.portForwardAvailable).toBe(false);
  });

  it('selects desired replicas only for scalable workload kinds', () => {
    expect(
      createObjectDetailModelFromSlots(
        null,
        'statefulset',
        emptySlots({ statefulSetDetails: { desiredReplicas: 2 } as types.StatefulSetDetails })
      ).desiredScaleReplicas
    ).toBe(2);
    expect(
      createObjectDetailModelFromSlots(
        null,
        'replicaset',
        emptySlots({ replicaSetDetails: { desiredReplicas: 5 } as types.ReplicaSetDetails })
      ).desiredScaleReplicas
    ).toBe(5);
    expect(createObjectDetailModelFromSlots(null, 'job', emptySlots()).desiredScaleReplicas).toBe(
      0
    );
  });
});
