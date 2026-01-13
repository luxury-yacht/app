package system

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// registrationDeps bundles dependencies needed to register refresh domains.
type registrationDeps struct {
	registry        *domain.Registry
	informerFactory *informer.Factory
	metricsProvider metrics.Provider
	cfg             Config
	gate            *permissionGate
	serverHost      string
}

// registerNamespaceListingDomain wires the top-level namespace list domain.
func registerNamespaceListingDomain(deps registrationDeps) error {
	return snapshot.RegisterNamespaceDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
}

// registerClusterOverviewDomain wires the cluster overview snapshot domain.
func registerClusterOverviewDomain(deps registrationDeps) error {
	return deps.gate.registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-overview",
		issueResource: "core/nodes,pods,namespaces",
		logGroup:      "",
		logResource:   "nodes/namespaces",
		checks: []listWatchCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
			{group: "", resource: "namespaces"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterOverviewDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
				deps.cfg.KubernetesClient,
				deps.metricsProvider,
				deps.serverHost,
			)
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "namespaces"},
		},
		registerFallback: func() error {
			return snapshot.RegisterClusterOverviewDomainList(
				deps.registry,
				deps.cfg.KubernetesClient,
				deps.metricsProvider,
				deps.serverHost,
			)
		},
		fallbackLog:  "Registering cluster overview domain using list fallback due to missing informer permissions",
		deniedReason: "cluster overview requires nodes/namespaces",
	})
}

// registerCatalogDomains wires object catalog snapshot domains when enabled.
func registerCatalogDomains(deps registrationDeps) error {
	if deps.cfg.ObjectCatalogService == nil {
		return nil
	}
	if err := snapshot.RegisterCatalogDomain(deps.registry, snapshot.CatalogConfig{
		CatalogService:  deps.cfg.ObjectCatalogService,
		NamespaceGroups: deps.cfg.ObjectCatalogNamespaces,
		Logger:          deps.cfg.Logger,
	}); err != nil {
		return err
	}
	// Use a separate catalog domain for the diff viewer to avoid scope collisions with Browse.
	if err := snapshot.RegisterCatalogDiffDomain(deps.registry, snapshot.CatalogConfig{
		CatalogService:  deps.cfg.ObjectCatalogService,
		NamespaceGroups: deps.cfg.ObjectCatalogNamespaces,
		Logger:          deps.cfg.Logger,
	}); err != nil {
		return err
	}
	return nil
}

// registerClusterDomains wires cluster-scoped snapshot domains.
func registerClusterDomains(deps registrationDeps) error {
	if err := deps.gate.registerListWatchDomain(listWatchDomainConfig{
		name:          "nodes",
		issueResource: "core/nodes,pods",
		logGroup:      "",
		logResource:   "nodes/pods",
		checks: []listWatchCheck{
			{group: "", resource: "nodes"},
			{group: "", resource: "pods"},
		},
		registerInformer: func() error {
			return snapshot.RegisterNodeDomain(deps.registry, deps.informerFactory.SharedInformerFactory(), deps.metricsProvider)
		},
		fallbackChecks: []listCheck{
			{group: "", resource: "nodes"},
		},
		registerFallback: func() error {
			return snapshot.RegisterNodeDomainList(deps.registry, deps.cfg.KubernetesClient, deps.metricsProvider)
		},
		fallbackLog:  "Registering nodes domain using list fallback due to missing informer permissions",
		deniedReason: "core/nodes (and pods)",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListDomain(listDomainConfig{
		name:          "cluster-config",
		issueResource: "storage.k8s.io/storageclasses,networking.k8s.io/ingressclasses,admissionregistration.k8s.io/validatingwebhookconfigurations,admissionregistration.k8s.io/mutatingwebhookconfigurations",
		logGroup:      "*",
		logResource:   "storageclasses/ingressclasses/webhooks",
		checks: []listCheck{
			{group: "storage.k8s.io", resource: "storageclasses"},
			{group: "networking.k8s.io", resource: "ingressclasses"},
			{group: "admissionregistration.k8s.io", resource: "validatingwebhookconfigurations"},
			{group: "admissionregistration.k8s.io", resource: "mutatingwebhookconfigurations"},
		},
		allowAny: true,
		register: func(allowed map[string]bool) error {
			return snapshot.RegisterClusterConfigDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
				snapshot.ClusterConfigPermissions{
					IncludeStorageClasses:     allowed["storage.k8s.io/storageclasses"],
					IncludeIngressClasses:     allowed["networking.k8s.io/ingressclasses"],
					IncludeValidatingWebhooks: allowed["admissionregistration.k8s.io/validatingwebhookconfigurations"],
					IncludeMutatingWebhooks:   allowed["admissionregistration.k8s.io/mutatingwebhookconfigurations"],
				},
			)
		},
		deniedReason: "cluster configuration resources",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-crds",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listWatchCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterCRDDomain(
				deps.registry,
				deps.informerFactory.APIExtensionsInformerFactory(),
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListDomain(listDomainConfig{
		name:          "cluster-custom",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterClusterCustomDomain(
				deps.registry,
				deps.informerFactory.APIExtensionsInformerFactory(),
				deps.cfg.DynamicClient,
				deps.cfg.Logger,
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListDomain(listDomainConfig{
		name:          "cluster-events",
		issueResource: "core/events",
		logGroup:      "",
		logResource:   "events",
		checks: []listCheck{
			{group: "", resource: "events"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterClusterEventsDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		},
		deniedReason: "core/events",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-rbac",
		issueResource: "rbac.authorization.k8s.io/clusterroles,clusterrolebindings",
		logGroup:      "rbac.authorization.k8s.io",
		logResource:   "clusterroles/clusterrolebindings",
		checks: []listWatchCheck{
			{group: "rbac.authorization.k8s.io", resource: "clusterroles"},
			{group: "rbac.authorization.k8s.io", resource: "clusterrolebindings"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterRBACDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		},
		deniedReason: "rbac.authorization.k8s.io",
	}); err != nil {
		return err
	}

	if err := deps.gate.registerListWatchDomain(listWatchDomainConfig{
		name:          "cluster-storage",
		issueResource: "core/persistentvolumes",
		logGroup:      "",
		logResource:   "persistentvolumes",
		checks: []listWatchCheck{
			{group: "", resource: "persistentvolumes"},
		},
		registerInformer: func() error {
			return snapshot.RegisterClusterStorageDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		},
		deniedReason: "core/persistentvolumes",
	}); err != nil {
		return err
	}

	return nil
}

// registerNamespaceDomains wires namespace-scoped snapshot domains.
func registerNamespaceDomains(deps registrationDeps) error {
	if err := snapshot.RegisterNamespaceWorkloadsDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
		deps.metricsProvider,
		deps.cfg.Logger,
	); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceAutoscalingDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
	); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceConfigDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
	); err != nil {
		return err
	}

	if deps.cfg.DynamicClient == nil {
		return fmt.Errorf("dynamic client must be provided for namespace custom resources")
	}
	if err := deps.gate.registerListDomain(listDomainConfig{
		name:          "namespace-custom",
		issueResource: "apiextensions.k8s.io/customresourcedefinitions",
		logGroup:      "apiextensions.k8s.io",
		logResource:   "customresourcedefinitions",
		checks: []listCheck{
			{group: "apiextensions.k8s.io", resource: "customresourcedefinitions"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterNamespaceCustomDomain(
				deps.registry,
				deps.informerFactory.APIExtensionsInformerFactory(),
				deps.cfg.DynamicClient,
				deps.cfg.Logger,
			)
		},
		deniedReason: "apiextensions.k8s.io/customresourcedefinitions",
	}); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceEventsDomain(deps.registry, deps.informerFactory.SharedInformerFactory()); err != nil {
		return err
	}

	if deps.cfg.HelmFactory == nil {
		return fmt.Errorf("helm factory must be provided for namespace helm domain")
	}
	if err := snapshot.RegisterNamespaceHelmDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
		deps.cfg.HelmFactory,
	); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceNetworkDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
	); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceQuotasDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
	); err != nil {
		return err
	}

	if err := deps.gate.registerListDomain(listDomainConfig{
		name:          "namespace-rbac",
		issueResource: "rbac.authorization.k8s.io/roles,rolebindings",
		logGroup:      "rbac.authorization.k8s.io",
		logResource:   "roles/rolebindings",
		checks: []listCheck{
			{group: "rbac.authorization.k8s.io", resource: "roles"},
			{group: "rbac.authorization.k8s.io", resource: "rolebindings"},
		},
		register: func(_ map[string]bool) error {
			return snapshot.RegisterNamespaceRBACDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		},
		deniedReason: "rbac.authorization.k8s.io/roles",
	}); err != nil {
		return err
	}

	if err := snapshot.RegisterNamespaceStorageDomain(
		deps.registry,
		deps.informerFactory.SharedInformerFactory(),
	); err != nil {
		return err
	}

	return nil
}

// registerPodDomain wires the pod snapshot domain used by detail views.
func registerPodDomain(deps registrationDeps) error {
	return snapshot.RegisterPodDomain(deps.registry, deps.informerFactory.SharedInformerFactory(), deps.metricsProvider)
}

// registerObjectPanelDomains wires object panel snapshot domains.
func registerObjectPanelDomains(deps registrationDeps) error {
	if err := snapshot.RegisterObjectDetailsDomain(deps.registry, deps.cfg.KubernetesClient, deps.cfg.APIExtensionsClient, deps.cfg.ObjectDetailsProvider); err != nil {
		return err
	}

	if yamlProvider, ok := deps.cfg.ObjectDetailsProvider.(snapshot.ObjectYAMLProvider); ok {
		if err := snapshot.RegisterObjectYAMLDdomain(deps.registry, yamlProvider); err != nil {
			return err
		}
	}

	if helmProvider, ok := deps.cfg.ObjectDetailsProvider.(snapshot.HelmContentProvider); ok {
		if err := snapshot.RegisterObjectHelmManifestDomain(deps.registry, helmProvider); err != nil {
			return err
		}
		if err := snapshot.RegisterObjectHelmValuesDomain(deps.registry, helmProvider); err != nil {
			return err
		}
	}

	if err := snapshot.RegisterObjectEventsDomain(deps.registry, deps.cfg.KubernetesClient, deps.informerFactory.SharedInformerFactory()); err != nil {
		return err
	}

	if err := snapshot.RegisterNodeMaintenanceDomain(deps.registry); err != nil {
		return err
	}

	return nil
}
