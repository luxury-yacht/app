export interface FinalizerGuidance {
  /** Short chip label naming why the finalizer is still held. */
  category: string;
  explanation: string;
  nextStep: string;
  /** Set only where forcing removal has a specific, known cost. */
  consequence?: string;
  /** False when no catalog entry matches the finalizer name. */
  recognized: boolean;
}

type CatalogEntry = Omit<FinalizerGuidance, 'recognized'>;

const UNKNOWN_FINALIZER: CatalogEntry = {
  category: 'Unrecognized',
  explanation: 'No controller known to Luxury Yacht is responsible for this finalizer.',
  nextStep: 'Identify the controller and the cleanup it protects before removing it.',
};

// A Map, not an object literal: finalizer names come from the API server, so
// a name like "constructor" must miss rather than hit the prototype.
const KNOWN_FINALIZERS = new Map<string, CatalogEntry>(
  Object.entries({
    kubernetes: {
      category: 'Namespace cleanup',
      explanation: 'The namespace controller is still deleting the objects inside this namespace.',
      nextStep: 'Resolve the remaining content reported by the deletion conditions.',
    },
    'kubernetes.io/pvc-protection': {
      category: 'In use',
      explanation: 'Kubernetes keeps this finalizer while the claim is in use by a Pod.',
      nextStep: 'Resolve the Pods using this claim and let Kubernetes complete deletion.',
    },
    'kubernetes.io/pv-protection': {
      category: 'Bound',
      explanation: 'Kubernetes keeps this finalizer while the volume is bound to a claim.',
      nextStep: 'Resolve the bound claim and let Kubernetes complete deletion.',
    },
    foregroundDeletion: {
      category: 'Dependents',
      explanation: 'Kubernetes is waiting for dependent objects that block owner deletion.',
      nextStep: 'Inspect and resolve the remaining dependents instead of removing this finalizer.',
    },
    'service.kubernetes.io/load-balancer-cleanup': {
      category: 'Cleanup',
      explanation:
        'Kubernetes is waiting for the Service controller to clean up its load balancer.',
      nextStep: 'Restore controller cleanup or remove the external resource through its owner.',
      consequence: 'Manual removal can leave external load-balancer resources behind.',
    },
    'elbv2.k8s.aws/resources': {
      category: 'Cleanup',
      explanation: 'AWS Load Balancer Controller is reconciling AWS resources for this object.',
      nextStep: 'Restore the controller or resolve its reconciliation error.',
      consequence: 'Manual removal can leave AWS resources behind.',
    },
    'resources-finalizer.argocd.argoproj.io': {
      category: 'Cleanup',
      explanation: 'Argo CD is deleting resources managed by this Application.',
      nextStep: 'Restore Argo CD or resolve its deletion error.',
      consequence: 'Manual removal can orphan resources managed by the Application.',
    },
    'resources-finalizer.argocd.argoproj.io/background': {
      category: 'Cleanup',
      explanation: 'Argo CD is deleting resources managed by this Application in the background.',
      nextStep: 'Restore Argo CD or resolve its deletion error.',
      consequence: 'Manual removal can orphan resources managed by the Application.',
    },
    'karpenter.sh/termination': {
      category: 'Cleanup',
      explanation: 'Karpenter is coordinating termination of the underlying node infrastructure.',
      nextStep: 'Restore Karpenter or resolve its termination error.',
      consequence: 'Manual removal can leave underlying compute infrastructure running.',
    },
  } satisfies Record<string, CatalogEntry>)
);

export const finalizerGuidance = (name: string): FinalizerGuidance => {
  const entry = KNOWN_FINALIZERS.get(name);
  return entry ? { ...entry, recognized: true } : { ...UNKNOWN_FINALIZER, recognized: false };
};
