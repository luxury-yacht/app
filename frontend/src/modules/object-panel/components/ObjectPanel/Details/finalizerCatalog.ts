export interface FinalizerGuidance {
  title: string;
  explanation: string;
  nextStep: string;
  consequence?: string;
}

const UNKNOWN_FINALIZER: FinalizerGuidance = {
  title: 'Unknown finalizer',
  explanation: 'Luxury Yacht does not recognize the controller responsible for this finalizer.',
  nextStep: 'Identify the controller and the cleanup it protects before considering removal.',
};

const KNOWN_FINALIZERS: Readonly<Record<string, FinalizerGuidance>> = {
  'kubernetes.io/pvc-protection': {
    title: 'PersistentVolumeClaim protection',
    explanation: 'Kubernetes keeps this finalizer while the claim is in use by a Pod.',
    nextStep: 'Resolve the Pods using this claim and let Kubernetes complete deletion.',
  },
  'kubernetes.io/pv-protection': {
    title: 'PersistentVolume protection',
    explanation: 'Kubernetes keeps this finalizer while the volume is bound to a claim.',
    nextStep: 'Resolve the bound claim and let Kubernetes complete deletion.',
  },
  foregroundDeletion: {
    title: 'Foreground deletion',
    explanation: 'Kubernetes is waiting for dependent objects that block owner deletion.',
    nextStep: 'Inspect and resolve the remaining dependents instead of removing this finalizer.',
  },
  'service.kubernetes.io/load-balancer-cleanup': {
    title: 'Service load-balancer cleanup',
    explanation: 'Kubernetes is waiting for the Service controller to clean up its load balancer.',
    nextStep: 'Restore controller cleanup or remove the external resource through its owner.',
    consequence: 'Manual removal can leave external load-balancer resources behind.',
  },
  'elbv2.k8s.aws/resources': {
    title: 'AWS load-balancer cleanup',
    explanation: 'AWS Load Balancer Controller is reconciling AWS resources for this object.',
    nextStep: 'Restore the controller or resolve its reconciliation error.',
    consequence: 'Manual removal can leave AWS resources behind.',
  },
  'resources-finalizer.argocd.argoproj.io': {
    title: 'Argo CD managed-resource cleanup',
    explanation: 'Argo CD is deleting resources managed by this Application.',
    nextStep: 'Restore Argo CD or resolve its deletion error.',
    consequence: 'Manual removal can orphan resources managed by the Application.',
  },
  'resources-finalizer.argocd.argoproj.io/background': {
    title: 'Argo CD background cleanup',
    explanation: 'Argo CD is deleting resources managed by this Application in the background.',
    nextStep: 'Restore Argo CD or resolve its deletion error.',
    consequence: 'Manual removal can orphan resources managed by the Application.',
  },
  'karpenter.sh/termination': {
    title: 'Karpenter node termination',
    explanation: 'Karpenter is coordinating termination of the underlying node infrastructure.',
    nextStep: 'Restore Karpenter or resolve its termination error.',
    consequence: 'Manual removal can leave underlying compute infrastructure running.',
  },
};

export const finalizerGuidance = (name: string): FinalizerGuidance =>
  KNOWN_FINALIZERS[name] ?? UNKNOWN_FINALIZER;
