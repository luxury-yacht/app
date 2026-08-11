export interface FinalizerGuidance {
  explanation: string;
  nextStep: string;
  warnsAboutMissingAttribution: boolean;
  /** Set only where forcing removal has a specific, known cost. */
  consequence?: string;
}

type CatalogEntry = Omit<FinalizerGuidance, 'warnsAboutMissingAttribution'>;

// Not in the catalog, but domain-qualified: the prefix names the controller,
// which is more than "we have no blurb for this string" ever told anyone.
const UNCATALOGUED_FINALIZER: CatalogEntry = {
  explanation:
    'Luxury Yacht has no guidance for this finalizer. Its domain prefix names the controller responsible for the cleanup.',
  nextStep: 'Confirm that controller is running and able to finish its cleanup before removing it.',
};

// Kubernetes validates finalizers as qualified names, so a bare name is legal
// but attributes the cleanup to nobody. That is the case worth flagging.
const UNATTRIBUTABLE_FINALIZER: CatalogEntry = {
  explanation:
    'This finalizer has no domain prefix, so nothing identifies the controller behind it.',
  nextStep: 'Identify the controller and the cleanup it protects before removing it.',
};

// A Map, not an object literal: finalizer names come from the API server, so
// a name like "constructor" must miss rather than hit the prototype.
const KNOWN_FINALIZERS = new Map<string, CatalogEntry>(
  Object.entries({
    kubernetes: {
      explanation: 'The namespace controller is still deleting the objects inside this namespace.',
      nextStep: 'Resolve the remaining content reported by the deletion conditions.',
    },
    'kubernetes.io/pvc-protection': {
      explanation: 'Kubernetes keeps this finalizer while the claim is in use by a Pod.',
      nextStep: 'Resolve the Pods using this claim and let Kubernetes complete deletion.',
    },
    'kubernetes.io/pv-protection': {
      explanation: 'Kubernetes keeps this finalizer while the volume is bound to a claim.',
      nextStep: 'Resolve the bound claim and let Kubernetes complete deletion.',
    },
    foregroundDeletion: {
      explanation: 'Kubernetes is waiting for dependent objects that block owner deletion.',
      nextStep: 'Inspect and resolve the remaining dependents instead of removing this finalizer.',
    },
    orphan: {
      explanation: 'Kubernetes is orphaning the dependents of this owner before deleting it.',
      nextStep:
        'Let the garbage collector finish; it clears this finalizer once dependents are orphaned.',
    },
    'service.kubernetes.io/load-balancer-cleanup': {
      explanation:
        'Kubernetes is waiting for the Service controller to clean up its load balancer.',
      nextStep: 'Restore controller cleanup or remove the external resource through its owner.',
      consequence: 'Manual removal can leave external load-balancer resources behind.',
    },
    'elbv2.k8s.aws/resources': {
      explanation: 'AWS Load Balancer Controller is reconciling AWS resources for this object.',
      nextStep: 'Restore the controller or resolve its reconciliation error.',
      consequence: 'Manual removal can leave AWS resources behind.',
    },
    'resources-finalizer.argocd.argoproj.io': {
      explanation: 'Argo CD is deleting resources managed by this Application.',
      nextStep: 'Restore Argo CD or resolve its deletion error.',
      consequence: 'Manual removal can orphan resources managed by the Application.',
    },
    'resources-finalizer.argocd.argoproj.io/background': {
      explanation: 'Argo CD is deleting resources managed by this Application in the background.',
      nextStep: 'Restore Argo CD or resolve its deletion error.',
      consequence: 'Manual removal can orphan resources managed by the Application.',
    },
    'karpenter.sh/termination': {
      explanation: 'Karpenter is coordinating termination of the underlying node infrastructure.',
      nextStep: 'Restore Karpenter or resolve its termination error.',
      consequence: 'Manual removal can leave underlying compute infrastructure running.',
    },
  } satisfies Record<string, CatalogEntry>)
);

const hasQualifier = (name: string): boolean => name.indexOf('/') > 0;

export const finalizerGuidance = (name: string): FinalizerGuidance => {
  const entry = KNOWN_FINALIZERS.get(name);
  if (entry) {
    return { ...entry, warnsAboutMissingAttribution: false };
  }
  return hasQualifier(name)
    ? { ...UNCATALOGUED_FINALIZER, warnsAboutMissingAttribution: false }
    : { ...UNATTRIBUTABLE_FINALIZER, warnsAboutMissingAttribution: true };
};
