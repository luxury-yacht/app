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
	registry        *domain.Registry  // Domain registry for managing domain lifecycles
	informerFactory *informer.Factory // Factory for creating informers
	metricsProvider metrics.Provider  // Provider for collecting metrics
	cfg             Config            // Configuration settings
	gate            *permissionGate   // Permission gate for access control
	serverHost      string            // Hostname of the server
}

// domainRegistration describes a single domain registration entry.
type domainRegistration struct {
	name               string                 // Name of the domain
	list               *listDomainConfig      // List-based domain configuration
	listWatch          *listWatchDomainConfig // List-watch-based domain configuration
	preflightList      []listCheck            // Preflight checks for list operations
	preflightListWatch []listWatchCheck       // Preflight checks for list-watch operations
	direct             func() error           // Direct registration function
	skipIf             func() bool            // Function to determine if registration should be skipped
	require            func() error           // Function to determine if registration is required
}

// registerDomains registers refresh domains in a fixed order to preserve behavior.
func registerDomains(gate *permissionGate, registrations []domainRegistration) error {
	return runDomainRegistrations(gate, registrations)
}

// runDomainRegistrations applies the registration table in-order.
func runDomainRegistrations(gate *permissionGate, registrations []domainRegistration) error {
	for _, registration := range registrations {
		if registration.skipIf != nil && registration.skipIf() {
			continue
		}
		if registration.require != nil {
			if err := registration.require(); err != nil {
				return err
			}
		}
		hasList := registration.list != nil
		hasListWatch := registration.listWatch != nil
		hasDirect := registration.direct != nil
		kindCount := 0
		if hasList {
			kindCount++
		}
		if hasListWatch {
			kindCount++
		}
		if hasDirect {
			kindCount++
		}
		if kindCount != 1 {
			return fmt.Errorf("domain registration %q must provide exactly one registration kind", registration.name)
		}

		if hasList {
			if err := gate.registerListDomain(*registration.list); err != nil {
				return err
			}
			continue
		}
		if hasListWatch {
			if err := gate.registerListWatchDomain(*registration.listWatch); err != nil {
				return err
			}
			continue
		}
		if err := registration.direct(); err != nil {
			return err
		}
	}
	return nil
}

// preflightRequests collects permission requests used to prime permission caches.
func preflightRequests(registrations []domainRegistration, extra []informer.PermissionRequest) []informer.PermissionRequest {
	requests := make([]informer.PermissionRequest, 0, len(extra))
	seen := make(map[string]struct{})

	add := func(group, resource, verb string) {
		key := fmt.Sprintf("%s/%s/%s", group, resource, verb)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		requests = append(requests, informer.PermissionRequest{
			Group:    group,
			Resource: resource,
			Verb:     verb,
		})
	}

	for _, req := range extra {
		add(req.Group, req.Resource, req.Verb)
	}

	for _, registration := range registrations {
		if registration.list != nil {
			for _, check := range registration.list.checks {
				add(check.group, check.resource, "list")
			}
		}
		if registration.listWatch != nil {
			for _, check := range registration.listWatch.checks {
				add(check.group, check.resource, "list")
				add(check.group, check.resource, "watch")
			}
		}
		for _, check := range registration.preflightList {
			add(check.group, check.resource, "list")
		}
		for _, check := range registration.preflightListWatch {
			add(check.group, check.resource, "list")
			add(check.group, check.resource, "watch")
		}
	}

	return requests
}

// domainRegistrations returns the ordered domain registration table.
func domainRegistrations(deps registrationDeps) []domainRegistration {
	catalogConfig := snapshot.CatalogConfig{
		CatalogService:  deps.cfg.ObjectCatalogService,
		NamespaceGroups: deps.cfg.ObjectCatalogNamespaces,
		Logger:          deps.cfg.Logger,
	}

	yamlProvider, yamlOK := deps.cfg.ObjectDetailsProvider.(snapshot.ObjectYAMLProvider)
	helmProvider, helmOK := deps.cfg.ObjectDetailsProvider.(snapshot.HelmContentProvider)

	return []domainRegistration{
		directRegistration("namespace-listing", func() error {
			return snapshot.RegisterNamespaceDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		}),

		listWatchRegistration(listWatchDomainConfig{
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
		}),

		withSkip(directRegistration("catalog", func() error {
			return snapshot.RegisterCatalogDomain(deps.registry, catalogConfig)
		}), func() bool {
			return deps.cfg.ObjectCatalogService == nil
		}),
		withSkip(directRegistration("catalog-diff", func() error {
			return snapshot.RegisterCatalogDiffDomain(deps.registry, catalogConfig)
		}), func() bool {
			return deps.cfg.ObjectCatalogService == nil
		}),

		listWatchRegistration(listWatchDomainConfig{
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
		}),

		listRegistration(listDomainConfig{
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
		}),

		listWatchRegistration(listWatchDomainConfig{
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
		}),

		listRegistration(listDomainConfig{
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
		}),

		listRegistration(listDomainConfig{
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
		}),

		listWatchRegistration(listWatchDomainConfig{
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
		}),

		listWatchRegistration(listWatchDomainConfig{
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
		}),

		directRegistration("namespace-workloads", func() error {
			return snapshot.RegisterNamespaceWorkloadsDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
				deps.metricsProvider,
				deps.cfg.Logger,
			)
		}),
		directRegistration("namespace-autoscaling", func() error {
			return snapshot.RegisterNamespaceAutoscalingDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),
		directRegistration("namespace-config", func() error {
			return snapshot.RegisterNamespaceConfigDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),

		withRequire(listRegistration(listDomainConfig{
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
		}), func() error {
			if deps.cfg.DynamicClient == nil {
				return fmt.Errorf("dynamic client must be provided for namespace custom resources")
			}
			return nil
		}),

		directRegistration("namespace-events", func() error {
			return snapshot.RegisterNamespaceEventsDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		}),
		withRequire(directRegistration("namespace-helm", func() error {
			return snapshot.RegisterNamespaceHelmDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
				deps.cfg.HelmFactory,
			)
		}), func() error {
			if deps.cfg.HelmFactory == nil {
				return fmt.Errorf("helm factory must be provided for namespace helm domain")
			}
			return nil
		}),
		withPreflightListWatch(directRegistration("namespace-network", func() error {
			return snapshot.RegisterNamespaceNetworkDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}), []listWatchCheck{
			{group: "discovery.k8s.io", resource: "endpointslices"},
		}),
		directRegistration("namespace-quotas", func() error {
			return snapshot.RegisterNamespaceQuotasDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),

		listRegistration(listDomainConfig{
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
		}),

		directRegistration("namespace-storage", func() error {
			return snapshot.RegisterNamespaceStorageDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),

		directRegistration("pod", func() error {
			return snapshot.RegisterPodDomain(deps.registry, deps.informerFactory.SharedInformerFactory(), deps.metricsProvider)
		}),

		directRegistration("object-details", func() error {
			return snapshot.RegisterObjectDetailsDomain(
				deps.registry,
				deps.cfg.KubernetesClient,
				deps.cfg.APIExtensionsClient,
				deps.cfg.ObjectDetailsProvider,
			)
		}),
		withSkip(directRegistration("object-yaml", func() error {
			return snapshot.RegisterObjectYAMLDdomain(deps.registry, yamlProvider)
		}), func() bool {
			return !yamlOK
		}),
		withSkip(directRegistration("object-helm-manifest", func() error {
			return snapshot.RegisterObjectHelmManifestDomain(deps.registry, helmProvider)
		}), func() bool {
			return !helmOK
		}),
		withSkip(directRegistration("object-helm-values", func() error {
			return snapshot.RegisterObjectHelmValuesDomain(deps.registry, helmProvider)
		}), func() bool {
			return !helmOK
		}),
		directRegistration("object-events", func() error {
			return snapshot.RegisterObjectEventsDomain(deps.registry, deps.cfg.KubernetesClient, deps.informerFactory.SharedInformerFactory())
		}),
		directRegistration("node-maintenance", func() error {
			return snapshot.RegisterNodeMaintenanceDomain(deps.registry)
		}),
	}
}

func directRegistration(name string, register func() error) domainRegistration {
	return domainRegistration{name: name, direct: register}
}

func listRegistration(cfg listDomainConfig) domainRegistration {
	cfgCopy := cfg
	return domainRegistration{name: cfgCopy.name, list: &cfgCopy}
}

func listWatchRegistration(cfg listWatchDomainConfig) domainRegistration {
	cfgCopy := cfg
	return domainRegistration{name: cfgCopy.name, listWatch: &cfgCopy}
}

func withSkip(registration domainRegistration, skip func() bool) domainRegistration {
	registration.skipIf = skip
	return registration
}

func withRequire(registration domainRegistration, require func() error) domainRegistration {
	registration.require = require
	return registration
}

func withPreflightListWatch(registration domainRegistration, checks []listWatchCheck) domainRegistration {
	registration.preflightListWatch = append(registration.preflightListWatch, checks...)
	return registration
}
