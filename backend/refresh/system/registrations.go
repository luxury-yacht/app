package system

import (
	"context"
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
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

// domainMeta captures shared metadata for gated domain registrations.
type domainMeta struct {
	issueResource string
	logGroup      string
	logResource   string
	deniedReason  string
}

// registerDomains registers refresh domains in a fixed order to preserve behavior.
// The checker is used for a universal runtime permission check before each registration.
func registerDomains(ctx context.Context, gate *permissionGate, checker *permissions.Checker, registrations []domainRegistration) error {
	return runDomainRegistrations(ctx, gate, checker, registrations)
}

// runDomainRegistrations applies the registration table in-order.
// Before each domain's gate logic, it checks runtime permissions through the
// shared domain access adapter. If denied, a permission-denied placeholder is
// registered instead of proceeding with the normal registration.
func runDomainRegistrations(ctx context.Context, gate *permissionGate, checker *permissions.Checker, registrations []domainRegistration) error {
	if ctx == nil {
		ctx = context.Background()
	}
	access := domainpermissions.NewRuntimeAccess()
	for _, registration := range registrations {
		if registration.skipIf != nil && registration.skipIf() {
			continue
		}
		if registration.require != nil {
			if err := registration.require(); err != nil {
				return err
			}
		}

		if checker != nil {
			decision, err := access.Check(ctx, registration.name, checker)
			if err == nil && !decision.Allowed {
				if regErr := snapshot.RegisterPermissionDeniedDomain(gate.registry, registration.name, decision.DeniedReason); regErr != nil {
					return regErr
				}
				continue
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
// It merges requirements from the registration table, the shared domain access
// contract, and any extra requests such as metrics.
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

	// Add the shared domain permission contract so runtime and stream checks are pre-warmed.
	for _, req := range domainpermissions.PreflightRequirements() {
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

	crdGroup := "apiextensions.k8s.io"
	crdResource := "customresourcedefinitions"
	crdIssue := crdGroup + "/" + crdResource
	crdMeta := domainMeta{
		issueResource: crdIssue,
		logGroup:      crdGroup,
		logResource:   crdResource,
		deniedReason:  crdIssue,
	}
	crdListWatchCheck := listWatchCheck{group: crdGroup, resource: crdResource}

	yamlProvider, yamlOK := deps.cfg.ObjectDetailsProvider.(snapshot.ObjectYAMLProvider)
	helmProvider, helmOK := deps.cfg.ObjectDetailsProvider.(snapshot.HelmContentProvider)
	runtimeAccess := domainpermissions.NewRuntimeAccess()

	return []domainRegistration{
		directRegistration("namespaces", func() error {
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
			deniedReason: "cluster overview requires nodes",
		}),

		withSkipUnless(directRegistration("catalog", func() error {
			return snapshot.RegisterCatalogDomain(deps.registry, catalogConfig)
		}), func() bool { return deps.cfg.ObjectCatalogService != nil }),
		withSkipUnless(directRegistration("catalog-diff", func() error {
			return snapshot.RegisterCatalogDiffDomain(deps.registry, catalogConfig)
		}), func() bool { return deps.cfg.ObjectCatalogService != nil }),

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

		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "cluster-config",
			issueResource: "storage.k8s.io/storageclasses,networking.k8s.io/ingressclasses,gateway.networking.k8s.io/gatewayclasses,admissionregistration.k8s.io/validatingwebhookconfigurations,admissionregistration.k8s.io/mutatingwebhookconfigurations",
			logGroup:      "*",
			logResource:   "storageclasses/ingressclasses/gatewayclasses/webhooks",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterClusterConfigDomainWithGatewayAPI(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					deps.informerFactory.GatewayInformerFactory(),
					snapshot.ClusterConfigPermissions{
						IncludeStorageClasses:     allowed.Allows("storage.k8s.io", "storageclasses"),
						IncludeIngressClasses:     allowed.Allows("networking.k8s.io", "ingressclasses"),
						IncludeGatewayClasses:     allowed.Allows("gateway.networking.k8s.io", "gatewayclasses"),
						IncludeValidatingWebhooks: allowed.Allows("admissionregistration.k8s.io", "validatingwebhookconfigurations"),
						IncludeMutatingWebhooks:   allowed.Allows("admissionregistration.k8s.io", "mutatingwebhookconfigurations"),
					},
				)
			},
		}),

		listWatchRegistration(applyListWatchMeta(listWatchDomainConfig{
			name:   "cluster-crds",
			checks: []listWatchCheck{crdListWatchCheck},
			registerInformer: func() error {
				return snapshot.RegisterClusterCRDDomain(
					deps.registry,
					deps.informerFactory.APIExtensionsInformerFactory(),
				)
			},
		}, crdMeta)),

		accessListRegistration(runtimeAccess, applyListMeta(listDomainConfig{
			name: "cluster-custom",
			register: func(_ domainpermissions.AllowedResources) error {
				return snapshot.RegisterClusterCustomDomain(
					deps.registry,
					deps.informerFactory.APIExtensionsInformerFactory(),
					deps.cfg.DynamicClient,
					deps.cfg.Logger,
				)
			},
		}, crdMeta)),

		directRegistration("cluster-events", func() error {
			return snapshot.RegisterClusterEventsDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		}),

		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "cluster-rbac",
			issueResource: "rbac.authorization.k8s.io/clusterroles,clusterrolebindings",
			logGroup:      "rbac.authorization.k8s.io",
			logResource:   "clusterroles/clusterrolebindings",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterClusterRBACDomain(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					snapshot.ClusterRBACPermissions{
						IncludeClusterRoles:        allowed.Allows("rbac.authorization.k8s.io", "clusterroles"),
						IncludeClusterRoleBindings: allowed.Allows("rbac.authorization.k8s.io", "clusterrolebindings"),
					},
				)
			},
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

		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "namespace-workloads",
			issueResource: "core/pods,apps/deployments,apps/statefulsets,apps/daemonsets,batch/jobs,batch/cronjobs",
			logGroup:      "*",
			logResource:   "pods/deployments/statefulsets/daemonsets/jobs/cronjobs",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceWorkloadsDomain(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					deps.metricsProvider,
					deps.cfg.Logger,
					snapshot.NamespaceWorkloadsPermissions{
						IncludePods:         allowed.Allows("", "pods"),
						IncludeDeployments:  allowed.Allows("apps", "deployments"),
						IncludeStatefulSets: allowed.Allows("apps", "statefulsets"),
						IncludeDaemonSets:   allowed.Allows("apps", "daemonsets"),
						IncludeJobs:         allowed.Allows("batch", "jobs"),
						IncludeCronJobs:     allowed.Allows("batch", "cronjobs"),
					},
				)
			},
		}),
		directRegistration("namespace-autoscaling", func() error {
			return snapshot.RegisterNamespaceAutoscalingDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),
		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "namespace-config",
			issueResource: "core/configmaps,secrets",
			logGroup:      "",
			logResource:   "configmaps/secrets",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceConfigDomain(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					snapshot.NamespaceConfigPermissions{
						IncludeConfigMaps: allowed.Allows("", "configmaps"),
						IncludeSecrets:    allowed.Allows("", "secrets"),
					},
				)
			},
		}),

		withRequire(accessListRegistration(runtimeAccess, applyListMeta(listDomainConfig{
			name: "namespace-custom",
			register: func(_ domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceCustomDomain(
					deps.registry,
					deps.informerFactory.APIExtensionsInformerFactory(),
					deps.cfg.DynamicClient,
					deps.cfg.Logger,
				)
			},
		}, crdMeta)), requireAvailable("dynamic client must be provided for namespace custom resources", func() bool {
			return deps.cfg.DynamicClient != nil
		})),

		directRegistration("namespace-events", func() error {
			return snapshot.RegisterNamespaceEventsDomain(deps.registry, deps.informerFactory.SharedInformerFactory())
		}),
		withRequire(directRegistration("namespace-helm", func() error {
			return snapshot.RegisterNamespaceHelmDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
				deps.cfg.HelmFactory,
			)
		}), requireAvailable("helm factory must be provided for namespace helm domain", func() bool {
			return deps.cfg.HelmFactory != nil
		})),
		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "namespace-network",
			issueResource: "core/services,discovery.k8s.io/endpointslices,networking.k8s.io/ingresses,networking.k8s.io/networkpolicies,gateway.networking.k8s.io",
			logGroup:      "*",
			logResource:   "services/endpointslices/ingresses/networkpolicies/gateway-api",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceNetworkDomainWithGatewayAPI(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					deps.informerFactory.GatewayInformerFactory(),
					snapshot.NamespaceNetworkPermissions{
						IncludeServices:           allowed.Allows("", "services"),
						IncludeEndpointSlices:     allowed.Allows("discovery.k8s.io", "endpointslices"),
						IncludeIngresses:          allowed.Allows("networking.k8s.io", "ingresses"),
						IncludeNetworkPolicies:    allowed.Allows("networking.k8s.io", "networkpolicies"),
						IncludeGateways:           allowed.Allows("gateway.networking.k8s.io", "gateways"),
						IncludeHTTPRoutes:         allowed.Allows("gateway.networking.k8s.io", "httproutes"),
						IncludeGRPCRoutes:         allowed.Allows("gateway.networking.k8s.io", "grpcroutes"),
						IncludeTLSRoutes:          allowed.Allows("gateway.networking.k8s.io", "tlsroutes"),
						IncludeListenerSets:       allowed.Allows("gateway.networking.k8s.io", "listenersets"),
						IncludeReferenceGrants:    allowed.Allows("gateway.networking.k8s.io", "referencegrants"),
						IncludeBackendTLSPolicies: allowed.Allows("gateway.networking.k8s.io", "backendtlspolicies"),
					},
				)
			},
		}),
		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "namespace-quotas",
			issueResource: "core/resourcequotas,limitranges,policy/poddisruptionbudgets",
			logGroup:      "*",
			logResource:   "resourcequotas/limitranges/poddisruptionbudgets",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceQuotasDomain(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					snapshot.NamespaceQuotasPermissions{
						IncludeResourceQuotas:       allowed.Allows("", "resourcequotas"),
						IncludeLimitRanges:          allowed.Allows("", "limitranges"),
						IncludePodDisruptionBudgets: allowed.Allows("policy", "poddisruptionbudgets"),
					},
				)
			},
		}),

		accessListRegistration(runtimeAccess, listDomainConfig{
			name:          "namespace-rbac",
			issueResource: "rbac.authorization.k8s.io/roles,rolebindings,core/serviceaccounts",
			logGroup:      "rbac.authorization.k8s.io",
			logResource:   "roles/rolebindings/serviceaccounts",
			register: func(allowed domainpermissions.AllowedResources) error {
				return snapshot.RegisterNamespaceRBACDomain(
					deps.registry,
					deps.informerFactory.SharedInformerFactory(),
					snapshot.NamespaceRBACPermissions{
						IncludeRoles:           allowed.Allows("rbac.authorization.k8s.io", "roles"),
						IncludeRoleBindings:    allowed.Allows("rbac.authorization.k8s.io", "rolebindings"),
						IncludeServiceAccounts: allowed.Allows("", "serviceaccounts"),
					},
				)
			},
		}),

		directRegistration("namespace-storage", func() error {
			return snapshot.RegisterNamespaceStorageDomain(
				deps.registry,
				deps.informerFactory.SharedInformerFactory(),
			)
		}),

		directRegistration("pods", func() error {
			return snapshot.RegisterPodDomain(deps.registry, deps.informerFactory.SharedInformerFactory(), deps.metricsProvider)
		}),

		directRegistration("object-details", func() error {
			return snapshot.RegisterObjectDetailsDomain(
				deps.registry,
				deps.cfg.ObjectDetailsProvider,
			)
		}),
		withSkipUnless(directRegistration("object-yaml", func() error {
			return snapshot.RegisterObjectYAMLDdomain(deps.registry, yamlProvider)
		}), func() bool { return yamlOK }),
		withSkipUnless(directRegistration("object-helm-manifest", func() error {
			return snapshot.RegisterObjectHelmManifestDomain(deps.registry, helmProvider)
		}), func() bool { return helmOK }),
		withSkipUnless(directRegistration("object-helm-values", func() error {
			return snapshot.RegisterObjectHelmValuesDomain(deps.registry, helmProvider)
		}), func() bool { return helmOK }),
		directRegistration("object-events", func() error {
			return snapshot.RegisterObjectEventsDomain(deps.registry, deps.cfg.KubernetesClient, deps.informerFactory.SharedInformerFactory())
		}),
		directRegistration("object-map", func() error {
			return snapshot.RegisterObjectMapDomain(
				deps.registry,
				deps.cfg.KubernetesClient,
				deps.cfg.GatewayClient,
				deps.cfg.GatewayAPIPresence,
				deps.cfg.ObjectCatalogService,
			)
		}),
		directRegistration("object-maintenance", func() error {
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

func accessListRegistration(access domainpermissions.RuntimeAccess, cfg listDomainConfig) domainRegistration {
	plan, ok := access.RegistrationPlan(cfg.name)
	if !ok {
		panic(fmt.Sprintf("registration access plan missing for %s", cfg.name))
	}
	cfg.checks = listChecksFromRegistrationPlan(plan)
	cfg.allowAny = plan.AllowAny()
	cfg.deniedReason = plan.DeniedReason
	return listRegistration(cfg)
}

func listChecksFromRegistrationPlan(plan domainpermissions.RegistrationAccessPlan) []listCheck {
	checks := make([]listCheck, 0, len(plan.Requirements))
	for _, req := range plan.Requirements {
		if req.Verb != "list" {
			panic(fmt.Sprintf("registration access plan %s contains non-list requirement %s", plan.Domain, req.Verb))
		}
		checks = append(checks, listCheck{group: req.Group, resource: req.Resource})
	}
	return checks
}

func listWatchRegistration(cfg listWatchDomainConfig) domainRegistration {
	cfgCopy := cfg
	return domainRegistration{name: cfgCopy.name, listWatch: &cfgCopy}
}

func withSkip(registration domainRegistration, skip func() bool) domainRegistration {
	registration.skipIf = skip
	return registration
}

func withSkipUnless(registration domainRegistration, available func() bool) domainRegistration {
	return withSkip(registration, func() bool {
		return !available()
	})
}

func withRequire(registration domainRegistration, require func() error) domainRegistration {
	registration.require = require
	return registration
}

func requireAvailable(message string, available func() bool) func() error {
	return func() error {
		if !available() {
			return errors.New(message)
		}
		return nil
	}
}

// applyListMeta copies shared metadata into a list-gated registration config.
func applyListMeta(cfg listDomainConfig, meta domainMeta) listDomainConfig {
	cfg.issueResource = meta.issueResource
	cfg.logGroup = meta.logGroup
	cfg.logResource = meta.logResource
	cfg.deniedReason = meta.deniedReason
	return cfg
}

// applyListWatchMeta copies shared metadata into a list/watch-gated registration config.
func applyListWatchMeta(cfg listWatchDomainConfig, meta domainMeta) listWatchDomainConfig {
	cfg.issueResource = meta.issueResource
	cfg.logGroup = meta.logGroup
	cfg.logResource = meta.logResource
	cfg.deniedReason = meta.deniedReason
	return cfg
}
