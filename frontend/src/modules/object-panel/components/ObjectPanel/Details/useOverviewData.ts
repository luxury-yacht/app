import { useMemo } from 'react';
import type { types } from '@wailsjs/go/models';

// Using a permissive return type since different resource kinds have different fields
type OverviewData = Record<string, unknown>;

interface UseOverviewDataParams {
  objectData: any;
  podDetails: types.PodDetailInfo | null;
  deploymentDetails: types.DeploymentDetails | null;
  replicaSetDetails: types.ReplicaSetDetails | null;
  daemonSetDetails: types.DaemonSetDetails | null;
  statefulSetDetails: types.StatefulSetDetails | null;
  jobDetails: types.JobDetails | null;
  cronJobDetails: types.CronJobDetails | null;
  configMapDetails: types.ConfigMapDetails | null;
  secretDetails: types.SecretDetails | null;
  helmReleaseDetails: types.HelmReleaseDetails | null;
  serviceDetails: types.ServiceDetails | null;
  ingressDetails: types.IngressDetails | null;
  networkPolicyDetails: types.NetworkPolicyDetails | null;
  endpointSliceDetails: types.EndpointSliceDetails | null;
  pvcDetails: types.PersistentVolumeClaimDetails | null;
  pvDetails: types.PersistentVolumeDetails | null;
  storageClassDetails: types.StorageClassDetails | null;
  serviceAccountDetails: types.ServiceAccountDetails | null;
  roleDetails: types.RoleDetails | null;
  roleBindingDetails: types.RoleBindingDetails | null;
  clusterRoleDetails: types.ClusterRoleDetails | null;
  clusterRoleBindingDetails: types.ClusterRoleBindingDetails | null;
  hpaDetails: types.HorizontalPodAutoscalerDetails | null;
  pdbDetails: types.PodDisruptionBudgetDetails | null;
  resourceQuotaDetails: types.ResourceQuotaDetails | null;
  limitRangeDetails: types.LimitRangeDetails | null;
  nodeDetails: types.NodeDetails | null;
  namespaceDetails: types.NamespaceDetails | null;
  ingressClassDetails: types.IngressClassDetails | null;
  crdDetails: types.CustomResourceDefinitionDetails | null;
  mutatingWebhookDetails: types.MutatingWebhookConfigurationDetails | null;
  validatingWebhookDetails: types.ValidatingWebhookConfigurationDetails | null;
}

export function useOverviewData(params: UseOverviewDataParams): OverviewData | null {
  const {
    objectData,
    podDetails,
    deploymentDetails,
    replicaSetDetails,
    daemonSetDetails,
    statefulSetDetails,
    jobDetails,
    cronJobDetails,
    configMapDetails,
    secretDetails,
    helmReleaseDetails,
    serviceDetails,
    ingressDetails,
    networkPolicyDetails,
    endpointSliceDetails,
    pvcDetails,
    pvDetails,
    storageClassDetails,
    serviceAccountDetails,
    roleDetails,
    roleBindingDetails,
    clusterRoleDetails,
    clusterRoleBindingDetails,
    hpaDetails,
    pdbDetails,
    resourceQuotaDetails,
    limitRangeDetails,
    nodeDetails,
    namespaceDetails,
    ingressClassDetails,
    crdDetails,
    mutatingWebhookDetails,
    validatingWebhookDetails,
  } = params;

  return useMemo(() => {
    if (!objectData) return null;

    const kind = objectData.kind?.toLowerCase();

    // Pod
    if (podDetails && kind === 'pod') {
      return {
        kind: 'Pod',
        name: podDetails.name,
        age: podDetails.age,
        node: podDetails.node || undefined,
        nodeIP: podDetails.nodeIP || undefined,
        podIP: podDetails.podIP || undefined,
        owner:
          podDetails.ownerKind && podDetails.ownerName && podDetails.ownerKind !== 'None'
            ? { kind: podDetails.ownerKind, name: podDetails.ownerName }
            : undefined,
        namespace: objectData.namespace,
        status: podDetails.status,
        statusSeverity: (podDetails as any).statusSeverity,
        ready: podDetails.ready,
        restarts: podDetails.restarts,
        qosClass: podDetails.qosClass,
        priorityClass: podDetails.priorityClass,
        serviceAccount: podDetails.serviceAccount,
        hostNetwork: podDetails.hostNetwork,
        labels: podDetails.labels,
        annotations: podDetails.annotations,
      };
    }

    // Deployment
    if (deploymentDetails && kind === 'deployment') {
      return {
        kind: 'Deployment',
        name: deploymentDetails.name,
        age: deploymentDetails.age,
        namespace: deploymentDetails.namespace,
        replicas: deploymentDetails.replicas,
        desiredReplicas: deploymentDetails.desiredReplicas,
        ready: String(deploymentDetails.ready),
        upToDate: deploymentDetails.upToDate,
        available: deploymentDetails.available,
        strategy: deploymentDetails.strategy,
        maxSurge: deploymentDetails.maxSurge,
        maxUnavailable: deploymentDetails.maxUnavailable,
        minReadySeconds: deploymentDetails.minReadySeconds,
        revisionHistory: deploymentDetails.revisionHistory,
        progressDeadline: deploymentDetails.progressDeadline,
        paused: deploymentDetails.paused,
        rolloutStatus: deploymentDetails.rolloutStatus,
        rolloutMessage: deploymentDetails.rolloutMessage,
        observedGeneration: deploymentDetails.observedGeneration,
        currentRevision: deploymentDetails.currentRevision,
        selector: deploymentDetails.selector,
        conditions: deploymentDetails.conditions,
        replicaSets: deploymentDetails.replicaSets,
        labels: deploymentDetails.labels,
        annotations: deploymentDetails.annotations,
      };
    }

    // ReplicaSet
    if (replicaSetDetails && kind === 'replicaset') {
      return {
        kind: 'ReplicaSet',
        name: replicaSetDetails.name,
        age: replicaSetDetails.age,
        namespace: replicaSetDetails.namespace,
        replicas: replicaSetDetails.replicas,
        desiredReplicas: replicaSetDetails.desiredReplicas,
        ready: replicaSetDetails.ready,
        available: replicaSetDetails.available,
        minReadySeconds: replicaSetDetails.minReadySeconds,
        selector: replicaSetDetails.selector,
        labels: replicaSetDetails.labels,
        annotations: replicaSetDetails.annotations,
      };
    }

    // DaemonSet
    if (daemonSetDetails && kind === 'daemonset') {
      return {
        kind: 'DaemonSet',
        name: daemonSetDetails.name,
        age: daemonSetDetails.age,
        namespace: daemonSetDetails.namespace,
        desired: daemonSetDetails.desired,
        current: daemonSetDetails.current,
        ready: String(daemonSetDetails.ready),
        upToDate: daemonSetDetails.upToDate,
        available: daemonSetDetails.available,
        updateStrategy: daemonSetDetails.updateStrategy,
        numberMisscheduled: daemonSetDetails.numberMisscheduled,
        selector: daemonSetDetails.selector,
        labels: daemonSetDetails.labels,
        annotations: daemonSetDetails.annotations,
      };
    }

    // StatefulSet
    if (statefulSetDetails && kind === 'statefulset') {
      return {
        kind: 'StatefulSet',
        name: statefulSetDetails.name,
        age: statefulSetDetails.age,
        namespace: statefulSetDetails.namespace,
        replicas: statefulSetDetails.replicas,
        desiredReplicas: statefulSetDetails.desiredReplicas,
        ready: String(statefulSetDetails.ready),
        upToDate: statefulSetDetails.upToDate,
        available: statefulSetDetails.available,
        updateStrategy: statefulSetDetails.updateStrategy,
        serviceName: statefulSetDetails.serviceName,
        podManagementPolicy: statefulSetDetails.podManagementPolicy,
        selector: statefulSetDetails.selector,
        labels: statefulSetDetails.labels,
        annotations: statefulSetDetails.annotations,
      };
    }

    // ConfigMap
    if (configMapDetails && kind === 'configmap') {
      return {
        kind: 'ConfigMap',
        name: configMapDetails.name,
        age: configMapDetails.age,
        namespace: configMapDetails.namespace,
        configMapDetails: configMapDetails,
      };
    }

    // Secret
    if (secretDetails && kind === 'secret') {
      return {
        kind: 'Secret',
        name: secretDetails.name,
        age: secretDetails.age,
        namespace: secretDetails.namespace,
        secretDetails: secretDetails,
      };
    }

    // HelmRelease
    if (helmReleaseDetails && kind === 'helmrelease') {
      return {
        kind: 'HelmRelease',
        name: helmReleaseDetails.name,
        age: helmReleaseDetails.age,
        namespace: helmReleaseDetails.namespace,
        chart: helmReleaseDetails.chart,
        appVersion: helmReleaseDetails.appVersion,
        status: helmReleaseDetails.status,
        revision: helmReleaseDetails.revision,
        updated: helmReleaseDetails.updated,
        helmReleaseDetails: helmReleaseDetails,
      };
    }

    // Service
    if (serviceDetails && kind === 'service') {
      return {
        kind: 'Service',
        name: serviceDetails.name,
        age: serviceDetails.age,
        namespace: serviceDetails.namespace,
        serviceDetails: serviceDetails,
      };
    }

    // Ingress
    if (ingressDetails && kind === 'ingress') {
      return {
        kind: 'Ingress',
        name: ingressDetails.name,
        age: ingressDetails.age,
        namespace: ingressDetails.namespace,
        ingressDetails: ingressDetails,
      };
    }

    // NetworkPolicy
    if (networkPolicyDetails && kind === 'networkpolicy') {
      return {
        kind: 'NetworkPolicy',
        name: networkPolicyDetails.name,
        age: networkPolicyDetails.age,
        namespace: networkPolicyDetails.namespace,
        networkPolicyDetails: networkPolicyDetails,
      };
    }

    // EndpointSlice
    if (endpointSliceDetails && kind === 'endpointslice') {
      return {
        kind: 'EndpointSlice',
        name: endpointSliceDetails.name,
        age: endpointSliceDetails.age,
        namespace: endpointSliceDetails.namespace,
        endpointSliceDetails,
      };
    }

    // ServiceAccount
    if (serviceAccountDetails && kind === 'serviceaccount') {
      return {
        kind: 'ServiceAccount',
        name: serviceAccountDetails.name,
        age: serviceAccountDetails.age,
        namespace: serviceAccountDetails.namespace,
        secrets: serviceAccountDetails.secrets,
        imagePullSecrets: serviceAccountDetails.imagePullSecrets,
        automountServiceAccountToken: serviceAccountDetails.automountServiceAccountToken,
        usedBy: serviceAccountDetails.usedByPods,
        roleBindings: serviceAccountDetails.roleBindings,
        clusterRoleBindings: serviceAccountDetails.clusterRoleBindings,
      };
    }

    // Role
    if (roleDetails && kind === 'role') {
      return {
        kind: 'Role',
        name: roleDetails.name,
        age: roleDetails.age,
        namespace: roleDetails.namespace,
        policyRules: roleDetails.rules,
        usedByRoleBindings: roleDetails.usedByRoleBindings,
      };
    }

    // RoleBinding
    if (roleBindingDetails && kind === 'rolebinding') {
      return {
        kind: 'RoleBinding',
        name: roleBindingDetails.name,
        age: roleBindingDetails.age,
        namespace: roleBindingDetails.namespace,
        roleRef: roleBindingDetails.roleRef,
        subjects: roleBindingDetails.subjects,
      };
    }

    // Node
    if (nodeDetails && kind === 'node') {
      return {
        kind: 'Node',
        name: nodeDetails.name,
        age: nodeDetails.age,
        status: nodeDetails.status,
        roles: nodeDetails.roles,
        version: nodeDetails.version,
        os: nodeDetails.os,
        osImage: nodeDetails.osImage,
        architecture: nodeDetails.architecture,
        containerRuntime: nodeDetails.containerRuntime,
        kernelVersion: nodeDetails.kernelVersion,
        kubeletVersion: nodeDetails.kubeletVersion,
        hostname: nodeDetails.hostname,
        internalIP: nodeDetails.internalIP,
        externalIP: nodeDetails.externalIP,
        cpuCapacity: nodeDetails.cpuCapacity,
        cpuAllocatable: nodeDetails.cpuAllocatable,
        memoryCapacity: nodeDetails.memoryCapacity,
        memoryAllocatable: nodeDetails.memoryAllocatable,
        podsCapacity: nodeDetails.podsCapacity,
        podsAllocatable: nodeDetails.podsAllocatable,
        storageCapacity: nodeDetails.storageCapacity,
        podsCount: nodeDetails.podsCount,
        cpuRequests: nodeDetails.cpuRequests,
        cpuLimits: nodeDetails.cpuLimits,
        memRequests: nodeDetails.memRequests,
        memLimits: nodeDetails.memLimits,
        taints: nodeDetails.taints,
        conditions: nodeDetails.conditions,
        labels: nodeDetails.labels,
        annotations: nodeDetails.annotations,
      };
    }

    // Job
    if (jobDetails && kind === 'job') {
      return {
        kind: 'Job',
        name: jobDetails.name,
        age: jobDetails.age,
        namespace: jobDetails.namespace,
        completions: jobDetails.completions,
        parallelism: jobDetails.parallelism,
        backoffLimit: jobDetails.backoffLimit,
        succeeded: jobDetails.succeeded,
        failed: jobDetails.failed,
        active: jobDetails.active,
        startTime: jobDetails.startTime,
        completionTime: jobDetails.completionTime,
        duration: jobDetails.duration,
      };
    }

    // CronJob
    if (cronJobDetails && kind === 'cronjob') {
      return {
        kind: 'CronJob',
        name: cronJobDetails.name,
        age: cronJobDetails.age,
        namespace: cronJobDetails.namespace,
        schedule: cronJobDetails.schedule,
        suspend: cronJobDetails.suspend,
        activeJobs: cronJobDetails.activeJobs,
        lastScheduleTime: cronJobDetails.lastScheduleTime,
        successfulJobsHistory: cronJobDetails.successfulJobsHistory,
        failedJobsHistory: cronJobDetails.failedJobsHistory,
      };
    }

    // PersistentVolumeClaim
    if (pvcDetails && kind === 'persistentvolumeclaim') {
      return {
        kind: 'PersistentVolumeClaim',
        name: pvcDetails.name,
        age: pvcDetails.age,
        namespace: pvcDetails.namespace,
        status: pvcDetails.status,
        volumeName: pvcDetails.volumeName,
        capacity: pvcDetails.capacity,
        accessModes: pvcDetails.accessModes,
        storageClass: pvcDetails.storageClass,
        volumeMode: pvcDetails.volumeMode,
        mountedBy: pvcDetails.mountedBy,
      };
    }

    // PersistentVolume
    if (pvDetails && kind === 'persistentvolume') {
      return {
        kind: 'PersistentVolume',
        name: pvDetails.name,
        age: pvDetails.age,
        capacity: pvDetails.capacity,
        accessModes: pvDetails.accessModes,
        reclaimPolicy: pvDetails.reclaimPolicy,
        status: pvDetails.status,
        claimRef: pvDetails.claimRef,
        storageClass: pvDetails.storageClass,
        volumeMode: pvDetails.volumeMode,
      };
    }

    // StorageClass
    if (storageClassDetails && kind === 'storageclass') {
      return {
        kind: 'StorageClass',
        name: storageClassDetails.name,
        age: storageClassDetails.age,
        provisioner: storageClassDetails.provisioner,
        reclaimPolicy: storageClassDetails.reclaimPolicy,
        volumeBindingMode: storageClassDetails.volumeBindingMode,
        allowVolumeExpansion: storageClassDetails.allowVolumeExpansion,
        isDefault: storageClassDetails.isDefault,
        parameters: storageClassDetails.parameters,
      };
    }

    // ClusterRole
    if (clusterRoleDetails && kind === 'clusterrole') {
      return {
        kind: 'ClusterRole',
        name: clusterRoleDetails.name,
        age: clusterRoleDetails.age,
        policyRules: clusterRoleDetails.rules,
        aggregationRule: clusterRoleDetails.aggregationRule,
        clusterRoleBindings: clusterRoleDetails.clusterRoleBindings,
      };
    }

    // ClusterRoleBinding
    if (clusterRoleBindingDetails && kind === 'clusterrolebinding') {
      return {
        kind: 'ClusterRoleBinding',
        name: clusterRoleBindingDetails.name,
        age: clusterRoleBindingDetails.age,
        roleRef: clusterRoleBindingDetails.roleRef,
        subjects: clusterRoleBindingDetails.subjects,
      };
    }

    // HorizontalPodAutoscaler
    if (hpaDetails && kind === 'horizontalpodautoscaler') {
      return {
        kind: 'HorizontalPodAutoscaler',
        name: hpaDetails.name,
        age: hpaDetails.age,
        namespace: hpaDetails.namespace,
        scaleTargetRef: hpaDetails.scaleTargetRef,
        minReplicas: hpaDetails.minReplicas,
        maxReplicas: hpaDetails.maxReplicas,
        currentReplicas: hpaDetails.currentReplicas,
        desiredReplicas: hpaDetails.desiredReplicas,
        metrics: hpaDetails.metrics,
        currentMetrics: hpaDetails.currentMetrics,
        behavior: hpaDetails.behavior,
        labels: hpaDetails.labels,
        annotations: hpaDetails.annotations,
      };
    }

    // PodDisruptionBudget
    if (pdbDetails && kind === 'poddisruptionbudget') {
      return {
        kind: 'PodDisruptionBudget',
        name: pdbDetails.name,
        age: pdbDetails.age,
        namespace: pdbDetails.namespace,
        minAvailable: pdbDetails.minAvailable,
        maxUnavailable: pdbDetails.maxUnavailable,
        currentHealthy: pdbDetails.currentHealthy,
        desiredHealthy: pdbDetails.desiredHealthy,
        disruptionsAllowed: pdbDetails.disruptionsAllowed,
        expectedPods: pdbDetails.expectedPods,
        selector: pdbDetails.selector,
        labels: pdbDetails.labels,
        annotations: pdbDetails.annotations,
      };
    }

    // ResourceQuota
    if (resourceQuotaDetails && kind === 'resourcequota') {
      return {
        kind: 'ResourceQuota',
        name: resourceQuotaDetails.name,
        age: resourceQuotaDetails.age,
        namespace: resourceQuotaDetails.namespace,
        hard: resourceQuotaDetails.hard,
        used: resourceQuotaDetails.used,
        scopes: resourceQuotaDetails.scopes,
        scopeSelector: resourceQuotaDetails.scopeSelector,
      };
    }

    // LimitRange
    if (limitRangeDetails && kind === 'limitrange') {
      return {
        kind: 'LimitRange',
        name: limitRangeDetails.name,
        age: limitRangeDetails.age,
        namespace: limitRangeDetails.namespace,
        limits: limitRangeDetails.limits,
      };
    }

    // Namespace
    if (namespaceDetails && kind === 'namespace') {
      return {
        kind: 'Namespace',
        name: namespaceDetails.name,
        age: namespaceDetails.age,
        status: namespaceDetails.status,
        hasWorkloads: namespaceDetails.hasWorkloads,
        workloadsUnknown: namespaceDetails.workloadsUnknown,
        labels: namespaceDetails.labels,
        annotations: namespaceDetails.annotations,
      };
    }

    // IngressClass
    if (ingressClassDetails && kind === 'ingressclass') {
      return {
        kind: 'IngressClass',
        name: ingressClassDetails.name,
        age: ingressClassDetails.age,
        controller: ingressClassDetails.controller,
        isDefault: ingressClassDetails.isDefault,
        parameters: ingressClassDetails.parameters,
      };
    }

    // CustomResourceDefinition
    if (crdDetails && kind === 'customresourcedefinition') {
      return {
        kind: 'CustomResourceDefinition',
        name: crdDetails.name,
        age: crdDetails.age,
        group: crdDetails.group,
        versions: crdDetails.versions,
        scope: crdDetails.scope,
        names: crdDetails.names,
        conditions: crdDetails.conditions,
      };
    }

    // MutatingWebhookConfiguration
    if (mutatingWebhookDetails && kind === 'mutatingwebhookconfiguration') {
      return {
        kind: 'MutatingWebhookConfiguration',
        name: mutatingWebhookDetails.name,
        age: mutatingWebhookDetails.age,
        webhooks: mutatingWebhookDetails.webhooks,
      };
    }

    // ValidatingWebhookConfiguration
    if (validatingWebhookDetails && kind === 'validatingwebhookconfiguration') {
      return {
        kind: 'ValidatingWebhookConfiguration',
        name: validatingWebhookDetails.name,
        age: validatingWebhookDetails.age,
        webhooks: validatingWebhookDetails.webhooks,
      };
    }

    // Default fallback
    return {
      kind: objectData.kind || 'Unknown',
      name: objectData.name || 'Unnamed',
      age: objectData.age || '-',
      node: objectData.node || undefined,
      owner: objectData.owner || undefined,
      namespace: objectData.namespace,
      status: objectData.status,
      apiGroup: objectData.apiGroup,
    };
  }, [
    objectData,
    podDetails,
    deploymentDetails,
    replicaSetDetails,
    daemonSetDetails,
    statefulSetDetails,
    jobDetails,
    cronJobDetails,
    configMapDetails,
    secretDetails,
    helmReleaseDetails,
    serviceDetails,
    ingressDetails,
    networkPolicyDetails,
    endpointSliceDetails,
    pvcDetails,
    pvDetails,
    storageClassDetails,
    serviceAccountDetails,
    roleDetails,
    roleBindingDetails,
    clusterRoleDetails,
    clusterRoleBindingDetails,
    hpaDetails,
    pdbDetails,
    resourceQuotaDetails,
    limitRangeDetails,
    nodeDetails,
    namespaceDetails,
    ingressClassDetails,
    crdDetails,
    mutatingWebhookDetails,
    validatingWebhookDetails,
  ]);
}
