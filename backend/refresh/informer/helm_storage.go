/*
 * backend/refresh/informer/helm_storage.go
 *
 * The dedicated helm-storage source: a label-filtered (owner=helm) informer set
 * over Secrets and ConfigMaps that keeps the FULL typed helm-release objects.
 *
 * ConfigMap and Secret are cut over to the owned-reflector ingest path, so the
 * shared informer factory no longer caches them as typed objects — but three
 * helm consumers still need the full typed object: the namespace-helm domain
 * lister (it decodes secret.Data["release"]), the resource-stream helm-refresh
 * signal (it reads Name/Labels/Type), and the response-cache helm eviction (it
 * switches on the typed secret/configmap). Helm's own storage driver writes every
 * release as an owner=helm Secret (or ConfigMap) and lists releases by exactly
 * that label selector (helm.sh/helm/v3 storage/driver), so a server-side
 * label-filtered watch captures the entire helm-release set — a small subset of
 * all secrets/configmaps — while every other secret/configmap is only an ingest
 * projection. The full-object memory cost is bounded to the release set, the
 * cutover's per-kind win is preserved for the rest.
 */

package informer

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// helmReleaseOwnerSelector narrows the helm-storage watch to helm's release
// records. Helm's storage driver stamps every release Secret/ConfigMap with this
// label and lists releases by exactly this selector, so it captures the full
// helm-release set server-side without caching unrelated secrets/configmaps.
var helmReleaseOwnerSelector = labels.SelectorFromSet(labels.Set{"owner": "helm"}).String()

// HelmStorageSource holds the full typed helm-release Secrets and ConfigMaps from
// a label-filtered (owner=helm) informer set, for the helm consumers that still
// need the typed object after ConfigMap/Secret are cut to the ingest path. Its
// informers participate in the owning Factory's sync gate and shutdown, so the
// refresh manager's single lifecycle drives it alongside everything else.
type HelmStorageSource struct {
	factory        informers.SharedInformerFactory
	secretInformer cache.SharedIndexInformer
	configInformer cache.SharedIndexInformer
}

// SecretLister returns the helm-storage Secret lister, scoped to owner=helm
// release Secrets. It satisfies the corelisters.SecretLister the namespace-helm
// builder already consumes, so re-pointing the builder onto the helm-storage
// source is a field swap with no decode/scan changes.
func (s *HelmStorageSource) SecretLister() corelisters.SecretLister {
	if s == nil || s.factory == nil {
		return nil
	}
	return s.factory.Core().V1().Secrets().Lister()
}

// SecretsHasSynced reports whether the helm-storage Secret informer has completed
// its initial relist — the readiness gate the namespace-helm builder waits on
// before serving, replacing the shared secrets informer's HasSynced. It reports
// synced when no secret informer was created (the identity cannot list secrets),
// so the builder serves an empty page rather than blocking forever.
func (s *HelmStorageSource) SecretsHasSynced() cache.InformerSynced {
	if s == nil || s.secretInformer == nil {
		return func() bool { return true }
	}
	return s.secretInformer.HasSynced
}

// SecretInformer / ConfigMapInformer expose the filtered informers so the
// resource-stream helm-refresh signal and the response-cache helm eviction can
// register their event handlers on the helm-storage source rather than the shared
// configmap/secret informer the cutover removed. Either may be nil when the user
// cannot list/watch that kind.
func (s *HelmStorageSource) SecretInformer() cache.SharedIndexInformer {
	if s == nil {
		return nil
	}
	return s.secretInformer
}

func (s *HelmStorageSource) ConfigMapInformer() cache.SharedIndexInformer {
	if s == nil {
		return nil
	}
	return s.configInformer
}

// newHelmStorageSource builds the label-filtered helm-storage factory and registers
// its Secret/ConfigMap informers for sync — but only for the kinds the identity can
// list AND watch, mirroring the shared factory's per-resource permission gate. It is
// a no-op (nil informers) for a kind without permission, so a denied secret/configmap
// never creates a filtered watch. The informers are created but not started here; the
// owning Factory's Start runs the filtered factory alongside the shared one.
func (f *Factory) newHelmStorageSource() *HelmStorageSource {
	if f == nil || f.kubeClient == nil {
		return nil
	}
	resync := f.resync
	if resync <= 0 {
		resync = config.RefreshResyncInterval
	}
	// Project-at-intake (strip managedFields) exactly as the shared factory does, so
	// the held release objects carry no more than the shared cache would have.
	helmFactory := informers.NewSharedInformerFactoryWithOptions(
		f.kubeClient,
		resync,
		informers.WithTransform(StripManagedFields),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = helmReleaseOwnerSelector
		}),
	)
	source := &HelmStorageSource{factory: helmFactory}
	if f.canListWatchHelmStorage("", "secrets") {
		source.secretInformer = helmFactory.Core().V1().Secrets().Informer()
		f.registerInformer("", "secrets", source.secretInformer)
	}
	if f.canListWatchHelmStorage("", "configmaps") {
		source.configInformer = helmFactory.Core().V1().ConfigMaps().Informer()
		f.registerInformer("", "configmaps", source.configInformer)
	}
	return source
}

// canListWatchHelmStorage reports whether the identity may list AND watch the
// resource — the precondition for creating a filtered informer over it. It reuses
// the Factory's permission checks so the helm-storage gate matches every other
// informer's gate.
func (f *Factory) canListWatchHelmStorage(group, resource string) bool {
	listAllowed, listErr := f.CanListResource(group, resource)
	if listErr != nil || !listAllowed {
		return false
	}
	watchAllowed, watchErr := f.CanWatchResource(group, resource)
	if watchErr != nil || !watchAllowed {
		return false
	}
	return true
}
