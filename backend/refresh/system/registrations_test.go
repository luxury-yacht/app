package system

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
)

// These tests guard the registration table ordering and dependency checks.

type refreshDomainContract struct {
	Version         int                             `json:"version"`
	DomainInventory map[string]domainInventoryEntry `json:"domainInventory"`
	ResourceStream  struct {
		UpdateIdentity struct {
			RowUpdates                  string   `json:"rowUpdates"`
			RowDeletes                  string   `json:"rowDeletes"`
			LegacyFieldsDuringMigration []string `json:"legacyFieldsDuringMigration"`
			CompleteSemantics           string   `json:"completeSemantics"`
			CompleteIdentity            string   `json:"completeIdentity"`
		} `json:"updateIdentity"`
		Domains map[string]streamDomainContract `json:"domains"`
	} `json:"resourceStream"`
	Domains []refreshDomainRecord `json:"domains"`
}

type domainInventoryEntry struct {
	BehaviorClass    string        `json:"behaviorClass"`
	ScopeContract    scopeContract `json:"scopeContract"`
	SingleCluster    bool          `json:"singleCluster"`
	PayloadOwner     string        `json:"payloadOwner"`
	CachePolicy      string        `json:"cachePolicy"`
	StreamSemantics  []string      `json:"streamSemantics"`
	CoverageContract string        `json:"coverageContract"`
	CoverageStatus   string        `json:"coverageStatus"`
}

type scopeContract struct {
	Kind              string   `json:"kind"`
	ClusterPrefix     string   `json:"clusterPrefix"`
	Parser            string   `json:"parser"`
	FrontendBuilder   string   `json:"frontendBuilder"`
	AcceptedEncodings []string `json:"acceptedEncodings"`
}

type streamDomainContract struct {
	ScopeKind            string                 `json:"scopeKind"`
	MetricsDependency    bool                   `json:"metricsDependency"`
	CompleteIsScopeLevel bool                   `json:"completeIsScopeLevel"`
	RowProjection        string                 `json:"rowProjection,omitempty"`
	PrimaryResources     []streamResourceRecord `json:"primaryResources"`
	RelatedResources     []streamResourceRecord `json:"relatedResources"`
	SyntheticRowKind     *streamResourceRecord  `json:"syntheticRowKind,omitempty"`
}

type streamResourceRecord struct {
	Group    string `json:"group"`
	Version  string `json:"version"`
	Kind     string `json:"kind"`
	Resource string `json:"resource"`
}

type refreshDomainRecord struct {
	Domain  string `json:"domain"`
	Backend struct {
		Registration   string `json:"registration"`
		Permission     string `json:"permission"`
		ResourceStream bool   `json:"resourceStream"`
	} `json:"backend"`
}

func TestDomainRegistrationOrder(t *testing.T) {
	expected := contractSnapshotDomains(t)

	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	actual := make([]string, 0, len(registrations))
	for _, registration := range registrations {
		actual = append(actual, registration.name)
	}

	require.Equal(t, expected, actual)
}

func TestDomainRegistrationsMatchAuthoredContract(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	registered := make(map[string]domainRegistration, len(registrations))
	for _, registration := range registrations {
		registered[registration.name] = registration
	}

	contractDomains := make(map[string]struct{}, len(contract.Domains))
	for _, domain := range contract.Domains {
		require.NotEmpty(t, domain.Domain)
		require.NotContains(t, contractDomains, domain.Domain)
		contractDomains[domain.Domain] = struct{}{}

		if domain.Backend.Registration == "streamOnly" {
			require.NotContains(t, registered, domain.Domain)
			continue
		}

		registration, ok := registered[domain.Domain]
		require.Truef(t, ok, "domain %q is missing backend registration", domain.Domain)
		require.Equalf(t, domain.Backend.Registration, registrationKind(registration), "domain %q registration kind drifted", domain.Domain)
	}

	for _, registration := range registrations {
		require.Containsf(t, contractDomains, registration.name, "backend domain %q is missing from refresh-domain-contract.json", registration.name)
	}
}

func TestDomainInventoryCoversAuthoredDomainsAndUsesKnownVocabulary(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	require.Len(t, contract.DomainInventory, len(contract.Domains))

	domainIDs := make(map[string]struct{}, len(contract.Domains))
	for _, domain := range contract.Domains {
		domainIDs[domain.Domain] = struct{}{}
	}

	behaviorClasses := setOf(
		"snapshot-table",
		"aggregate-snapshot",
		"resource-stream-table",
		"complete-resync-stream",
		"catalog-stream",
		"catalog-snapshot",
		"event-stream",
		"event-snapshot",
		"log-stream",
		"detail-payload",
		"helm-content-payload",
		"graph-payload",
		"operation-state",
	)
	scopeKinds := setOf(
		"cluster",
		"optional-namespace",
		"catalog-query",
		"resource-stream-selector",
		"event-stream-scope",
		"object-ref",
		"helm-release",
		"object-map",
		"node-maintenance",
		"log-stream-selector",
	)
	cachePolicies := setOf(
		"snapshot-cache",
		"snapshot-cache-with-merge",
		"snapshot-cache-bypass",
		"snapshot-cache-plus-provider-cache",
		"external-catalog-cache",
		"external-catalog-cache-with-merge",
		"stream-only",
	)
	streamSemantics := setOf("row-update", "complete-resync", "append-merge", "snapshot-replace", "line-stream", "none")
	coverageContracts := setOf(
		"snapshot-table-payload",
		"resource-stream-row-parity",
		"complete-resync-only",
		"catalog-consistency",
		"catalog-snapshot-query",
		"event-resume-merge",
		"event-snapshot-payload",
		"log-stream-lifecycle",
		"detail-payload-shape",
		"helm-content-shape",
		"graph-payload-identity",
		"operation-state-transitions",
		"aggregate-snapshot-permission-fallback",
	)
	enforcedProofs := enforcedCoverageProofs(t)

	for domainID, inventory := range contract.DomainInventory {
		require.Containsf(t, domainIDs, domainID, "inventory domain %q is not present in domains[]", domainID)
		require.Containsf(t, behaviorClasses, inventory.BehaviorClass, "domain %q behaviorClass", domainID)
		require.Containsf(t, scopeKinds, inventory.ScopeContract.Kind, "domain %q scope kind", domainID)
		require.Equalf(t, "required", inventory.ScopeContract.ClusterPrefix, "domain %q cluster prefix", domainID)
		require.NotEmptyf(t, inventory.ScopeContract.Parser, "domain %q parser owner", domainID)
		require.NotEmptyf(t, inventory.ScopeContract.FrontendBuilder, "domain %q frontend builder owner", domainID)
		requireSourcePathExists(t, inventory.ScopeContract.Parser)
		requireSourcePathExists(t, inventory.ScopeContract.FrontendBuilder)
		require.NotEmptyf(t, inventory.ScopeContract.AcceptedEncodings, "domain %q accepted encodings", domainID)
		require.Truef(t, inventory.SingleCluster, "domain %q must stay single-cluster at refresh boundary", domainID)
		require.NotEmptyf(t, inventory.PayloadOwner, "domain %q payload owner", domainID)
		require.Containsf(t, cachePolicies, inventory.CachePolicy, "domain %q cachePolicy", domainID)
		require.NotEmptyf(t, inventory.StreamSemantics, "domain %q streamSemantics", domainID)
		for _, semantic := range inventory.StreamSemantics {
			require.Containsf(t, streamSemantics, semantic, "domain %q stream semantic", domainID)
		}
		require.Containsf(t, coverageContracts, inventory.CoverageContract, "domain %q coverageContract", domainID)
		require.Equalf(t, "enforced", inventory.CoverageStatus, "domain %q coverageStatus", domainID)
		domains, ok := enforcedProofs[inventory.CoverageContract]
		require.Truef(t, ok, "enforced coverage contract %q has no proof registry", inventory.CoverageContract)
		require.Containsf(t, domains, domainID, "domain %q marked enforced without coverage proof", domainID)
	}
}

func TestDomainInventoryIsCompatibleWithExistingContractHomes(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	domainByID := make(map[string]refreshDomainRecord, len(contract.Domains))
	for _, domain := range contract.Domains {
		domainByID[domain.Domain] = domain
	}

	for domainID, inventory := range contract.DomainInventory {
		domain := domainByID[domainID]
		switch domain.Backend.ResourceStream {
		case true:
			require.Containsf(t, contract.ResourceStream.Domains, domainID, "resource-stream domain %q must join resourceStream.domains", domainID)
			require.Containsf(t, setOf("resource-stream-table", "complete-resync-stream"), inventory.BehaviorClass, "resource-stream domain %q behavior class", domainID)
			require.Equalf(t, "resource-stream-selector", inventory.ScopeContract.Kind, "resource-stream domain %q scope kind", domainID)
		case false:
			require.NotContainsf(t, contract.ResourceStream.Domains, domainID, "non-resource-stream domain %q must not join resourceStream.domains", domainID)
			require.NotContainsf(t, setOf("resource-stream-table", "complete-resync-stream"), inventory.BehaviorClass, "non-resource-stream domain %q behavior class", domainID)
		}

		switch domain.Backend.Registration {
		case "streamOnly":
			require.Equal(t, "log-stream", inventory.BehaviorClass)
			require.Equal(t, "stream-only", inventory.CachePolicy)
		case "direct", "list", "listWatch":
			require.NotEqualf(t, "stream-only", inventory.CachePolicy, "snapshot-capable domain %q must not use stream-only cache policy", domainID)
		default:
			require.Failf(t, "unknown registration", "domain=%s registration=%s", domainID, domain.Backend.Registration)
		}
	}

	catalog := contract.DomainInventory["catalog"]
	require.Equal(t, "catalog-stream", catalog.BehaviorClass)
	require.Equal(t, "catalog-query", catalog.ScopeContract.Kind)
	require.Equal(t, "backend/objectcatalog.Service", catalog.PayloadOwner)
	require.Equal(t, "external-catalog-cache", catalog.CachePolicy)
	require.ElementsMatch(t, []string{"snapshot-replace", "append-merge"}, catalog.StreamSemantics)
	require.Equal(t, "catalog-consistency", catalog.CoverageContract)

	catalogDiff := contract.DomainInventory["catalog-diff"]
	require.Equal(t, "catalog-snapshot", catalogDiff.BehaviorClass)
	require.Equal(t, "catalog-query", catalogDiff.ScopeContract.Kind)
	require.Equal(t, "backend/objectcatalog.Service", catalogDiff.PayloadOwner)
	require.Equal(t, "external-catalog-cache-with-merge", catalogDiff.CachePolicy)
	require.Equal(t, []string{"snapshot-replace"}, catalogDiff.StreamSemantics)
	require.Equal(t, "catalog-snapshot-query", catalogDiff.CoverageContract)

	for _, domainID := range []string{"cluster-events", "namespace-events"} {
		events := contract.DomainInventory[domainID]
		require.Equal(t, "event-stream", events.BehaviorClass)
		require.Equal(t, "event-stream-scope", events.ScopeContract.Kind)
		require.Equal(t, "backend/refresh/eventstream", events.PayloadOwner)
		require.Equal(t, "snapshot-cache", events.CachePolicy)
		require.Equal(t, []string{"append-merge"}, events.StreamSemantics)
		require.Equal(t, "event-resume-merge", events.CoverageContract)
	}

	objectEvents := contract.DomainInventory["object-events"]
	require.Equal(t, "event-snapshot", objectEvents.BehaviorClass)
	require.Equal(t, "object-ref", objectEvents.ScopeContract.Kind)
	require.Equal(t, "backend/refresh/snapshot.ObjectEventsBuilder", objectEvents.PayloadOwner)
	require.Equal(t, "snapshot-cache", objectEvents.CachePolicy)
	require.Equal(t, []string{"snapshot-replace"}, objectEvents.StreamSemantics)
	require.Equal(t, "event-snapshot-payload", objectEvents.CoverageContract)

	for _, domainID := range []string{"object-details", "object-yaml"} {
		detail := contract.DomainInventory[domainID]
		require.Equal(t, "detail-payload", detail.BehaviorClass)
		require.Equal(t, "object-ref", detail.ScopeContract.Kind)
		require.Equal(t, "snapshot-cache-plus-provider-cache", detail.CachePolicy)
		require.Equal(t, []string{"snapshot-replace"}, detail.StreamSemantics)
		require.Equal(t, "detail-payload-shape", detail.CoverageContract)
	}

	for _, domainID := range []string{"object-helm-manifest", "object-helm-values"} {
		helm := contract.DomainInventory[domainID]
		require.Equal(t, "helm-content-payload", helm.BehaviorClass)
		require.Equal(t, "helm-release", helm.ScopeContract.Kind)
		require.Equal(t, "snapshot-cache-plus-provider-cache", helm.CachePolicy)
		require.Equal(t, []string{"snapshot-replace"}, helm.StreamSemantics)
		require.Equal(t, "helm-content-shape", helm.CoverageContract)
	}

	objectMap := contract.DomainInventory["object-map"]
	require.Equal(t, "graph-payload", objectMap.BehaviorClass)
	require.Equal(t, "object-map", objectMap.ScopeContract.Kind)
	require.Equal(t, "backend/refresh/snapshot.ObjectMapBuilder", objectMap.PayloadOwner)
	require.Equal(t, "snapshot-cache", objectMap.CachePolicy)
	require.Equal(t, []string{"snapshot-replace"}, objectMap.StreamSemantics)
	require.Equal(t, "graph-payload-identity", objectMap.CoverageContract)

	objectMaintenance := contract.DomainInventory["object-maintenance"]
	require.Equal(t, "operation-state", objectMaintenance.BehaviorClass)
	require.Equal(t, "node-maintenance", objectMaintenance.ScopeContract.Kind)
	require.Equal(t, "backend/refresh/snapshot.NodeMaintenanceBuilder", objectMaintenance.PayloadOwner)
	require.Equal(t, "snapshot-cache-bypass", objectMaintenance.CachePolicy)
	require.Equal(t, []string{"snapshot-replace"}, objectMaintenance.StreamSemantics)
	require.Equal(t, "operation-state-transitions", objectMaintenance.CoverageContract)

	containerLogs := contract.DomainInventory["container-logs"]
	require.Equal(t, "log-stream", containerLogs.BehaviorClass)
	require.Equal(t, "log-stream-selector", containerLogs.ScopeContract.Kind)
	require.Equal(t, "backend/refresh/containerlogsstream", containerLogs.PayloadOwner)
	require.Equal(t, "stream-only", containerLogs.CachePolicy)
	require.Equal(t, []string{"line-stream"}, containerLogs.StreamSemantics)
	require.Equal(t, "log-stream-lifecycle", containerLogs.CoverageContract)
}

func TestSnapshotAndAggregateDomainRegistrationContracts(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	byDomain := make(map[string]domainRegistration, len(registrations))
	for _, registration := range registrations {
		byDomain[registration.name] = registration
	}

	namespaces := byDomain["namespaces"]
	require.NotNil(t, namespaces.direct, "namespaces must remain a direct snapshot registration")
	require.Nil(t, namespaces.list)
	require.Nil(t, namespaces.listWatch)

	overview := byDomain["cluster-overview"]
	require.Nil(t, overview.direct)
	require.Nil(t, overview.list)
	require.NotNil(t, overview.listWatch, "cluster-overview must keep listWatch registration with list fallback")
	require.Equal(t, []listWatchCheck{
		{group: "", resource: "nodes"},
		{group: "", resource: "pods"},
		{group: "", resource: "namespaces"},
	}, overview.listWatch.checks)
	require.Equal(t, []listCheck{
		{group: "", resource: "nodes"},
	}, overview.listWatch.fallbackChecks)
	require.NotNil(t, overview.listWatch.registerInformer)
	require.NotNil(t, overview.listWatch.registerFallback)
	require.Equal(t, "cluster overview requires nodes", overview.listWatch.deniedReason)
}

func TestResourceStreamDomainsAreRegisteredRefreshDomains(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	registered := make(map[string]struct{}, len(registrations))
	for _, registration := range registrations {
		registered[registration.name] = struct{}{}
	}

	for _, domainName := range resourcestream.SupportedDomains() {
		require.Contains(t, registered, domainName)
	}
}

func TestDomainPermissionContractsJoinExpectedRequirementSources(t *testing.T) {
	sources := permissionContractSources{
		runtime: domainpermissions.NewRuntimeAccess().Policies(),
		stream:  domainpermissions.StreamRequirementsByDomain(),
	}
	for _, domain := range loadRefreshDomainContract(t).Domains {
		requireDomainPermissionContract(t, domain, sources)
	}
}

func TestStreamOnlyDomainsHaveEndpointWiring(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	streamOnlyDomains := make([]string, 0)
	for _, domain := range contract.Domains {
		if domain.Backend.Registration == "streamOnly" {
			streamOnlyDomains = append(streamOnlyDomains, domain.Domain)
		}
	}
	require.NotEmpty(t, streamOnlyDomains)

	kubeClient := fake.NewClientset()
	runtimePerms := permissions.NewChecker(kubeClient, "cluster-a", 0)
	informerFactory := informer.New(kubeClient, nil, 0, runtimePerms)
	mux := http.NewServeMux()

	_, _, err := registerStreamHandlers(mux, streamDeps{
		informerFactory: informerFactory,
		snapshotService: streamHandlerSnapshotService{},
		cfg: Config{
			KubernetesClient: kubeClient,
			ClusterID:        "cluster-a",
			ClusterName:      "Cluster A",
		},
		telemetry:   telemetry.NewRecorder(),
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-a", ClusterName: "Cluster A"},
	})
	require.NoError(t, err)

	for _, domain := range streamOnlyDomains {
		switch domain {
		case "container-logs":
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v2/stream/container-logs?scope=", nil)
			mux.ServeHTTP(rec, req)

			require.NotEqual(t, http.StatusNotFound, rec.Code)
			require.Equal(t, http.StatusBadRequest, rec.Code)
		default:
			require.Failf(t, "missing stream-only endpoint assertion", "domain=%s", domain)
		}
	}
}

func TestResourceStreamDomainsMatchAuthoredContract(t *testing.T) {
	contractDomains := contractResourceStreamDomains(t)
	require.ElementsMatch(t, contractDomains, resourcestream.SupportedDomains())
}

func TestResourceStreamIdentityContractIsAuthored(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	identity := contract.ResourceStream.UpdateIdentity
	require.Equal(t, "ref", identity.RowUpdates)
	require.Equal(t, "ref", identity.RowDeletes)
	require.Empty(t, identity.LegacyFieldsDuringMigration, "legacy field migration window must be closed once all domains use Ref")
	require.Equal(t, "scope-level-resync", identity.CompleteSemantics)
	require.Equal(t, "diagnostic-only", identity.CompleteIdentity)
}

// TestResourceStreamDomainsMatchProjectionDescriptors locks the per-domain
// stream metadata in refresh-domain-contract.json to the in-code projection
// descriptors. Any drift between the two surfaces here so the frontend
// (which validates against the same JSON) can never see a domain whose
// metadata disagrees with the backend.
func TestResourceStreamDomainsMatchProjectionDescriptors(t *testing.T) {
	contract := loadRefreshDomainContract(t)
	descriptors := resourcestream.ProjectionDescriptors()

	require.Len(t, contract.ResourceStream.Domains, len(descriptors), "contract domain count must equal projection descriptor count")

	for domain, descriptor := range descriptors {
		entry, ok := contract.ResourceStream.Domains[domain]
		require.Truef(t, ok, "resourceStream.domains.%s missing from refresh-domain-contract.json", domain)
		require.Equalf(t, descriptor.ScopeKind, entry.ScopeKind, "domain %s scopeKind drift", domain)
		require.Equalf(t, descriptor.MetricsDependency, entry.MetricsDependency, "domain %s metricsDependency drift", domain)
		require.Equalf(t, descriptor.CompleteIsScopeLevel, entry.CompleteIsScopeLevel, "domain %s completeIsScopeLevel drift", domain)
		requireResourceSetEqual(t, domain, "primaryResources", descriptor.PrimaryResources, entry.PrimaryResources)
		requireResourceSetEqual(t, domain, "relatedResources", descriptor.RelatedResources, entry.RelatedResources)
	}
}

func requireResourceSetEqual(t *testing.T, domain, label string, code []resourcestream.ResourceDescriptor, contract []streamResourceRecord) {
	t.Helper()
	require.Lenf(t, contract, len(code), "domain %s %s length drift", domain, label)
	codeKeys := make(map[string]resourcestream.ResourceDescriptor, len(code))
	for _, r := range code {
		codeKeys[r.Group+"/"+r.Version+"/"+r.Kind+"/"+r.Resource] = r
	}
	for _, r := range contract {
		key := r.Group + "/" + r.Version + "/" + r.Kind + "/" + r.Resource
		require.Containsf(t, codeKeys, key, "domain %s %s entry %q not present in projection descriptor", domain, label, key)
	}
}

func TestDomainRegistrationRequiresDependencies(t *testing.T) {
	// Verify that dependency-gated registrations reject missing dependencies.
	missingDeps := domainRegistrations(registrationDeps{cfg: Config{}})

	custom := findRegistration(t, missingDeps, "namespace-custom")
	require.NotNil(t, custom.require)
	require.ErrorContains(t, custom.require(), "dynamic client must be provided for namespace custom resources")

	helm := findRegistration(t, missingDeps, "namespace-helm")
	require.NotNil(t, helm.require)
	require.ErrorContains(t, helm.require(), "helm factory must be provided for namespace helm domain")

	// Verify that dependency checks pass when the dependencies are provided.
	withDeps := domainRegistrations(registrationDeps{
		cfg: Config{
			DynamicClient: dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
			HelmFactory:   dummyHelmFactory,
		},
	})

	customWithDeps := findRegistration(t, withDeps, "namespace-custom")
	require.NoError(t, customWithDeps.require())

	helmWithDeps := findRegistration(t, withDeps, "namespace-helm")
	require.NoError(t, helmWithDeps.require())
}

func TestDomainRegistrationProviderAndServiceGatesAreExplicit(t *testing.T) {
	missing := domainRegistrations(registrationDeps{
		cfg: Config{
			ObjectDetailsProvider: noopObjectDetailProvider{},
		},
	})
	require.True(t, findRegistration(t, missing, "catalog").skipIf())
	require.True(t, findRegistration(t, missing, "catalog-diff").skipIf())
	require.True(t, findRegistration(t, missing, "object-yaml").skipIf())
	require.True(t, findRegistration(t, missing, "object-helm-manifest").skipIf())
	require.True(t, findRegistration(t, missing, "object-helm-values").skipIf())

	withProviders := domainRegistrations(registrationDeps{
		cfg: Config{
			ObjectCatalogService:  func() *objectcatalog.Service { return &objectcatalog.Service{} },
			ObjectDetailsProvider: fullObjectDetailProvider{},
		},
	})
	require.False(t, findRegistration(t, withProviders, "catalog").skipIf())
	require.False(t, findRegistration(t, withProviders, "catalog-diff").skipIf())
	require.False(t, findRegistration(t, withProviders, "object-yaml").skipIf())
	require.False(t, findRegistration(t, withProviders, "object-helm-manifest").skipIf())
	require.False(t, findRegistration(t, withProviders, "object-helm-values").skipIf())
}

func TestPartialDataRegistrationDeniedReasonsUseRuntimeContract(t *testing.T) {
	registrations := domainRegistrations(registrationDeps{cfg: Config{}})
	access := domainpermissions.NewRuntimeAccess()

	for _, registration := range registrations {
		if registration.list == nil || !registration.list.allowAny {
			continue
		}
		expected, ok := access.DeniedReason(registration.name)
		require.Truef(t, ok, "list-gated partial-data domain %s must have a runtime denied reason", registration.name)
		require.Equal(t, expected, registration.list.deniedReason)
	}
}

// findRegistration locates a registration entry by name.
func findRegistration(t *testing.T, registrations []domainRegistration, name string) domainRegistration {
	t.Helper()
	for _, registration := range registrations {
		if registration.name == name {
			return registration
		}
	}
	require.FailNowf(t, "registration not found", "name=%s", name)
	return domainRegistration{}
}

func requirementKeys(reqs []permissions.ResourceRequirement) map[string]struct{} {
	keys := make(map[string]struct{}, len(reqs))
	for _, req := range reqs {
		keys[permissions.ResourceKey(req.Group, req.Resource)] = struct{}{}
	}
	return keys
}

func requirementVerbKeys(reqs []permissions.ResourceRequirement) map[string]struct{} {
	keys := make(map[string]struct{}, len(reqs))
	for _, req := range reqs {
		keys[permissions.RequirementKey(req)] = struct{}{}
	}
	return keys
}

type permissionContractSources struct {
	runtime map[string]domainpermissions.Policy
	stream  map[string][]permissions.ResourceRequirement
}

func requireDomainPermissionContract(t *testing.T, domain refreshDomainRecord, sources permissionContractSources) {
	t.Helper()

	runtimeReq, hasRuntime := sources.runtime[domain.Domain]
	streamReqs, hasStream := sources.stream[domain.Domain]

	switch domain.Backend.Permission {
	case "runtime":
		require.Truef(t, hasRuntime, "domain %q must have a runtime permission policy", domain.Domain)
		if domain.Backend.ResourceStream {
			require.Truef(t, hasStream, "resource stream domain %q must declare stream permission requirements", domain.Domain)
			streamKeys := requirementKeys(streamReqs)
			streamVerbKeys := requirementVerbKeys(streamReqs)
			for _, req := range runtimeReq.Runtime {
				require.Containsf(
					t,
					streamKeys,
					permissions.ResourceKey(req.Group, req.Resource),
					"stream domain %q must include snapshot resource %s",
					domain.Domain,
					permissions.ResourceKey(req.Group, req.Resource),
				)
			}
			for _, req := range streamReqs {
				require.Containsf(
					t,
					streamVerbKeys,
					permissions.RequirementKey(permissions.ListRequirement(req.Group, req.Resource)),
					"stream domain %q must include list for %s",
					domain.Domain,
					permissions.ResourceKey(req.Group, req.Resource),
				)
				require.Containsf(
					t,
					streamVerbKeys,
					permissions.RequirementKey(permissions.WatchRequirement(req.Group, req.Resource)),
					"stream domain %q must include watch for %s",
					domain.Domain,
					permissions.ResourceKey(req.Group, req.Resource),
				)
			}
		}
	case "exempt":
		require.Falsef(t, hasRuntime, "domain %q is contract-exempt and should not have a broad runtime policy", domain.Domain)
		require.Falsef(t, hasStream, "domain %q is contract-exempt and should not have stream requirements", domain.Domain)
	case "stream-specific":
		require.Equal(t, "streamOnly", domain.Backend.Registration)
		require.Falsef(t, hasRuntime, "stream-specific domain %q should not use snapshot runtime permission checks", domain.Domain)
	default:
		require.Failf(t, "unknown permission contract", "domain=%s permission=%s", domain.Domain, domain.Backend.Permission)
	}
}

func enforcedCoverageProofs(t *testing.T) map[string]map[string]struct{} {
	t.Helper()
	contract := loadRefreshDomainContract(t)
	families := []struct {
		coverageContract string
		behaviorClasses  map[string]struct{}
	}{
		{"snapshot-table-payload", setOf("snapshot-table")},
		{"aggregate-snapshot-permission-fallback", setOf("aggregate-snapshot")},
		{"resource-stream-row-parity", setOf("resource-stream-table")},
		{"complete-resync-only", setOf("complete-resync-stream")},
		{"catalog-consistency", setOf("catalog-stream")},
		{"catalog-snapshot-query", setOf("catalog-snapshot")},
		{"event-resume-merge", setOf("event-stream")},
		{"event-snapshot-payload", setOf("event-snapshot")},
		{"log-stream-lifecycle", setOf("log-stream")},
		{"detail-payload-shape", setOf("detail-payload")},
		{"helm-content-shape", setOf("helm-content-payload")},
		{"graph-payload-identity", setOf("graph-payload")},
		{"operation-state-transitions", setOf("operation-state")},
	}

	proofs := make(map[string]map[string]struct{}, len(families))
	for _, family := range families {
		proofs[family.coverageContract] = map[string]struct{}{}
	}

	for domainID, inventory := range contract.DomainInventory {
		if inventory.CoverageStatus != "enforced" {
			continue
		}
		matched := false
		for _, family := range families {
			if _, ok := family.behaviorClasses[inventory.BehaviorClass]; !ok {
				continue
			}
			require.Equalf(t, family.coverageContract, inventory.CoverageContract, "domain %q coverage contract must match behavior class", domainID)
			proofs[family.coverageContract][domainID] = struct{}{}
			matched = true
			break
		}
		require.Truef(t, matched, "domain %q has no behavior-class coverage proof", domainID)
	}
	return proofs
}

func setOf(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func requireSourcePathExists(t *testing.T, owner string) {
	t.Helper()
	path, _, ok := strings.Cut(owner, ":")
	require.Truef(t, ok, "source owner %q must be formatted as path:symbol", owner)
	require.NotEmpty(t, path)
	_, filename, _, ok := goruntime.Caller(0)
	require.True(t, ok)
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", ".."))
	_, err := os.Stat(filepath.Join(repoRoot, path))
	require.NoErrorf(t, err, "source owner %q must reference an existing file", owner)
}

type fullObjectDetailProvider struct{}

type streamHandlerSnapshotService struct{}

func (streamHandlerSnapshotService) Build(context.Context, string, string) (*refresh.Snapshot, error) {
	return &refresh.Snapshot{}, nil
}

func (fullObjectDetailProvider) FetchObjectDetails(context.Context, schema.GroupVersionKind, string, string) (interface{}, string, error) {
	return nil, "", nil
}

func (fullObjectDetailProvider) FetchObjectYAML(context.Context, schema.GroupVersionKind, string, string) (string, error) {
	return "", nil
}

func (fullObjectDetailProvider) FetchHelmManifest(context.Context, string, string) (string, int, error) {
	return "", 0, nil
}

func (fullObjectDetailProvider) FetchHelmValues(context.Context, string, string) (map[string]interface{}, int, error) {
	return nil, 0, nil
}

func loadRefreshDomainContract(t *testing.T) refreshDomainContract {
	t.Helper()
	_, filename, _, ok := goruntime.Caller(0)
	require.True(t, ok)
	contractPath := filepath.Join(filepath.Dir(filename), "..", "domain", "refresh-domain-contract.json")
	data, err := os.ReadFile(contractPath)
	require.NoError(t, err)

	var contract refreshDomainContract
	require.NoError(t, json.Unmarshal(data, &contract))
	require.Equal(t, 2, contract.Version)
	require.NotEmpty(t, contract.Domains)
	return contract
}

func contractSnapshotDomains(t *testing.T) []string {
	t.Helper()
	contract := loadRefreshDomainContract(t)
	result := make([]string, 0, len(contract.Domains))
	for _, domain := range contract.Domains {
		if domain.Backend.Registration != "streamOnly" {
			result = append(result, domain.Domain)
		}
	}
	return result
}

func contractResourceStreamDomains(t *testing.T) []string {
	t.Helper()
	contract := loadRefreshDomainContract(t)
	result := make([]string, 0, len(contract.Domains))
	for _, domain := range contract.Domains {
		if domain.Backend.ResourceStream {
			result = append(result, domain.Domain)
		}
	}
	return result
}

func registrationKind(registration domainRegistration) string {
	switch {
	case registration.direct != nil:
		return "direct"
	case registration.list != nil:
		return "list"
	case registration.listWatch != nil:
		return "listWatch"
	default:
		return ""
	}
}
