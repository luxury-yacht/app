import { describe, expect, it } from 'vitest';
import {
  configmap,
  cronjob,
  deployment,
  hpa,
  ingress,
  job,
  nodes,
  replicaset,
  secret,
  service,
  statefulset,
  types,
} from '@wailsjs/go/models';
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
    const cronJob = { suspend: true } as cronjob.CronJobDetails;

    const model = buildObjectDetailModel(null, 'cronjob', cronJob);

    expect(model.activeDetail).toBe(cronJob);
    expect(model.cronJobSuspended).toBe(true);
  });

  it('selects workload containers and active pod names', () => {
    const deploy = {
      desiredReplicas: 3,
      containers: [container({ name: 'api' })],
      initContainers: [container({ name: 'init' })],
      pods: [{ name: 'pod-a' }, { name: '  ' }, { name: 'pod-b' }],
    } as deployment.DeploymentDetails;

    const model = buildObjectDetailModel(null, 'deployment', deploy);

    expect(model.containerSection).toEqual({
      containers: deploy.containers,
      initContainers: deploy.initContainers,
    });
    expect(model.activePodNames).toEqual(['pod-a', 'pod-b']);
    expect(model.desiredScaleReplicas).toBe(3);
  });

  it('selects data sections for configmaps and secrets', () => {
    const configMapModel = buildObjectDetailModel(null, 'configmap', {
      data: { key: 'value' },
      binaryData: { cert: 'base64' },
    } as unknown as configmap.ConfigMapDetails);
    const secretModel = buildObjectDetailModel(null, 'secret', {
      data: { token: 'masked' },
    } as unknown as secret.SecretDetails);

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
    const tcpPod = buildObjectDetailModel(null, 'pod', {
      containers: [container({ ports: ['8080/TCP'] })],
    } as types.PodDetailInfo);
    const udpPod = buildObjectDetailModel(null, 'pod', {
      containers: [container({ ports: ['53/UDP'] })],
    } as types.PodDetailInfo);
    const tcpService = buildObjectDetailModel(null, 'service', {
      ports: [{ port: 443, targetPort: 'https', protocol: 'TCP' }],
    } as service.ServiceDetails);
    const udpService = buildObjectDetailModel(null, 'service', {
      ports: [{ port: 53, targetPort: 'dns', protocol: 'UDP' }],
    } as service.ServiceDetails);

    expect(tcpPod.portForwardAvailable).toBe(true);
    expect(udpPod.portForwardAvailable).toBe(false);
    expect(tcpService.portForwardAvailable).toBe(true);
    expect(udpService.portForwardAvailable).toBe(false);
  });

  it('selects desired replicas only for scalable workload kinds', () => {
    expect(
      buildObjectDetailModel(null, 'statefulset', {
        desiredReplicas: 2,
      } as statefulset.StatefulSetDetails).desiredScaleReplicas
    ).toBe(2);
    expect(
      buildObjectDetailModel(null, 'replicaset', {
        desiredReplicas: 5,
      } as replicaset.ReplicaSetDetails).desiredScaleReplicas
    ).toBe(5);
    expect(buildObjectDetailModel(null, 'job', {} as job.JobDetails).desiredScaleReplicas).toBe(0);
  });

  // Derivation exclusions: semantic, NOT structural — the DTO has the field but the section must not
  // appear. A pure field-presence chokepoint would regress each of these.
  it('excludes Jobs from the container section even though JobDetails carries containers', () => {
    const model = buildObjectDetailModel(null, 'job', {
      containers: [container()],
    } as unknown as job.JobDetails);
    expect(model.containerSection).toBeNull();
  });

  it('does not treat Ingress rules as RBAC roleRules', () => {
    const model = buildObjectDetailModel(null, 'ingress', {
      rules: [{ host: 'x' }],
    } as unknown as ingress.IngressDetails);
    expect(model.roleRules).toBeUndefined();
  });

  it('reports zero desired scale replicas for HPA (not scalable via the scale action)', () => {
    const model = buildObjectDetailModel(null, 'horizontalpodautoscaler', {
      desiredReplicas: 9,
    } as hpa.HorizontalPodAutoscalerDetails);
    expect(model.desiredScaleReplicas).toBe(0);
  });

  it('does not derive activePodNames for a Node even though NodeDetails carries pods', () => {
    const model = buildObjectDetailModel(null, 'node', {
      pods: [{ name: 'p' }],
    } as unknown as nodes.NodeDetails);
    expect(model.activePodNames).toBeNull();
  });
});
