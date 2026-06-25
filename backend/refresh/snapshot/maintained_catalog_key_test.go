package snapshot

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	admissionv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcekind"
	admission "github.com/luxury-yacht/app/backend/resources/admission"
	clusterrole "github.com/luxury-yacht/app/backend/resources/clusterrole"
	clusterrolebinding "github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	configmap "github.com/luxury-yacht/app/backend/resources/configmap"
	cronjob "github.com/luxury-yacht/app/backend/resources/cronjob"
	daemonset "github.com/luxury-yacht/app/backend/resources/daemonset"
	deployment "github.com/luxury-yacht/app/backend/resources/deployment"
	endpointslice "github.com/luxury-yacht/app/backend/resources/endpointslice"
	ingress "github.com/luxury-yacht/app/backend/resources/ingress"
	ingressclass "github.com/luxury-yacht/app/backend/resources/ingressclass"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	limitrange "github.com/luxury-yacht/app/backend/resources/limitrange"
	networkpolicy "github.com/luxury-yacht/app/backend/resources/networkpolicy"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
	pv "github.com/luxury-yacht/app/backend/resources/persistentvolume"
	pvc "github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	pdb "github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	resourcequota "github.com/luxury-yacht/app/backend/resources/resourcequota"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	rolebinding "github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	service "github.com/luxury-yacht/app/backend/resources/service"
	serviceaccount "github.com/luxury-yacht/app/backend/resources/serviceaccount"
	statefulset "github.com/luxury-yacht/app/backend/resources/statefulset"
	storageclass "github.com/luxury-yacht/app/backend/resources/storageclass"
)

// maintainedKeyCase pins one ingest-fed maintained-store kind: a representative object,
// the kind's canonical Identity, and the key derived from its Table-half row via the
// kind's real query adapter. keyFromCatalog applied to the kind's Catalog-half Summary
// (projected from the SAME object) MUST equal that adapter key — that equality is what
// lets the maintained store evict a row from the RETAINED Catalog half after the
// redundant stored Table half is dropped.
type maintainedKeyCase struct {
	name     string
	identity resourcekind.Identity
	obj      metav1.Object
	// tableKey returns adapter.Key(tableRow) for obj, projecting through the kind's
	// real StreamRow (descriptor kinds) or ingest ProjectFunc (bespoke kinds) and the
	// kind's real typed table query adapter.
	tableKey func(t *testing.T, meta ClusterMeta, obj metav1.Object) string
}

// descriptorTableKey builds the Table-half key for a descriptor-fed kind: it projects obj
// through the domain descriptor's StreamRow and runs the row through the kind's real table
// query adapter Key.
func descriptorTableKey[T any](
	t *testing.T,
	meta ClusterMeta,
	domain, resource string,
	obj metav1.Object,
	adapterKey func(T) string,
) string {
	t.Helper()
	desc := descriptorFor(t, domain, resource)
	row, ok := desc.StreamRow(meta, obj).(T)
	require.Truef(t, ok, "%s StreamRow returned %T", desc.Kind, desc.StreamRow(meta, obj))
	return adapterKey(row)
}

// projectorTableKey builds the Table-half key for a bespoke-projector kind: it runs the
// kind's ingest ProjectFunc, takes the Bundle's Table half, and runs it through the kind's
// real table query adapter Key.
func projectorTableKey[T any](
	t *testing.T,
	project ingest.ProjectFunc,
	obj metav1.Object,
	adapterKey func(T) string,
) string {
	t.Helper()
	raw, err := project(obj)
	require.NoError(t, err)
	bundle, ok := raw.(ingest.Bundle)
	require.Truef(t, ok, "projector returned %T, want ingest.Bundle", raw)
	row, ok := bundle.Table.(T)
	require.Truef(t, ok, "Table half is %T", bundle.Table)
	return adapterKey(row)
}

// TestKeyFromCatalogMatchesAdapterKeyForEveryMaintainedKind is the STEP 1 verification: for
// EVERY ingest-fed maintained-store kind it asserts a single generic keyFromCatalog(summary)
// EQUALS the kind's adapter.Key(tableRow) for the same object. If they all match, the
// maintained-store delete can switch from the (dropped) Table half to the retained Catalog
// half with ONE generic function. A mismatch names the kind and the two keys.
func TestKeyFromCatalogMatchesAdapterKeyForEveryMaintainedKind(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	ns := func(name string) metav1.ObjectMeta { return metav1.ObjectMeta{Namespace: "ns1", Name: name} }
	cl := func(name string) metav1.ObjectMeta { return metav1.ObjectMeta{Name: name} }

	cases := []maintainedKeyCase{
		// --- namespaced descriptor kinds ---
		{"ConfigMap", configmap.Identity, &corev1.ConfigMap{ObjectMeta: ns("cm1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceConfigDomainName, "configmaps", obj, configTableQueryAdapter().Key)
			}},
		{"Secret", secretpkg.Identity, &corev1.Secret{ObjectMeta: ns("s1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceConfigDomainName, "secrets", obj, configTableQueryAdapter().Key)
			}},
		{"ResourceQuota", resourcequota.Identity, &corev1.ResourceQuota{ObjectMeta: ns("rq1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceQuotasDomainName, "resourcequotas", obj, quotaTableQueryAdapter().Key)
			}},
		{"LimitRange", limitrange.Identity, &corev1.LimitRange{ObjectMeta: ns("lr1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceQuotasDomainName, "limitranges", obj, quotaTableQueryAdapter().Key)
			}},
		{"PersistentVolumeClaim", pvc.Identity, &corev1.PersistentVolumeClaim{ObjectMeta: ns("pvc1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceStorageDomainName, "persistentvolumeclaims", obj, storageTableQueryAdapter().Key)
			}},
		{"Role", rolepkg.Identity, &rbacv1.Role{ObjectMeta: ns("role1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceRBACDomainName, "roles", obj, rbacTableQueryAdapter().Key)
			}},
		{"RoleBinding", rolebinding.Identity, &rbacv1.RoleBinding{ObjectMeta: ns("rb1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceRBACDomainName, "rolebindings", obj, rbacTableQueryAdapter().Key)
			}},
		{"ServiceAccount", serviceaccount.Identity, &corev1.ServiceAccount{ObjectMeta: ns("sa1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceRBACDomainName, "serviceaccounts", obj, rbacTableQueryAdapter().Key)
			}},
		{"Ingress", ingress.Identity, &networkingv1.Ingress{ObjectMeta: ns("ing1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceNetworkDomainName, "ingresses", obj, networkTableQueryAdapter().Key)
			}},
		{"NetworkPolicy", networkpolicy.Identity, &networkingv1.NetworkPolicy{ObjectMeta: ns("np1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceNetworkDomainName, "networkpolicies", obj, networkTableQueryAdapter().Key)
			}},
		{"PodDisruptionBudget", pdb.Identity, &policyv1.PodDisruptionBudget{ObjectMeta: ns("pdb1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, namespaceQuotasDomainName, "poddisruptionbudgets", obj, quotaTableQueryAdapter().Key)
			}},

		// --- cluster-scoped descriptor kinds ---
		{"StorageClass", storageclass.Identity, &storagev1.StorageClass{ObjectMeta: cl("standard")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterConfigDomainName, "storageclasses", obj, clusterConfigTableQueryAdapter().Key)
			}},
		{"IngressClass", ingressclass.Identity, &networkingv1.IngressClass{ObjectMeta: cl("nginx")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterConfigDomainName, "ingressclasses", obj, clusterConfigTableQueryAdapter().Key)
			}},
		{"ValidatingWebhookConfiguration", admission.ValidatingIdentity, &admissionv1.ValidatingWebhookConfiguration{ObjectMeta: cl("vwh1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterConfigDomainName, "validatingwebhookconfigurations", obj, clusterConfigTableQueryAdapter().Key)
			}},
		{"MutatingWebhookConfiguration", admission.MutatingIdentity, &admissionv1.MutatingWebhookConfiguration{ObjectMeta: cl("mwh1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterConfigDomainName, "mutatingwebhookconfigurations", obj, clusterConfigTableQueryAdapter().Key)
			}},
		{"PersistentVolume", pv.Identity, &corev1.PersistentVolume{ObjectMeta: cl("pv1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterStorageDomainName, "persistentvolumes", obj, clusterStorageTableQueryAdapter().Key)
			}},
		{"ClusterRole", clusterrole.Identity, &rbacv1.ClusterRole{ObjectMeta: cl("cr1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterRBACDomainName, "clusterroles", obj, clusterRBACTableQueryAdapter().Key)
			}},
		{"ClusterRoleBinding", clusterrolebinding.Identity, &rbacv1.ClusterRoleBinding{ObjectMeta: cl("crb1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return descriptorTableKey(t, meta, clusterRBACDomainName, "clusterrolebindings", obj, clusterRBACTableQueryAdapter().Key)
			}},

		// --- bespoke-projector kinds (workloads, nodes, network service/endpointslice) ---
		{"Deployment", deployment.Identity, &appsv1.Deployment{ObjectMeta: ns("dep1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewDeploymentIngestProjector(meta), obj, workloadTableQueryAdapter().Key)
			}},
		{"StatefulSet", statefulset.Identity, &appsv1.StatefulSet{ObjectMeta: ns("sts1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewStatefulSetIngestProjector(meta), obj, workloadTableQueryAdapter().Key)
			}},
		{"DaemonSet", daemonset.Identity, &appsv1.DaemonSet{ObjectMeta: ns("ds1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewDaemonSetIngestProjector(meta), obj, workloadTableQueryAdapter().Key)
			}},
		{"Job", jobres.Identity, &batchv1.Job{ObjectMeta: ns("job1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewJobIngestProjector(meta), obj, workloadTableQueryAdapter().Key)
			}},
		{"CronJob", cronjob.Identity, &batchv1.CronJob{ObjectMeta: ns("cj1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewCronJobIngestProjector(meta), obj, workloadTableQueryAdapter().Key)
			}},
		{"Node", nodespkg.Identity, &corev1.Node{ObjectMeta: cl("node-1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewNodeIngestProjector(meta), obj, nodeTableQueryAdapter().Key)
			}},
		{"Service", service.Identity, &corev1.Service{ObjectMeta: ns("svc1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewServiceIngestProjector(meta), obj, networkTableQueryAdapter().Key)
			}},
		{"EndpointSlice", endpointslice.Identity, &discoveryv1.EndpointSlice{ObjectMeta: ns("eps1")},
			func(t *testing.T, meta ClusterMeta, obj metav1.Object) string {
				return projectorTableKey(t, NewEndpointSliceIngestProjector(meta), obj, networkTableQueryAdapter().Key)
			}},
	}

	// Guard: the case table must cover EVERY ingest-fed maintained-store kind. Pods is the
	// one ingest-owned kind that is NOT a maintained-store kind (it serves direct) and keeps
	// its Table half, so it is intentionally excluded.
	covered := map[string]bool{}
	for _, tc := range cases {
		covered[tc.name] = true
	}
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		if d.Identity.Kind == "Pod" {
			continue
		}
		require.Truef(t, covered[d.Identity.Kind],
			"ingest-owned kind %q is not covered by the key-equality test", d.Identity.Kind)
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, tc.identity)
			summary, ok := catalogProject(tc.obj).(objectcatalog.Summary)
			require.Truef(t, ok, "%s catalog projector returned %T", tc.name, catalogProject(tc.obj))

			tableKey := tc.tableKey(t, meta, tc.obj)
			catKey := keyFromCatalog(summary)
			require.Equalf(t, tableKey, catKey,
				"%s: keyFromCatalog(%q) must equal adapter.Key(tableRow)=%q", tc.name, catKey, tableKey)
		})
	}
}

// descriptorFor resolves a domain's stream descriptor by resource name for the key test.
func descriptorFor(t *testing.T, domain, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(domain) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no %s descriptor for resource %q", domain, resource)
	return streamspec.Descriptor{}
}

// scClusterConfigProjection projects a StorageClass into the SAME Bundle the production
// ingest path builds for a cluster-config kind: Table = the descriptor StreamRow, Catalog =
// the SummaryProjector. It is the ProjectFunc a real ingest reflector runs at intake.
func scClusterConfigProjection(t *testing.T, meta ClusterMeta) ingest.ProjectFunc {
	t.Helper()
	desc := descriptorFor(t, clusterConfigDomainName, "storageclasses")
	catalog := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, storageclass.Identity)
	return func(obj interface{}) (interface{}, error) {
		m, ok := obj.(metav1.Object)
		if !ok {
			return nil, fmt.Errorf("scClusterConfigProjection: unexpected type %T", obj)
		}
		return ingest.Bundle{Table: desc.StreamRow(meta, m), Catalog: catalog(m)}, nil
	}
}

// TestMaintainedStoreNoGhostOnDeleteWithTableHalfDropped is the end-to-end project-to-column
// proof for a NON-pod kind: a real ProjectingStore (default drop-table) feeds a maintained
// store through the production AddBundleSink path; after ingesting a StorageClass the store's
// stored bundle has Table==nil (dropped) but the maintained store serves the row, and after
// an incremental Delete AND a relist Replace-delete the maintained store evicts it with NO
// ghost — the eviction key comes from the RETAINED Catalog half.
func TestMaintainedStoreNoGhostOnDeleteWithTableHalfDropped(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	maintained := newTypedMaintainedStore(meta, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())

	src := ingest.NewProjectingStore(scClusterConfigProjection(t, meta))
	src.AddBundleSink(maintained.BundleSink()) // the production wiring

	sc := storageClassObj("standard", "1", "ebs.csi.aws.com")

	// --- incremental Add → Delete ---
	require.NoError(t, src.Add(sc))
	require.NotNil(t, findClusterConfigRow(maintained.rows("", clusterConfigAvailableAll()), "StorageClass", "standard"),
		"maintained store must serve the row after the ingest Add fanned the Table half")

	// The stored bundle dropped the redundant Table half but kept the Catalog half.
	stored, exists, err := src.GetByKey("standard")
	require.NoError(t, err)
	require.True(t, exists)
	b, ok := stored.(ingest.Bundle)
	require.True(t, ok)
	require.Nil(t, b.Table, "the redundant Table half must be dropped from the stored bundle")
	_, hasCatalog := b.Catalog.(objectcatalog.Summary)
	require.True(t, hasCatalog, "the Catalog half must be retained for the catalog-keyed delete")

	require.NoError(t, src.Delete(sc))
	require.Nil(t, findClusterConfigRow(maintained.rows("", clusterConfigAvailableAll()), "StorageClass", "standard"),
		"incremental Delete must evict the row via the Catalog half — no ghost")

	// --- relist Replace-delete (the reflector's relist path) ---
	other := storageClassObj("fast", "2", "pd.csi.gke.io")
	require.NoError(t, src.Replace([]interface{}{sc, other}, "10"))
	require.NotNil(t, findClusterConfigRow(maintained.rows("", clusterConfigAvailableAll()), "StorageClass", "standard"),
		"relist must repopulate the row")
	// A relist that drops "standard" must evict it from the maintained store via the Catalog half.
	require.NoError(t, src.Replace([]interface{}{other}, "11"))
	require.Nil(t, findClusterConfigRow(maintained.rows("", clusterConfigAvailableAll()), "StorageClass", "standard"),
		"relist Replace-delete must evict the vanished row via the Catalog half — no ghost")
	require.NotNil(t, findClusterConfigRow(maintained.rows("", clusterConfigAvailableAll()), "StorageClass", "fast"),
		"the kept row must remain after the relist")
}
