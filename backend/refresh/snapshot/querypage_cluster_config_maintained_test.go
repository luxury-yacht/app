package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	admissionv1 "k8s.io/api/admissionregistration/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

func storageClassObj(name, rv, provisioner string) *storagev1.StorageClass {
	return &storagev1.StorageClass{
		ObjectMeta:  metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Provisioner: provisioner,
	}
}

func ingressClassObj(name, rv, controller string) *networkingv1.IngressClass {
	return &networkingv1.IngressClass{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Spec:       networkingv1.IngressClassSpec{Controller: controller},
	}
}

func gatewayClassObj(name, rv, controller string) *gatewayv1.GatewayClass {
	return &gatewayv1.GatewayClass{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Spec:       gatewayv1.GatewayClassSpec{ControllerName: gatewayv1.GatewayController(controller)},
	}
}

func validatingWebhookObj(name, rv string, hooks int) *admissionv1.ValidatingWebhookConfiguration {
	webhooks := make([]admissionv1.ValidatingWebhook, hooks)
	for i := range webhooks {
		webhooks[i] = admissionv1.ValidatingWebhook{Name: name + "-hook"}
	}
	return &admissionv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Webhooks:   webhooks,
	}
}

func mutatingWebhookObj(name, rv string, hooks int) *admissionv1.MutatingWebhookConfiguration {
	webhooks := make([]admissionv1.MutatingWebhook, hooks)
	for i := range webhooks {
		webhooks[i] = admissionv1.MutatingWebhook{Name: name + "-hook"}
	}
	return &admissionv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv},
		Webhooks:   webhooks,
	}
}

func findClusterConfigRow(rows []ClusterConfigEntry, kind, name string) *ClusterConfigEntry {
	for i := range rows {
		if rows[i].Kind == kind && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

func clusterConfigDescriptor(t *testing.T, resource string) streamspec.Descriptor {
	t.Helper()
	for _, d := range kindregistry.StreamDescriptorsForDomain(clusterConfigDomainName) {
		if d.Resource == resource {
			return d
		}
	}
	t.Fatalf("no cluster-config descriptor for resource %q", resource)
	return streamspec.Descriptor{}
}

// clusterConfigAvailableAll reports every cluster-config kind as available, mirroring
// a request with no per-kind permission gating (so the store and list path agree).
func clusterConfigAvailableAll() map[string]bool {
	available := map[string]bool{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(clusterConfigDomainName) {
		available[d.Kind] = true
	}
	return available
}

// TestClusterConfigMaintainedStoreIngestion proves the informer-fed store reflects
// Add/Update/Delete (incl. tombstone), tracks the max resourceVersion, and projects
// rows identically to a direct BuildStreamSummary. The domain is cluster-scoped, so
// objects carry no namespace and the store is queried for all rows (""). It feeds a
// GatewayClass via its descriptor too, exercising the Gateway-API projection path.
func TestClusterConfigMaintainedStoreIngestion(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	scDesc := clusterConfigDescriptor(t, "storageclasses")
	gcDesc := clusterConfigDescriptor(t, "gatewayclasses")
	store := newTypedMaintainedStore(meta, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())
	available := clusterConfigAvailableAll()

	store.ingest(scDesc, storageClassObj("sc-a", "10", "ebs.csi.aws.com"))
	store.ingest(scDesc, storageClassObj("sc-b", "12", "pd.csi.gke.io"))
	store.ingest(gcDesc, gatewayClassObj("gc-a", "8", "example.com/controller"))

	require.Equal(t, uint64(12), store.snapshotVersion(), "version tracks max resourceVersion")
	require.Len(t, store.rows("", available), 3)

	want := storageclass.BuildStreamSummary(meta, storageClassObj("sc-a", "10", "ebs.csi.aws.com"))
	got := findClusterConfigRow(store.rows("", available), "StorageClass", "sc-a")
	require.NotNil(t, got, "sc-a present")
	require.Equal(t, want, *got, "projection matches BuildStreamSummary")

	// The GatewayClass row proves the Gateway-API descriptor projected through the store.
	gc := findClusterConfigRow(store.rows("", available), "GatewayClass", "gc-a")
	require.NotNil(t, gc, "gc-a present")
	require.Equal(t, "example.com/controller", gc.Details)

	// Update sc-a in place: new resourceVersion, no duplicate.
	store.ingest(scDesc, storageClassObj("sc-a", "20", "ebs.csi.aws.com"))
	require.Equal(t, uint64(20), store.snapshotVersion())
	require.Len(t, store.rows("", available), 3, "in-place update, no duplicate")

	// Delete sc-b directly; delete gc-a via a tombstone.
	store.evict(scDesc, storageClassObj("sc-b", "21", "pd.csi.gke.io"))
	store.evict(gcDesc, cache.DeletedFinalStateUnknown{Key: "gc-a", Obj: gatewayClassObj("gc-a", "22", "example.com/controller")})
	require.Nil(t, findClusterConfigRow(store.rows("", available), "StorageClass", "sc-b"))
	require.Nil(t, findClusterConfigRow(store.rows("", available), "GatewayClass", "gc-a"))
	require.Len(t, store.rows("", available), 1, "only sc-a remains")
}

// TestClusterConfigMaintainedStoreMatchesListPath is the SAFETY GATE for the live
// cutover: fed the same objects (including a GatewayClass via the Gateway-API
// descriptor), the maintained store's rows must equal exactly what the current list
// path produces, for the cluster scope.
func TestClusterConfigMaintainedStoreMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	scDesc := clusterConfigDescriptor(t, "storageclasses")
	icDesc := clusterConfigDescriptor(t, "ingressclasses")
	gcDesc := clusterConfigDescriptor(t, "gatewayclasses")
	vwhDesc := clusterConfigDescriptor(t, "validatingwebhookconfigurations")
	mwhDesc := clusterConfigDescriptor(t, "mutatingwebhookconfigurations")

	scs := []*storagev1.StorageClass{
		storageClassObj("standard", "1", "ebs.csi.aws.com"),
		storageClassObj("fast", "2", "pd.csi.gke.io"),
	}
	ics := []*networkingv1.IngressClass{
		ingressClassObj("public", "3", "nginx.org/ingress-controller"),
	}
	gcs := []*gatewayv1.GatewayClass{
		gatewayClassObj("istio", "4", "istio.io/gateway-controller"),
	}
	vwhs := []*admissionv1.ValidatingWebhookConfiguration{
		validatingWebhookObj("validate-widgets", "5", 1),
	}
	mwhs := []*admissionv1.MutatingWebhookConfiguration{
		mutatingWebhookObj("mutate-widgets", "6", 2),
	}

	scIdx := newNamespaceIndexer()
	icIdx := newNamespaceIndexer()
	gcIdx := newNamespaceIndexer()
	vwhIdx := newNamespaceIndexer()
	mwhIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())
	for _, sc := range scs {
		require.NoError(t, scIdx.Add(sc))
		store.ingest(scDesc, sc)
	}
	for _, ic := range ics {
		require.NoError(t, icIdx.Add(ic))
		store.ingest(icDesc, ic)
	}
	for _, gc := range gcs {
		require.NoError(t, gcIdx.Add(gc))
		store.ingest(gcDesc, gc)
	}
	for _, vwh := range vwhs {
		require.NoError(t, vwhIdx.Add(vwh))
		store.ingest(vwhDesc, vwh)
	}
	for _, mwh := range mwhs {
		require.NoError(t, mwhIdx.Add(mwh))
		store.ingest(mwhDesc, mwh)
	}

	collect := clusterConfigCollectIndexer(scIdx, icIdx, gcIdx, vwhIdx, mwhIdx)
	listed, _, _, err := collectDescriptorTableRows[ClusterConfigEntry](
		context.Background(), clusterConfigDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", clusterConfigAvailableAll()),
		"maintained store rows must equal the list path for the cluster scope")
}

// TestClusterConfigMaintainedStoreSinkMatchesListPath is the SAFETY GATE for the
// live ingest cutover of the MIXED cluster-config domain: StorageClass, IngressClass,
// and the admission webhook kinds are IngestOwned and fed through the ingest Sink
// (the bundle's Table half); GatewayClass is NOT cut and is fed through the informer
// path (ingest()). The combined store's rows must still equal the list path exactly.
func TestClusterConfigMaintainedStoreSinkMatchesListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	scDesc := clusterConfigDescriptor(t, "storageclasses")
	icDesc := clusterConfigDescriptor(t, "ingressclasses")
	gcDesc := clusterConfigDescriptor(t, "gatewayclasses")
	vwhDesc := clusterConfigDescriptor(t, "validatingwebhookconfigurations")
	mwhDesc := clusterConfigDescriptor(t, "mutatingwebhookconfigurations")

	scs := []*storagev1.StorageClass{
		storageClassObj("standard", "1", "ebs.csi.aws.com"),
		storageClassObj("fast", "2", "pd.csi.gke.io"),
	}
	ics := []*networkingv1.IngressClass{
		ingressClassObj("public", "3", "nginx.org/ingress-controller"),
	}
	gcs := []*gatewayv1.GatewayClass{
		gatewayClassObj("istio", "4", "istio.io/gateway-controller"),
	}
	vwhs := []*admissionv1.ValidatingWebhookConfiguration{
		validatingWebhookObj("validate-widgets", "5", 1),
	}
	mwhs := []*admissionv1.MutatingWebhookConfiguration{
		mutatingWebhookObj("mutate-widgets", "6", 2),
	}

	scIdx := newNamespaceIndexer()
	icIdx := newNamespaceIndexer()
	gcIdx := newNamespaceIndexer()
	vwhIdx := newNamespaceIndexer()
	mwhIdx := newNamespaceIndexer()
	store := newTypedMaintainedStore(meta, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())
	sink := store.Sink()
	// Cut kinds feed through the ingest Sink (the projected Table-half row).
	for _, sc := range scs {
		require.NoError(t, scIdx.Add(sc))
		sink.Upsert(scDesc.StreamRow(meta, sc))
	}
	for _, ic := range ics {
		require.NoError(t, icIdx.Add(ic))
		sink.Upsert(icDesc.StreamRow(meta, ic))
	}
	for _, vwh := range vwhs {
		require.NoError(t, vwhIdx.Add(vwh))
		sink.Upsert(vwhDesc.StreamRow(meta, vwh))
	}
	for _, mwh := range mwhs {
		require.NoError(t, mwhIdx.Add(mwh))
		sink.Upsert(mwhDesc.StreamRow(meta, mwh))
	}
	// GatewayClass is NOT cut: it still arrives via the shared/Gateway informer handler.
	for _, gc := range gcs {
		require.NoError(t, gcIdx.Add(gc))
		store.ingest(gcDesc, gc)
	}

	collect := clusterConfigCollectIndexer(scIdx, icIdx, gcIdx, vwhIdx, mwhIdx)
	listed, _, _, err := collectDescriptorTableRows[ClusterConfigEntry](
		context.Background(), clusterConfigDomainName, collect, meta, "",
	)
	require.NoError(t, err)
	require.ElementsMatch(t, listed, store.rows("", clusterConfigAvailableAll()),
		"sink-fed (cut) + informer-fed (GatewayClass) store rows must equal the list path")

	// A delete through the sink evicts a cut kind's row, exactly like a watch delete.
	sink.Delete(scDesc.StreamRow(meta, scs[0]))
	require.Nil(t, findClusterConfigRow(store.rows("", clusterConfigAvailableAll()), "StorageClass", "standard"))
	require.Greater(t, store.snapshotVersion(), uint64(0), "sink mutations advance the snapshot version")
}

// TestClusterConfigBuilderMaintainedMatchesListPath is the end-to-end cutover proof:
// fed the same objects (including a GatewayClass via the Gateway-API descriptor), a
// builder serving from the maintained store produces a byte-identical snapshot
// payload to the list-path builder, across window, query, filter, and search scopes.
func TestClusterConfigBuilderMaintainedMatchesListPath(t *testing.T) {
	scDesc := clusterConfigDescriptor(t, "storageclasses")
	icDesc := clusterConfigDescriptor(t, "ingressclasses")
	gcDesc := clusterConfigDescriptor(t, "gatewayclasses")
	vwhDesc := clusterConfigDescriptor(t, "validatingwebhookconfigurations")
	mwhDesc := clusterConfigDescriptor(t, "mutatingwebhookconfigurations")

	scs := []*storagev1.StorageClass{
		storageClassObj("standard", "1", "ebs.csi.aws.com"),
		storageClassObj("fast", "2", "pd.csi.gke.io"),
	}
	ics := []*networkingv1.IngressClass{
		ingressClassObj("public", "3", "nginx.org/ingress-controller"),
	}
	gcs := []*gatewayv1.GatewayClass{
		gatewayClassObj("istio", "4", "istio.io/gateway-controller"),
	}
	vwhs := []*admissionv1.ValidatingWebhookConfiguration{
		validatingWebhookObj("validate-widgets", "5", 1),
	}
	mwhs := []*admissionv1.MutatingWebhookConfiguration{
		mutatingWebhookObj("mutate-widgets", "6", 2),
	}

	scIdx := newNamespaceIndexer()
	icIdx := newNamespaceIndexer()
	gcIdx := newNamespaceIndexer()
	vwhIdx := newNamespaceIndexer()
	mwhIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(ClusterMeta{}, clusterConfigQuerypageSchema(), clusterConfigTableQueryAdapter())
	for _, sc := range scs {
		require.NoError(t, scIdx.Add(sc))
		maintained.ingest(scDesc, sc)
	}
	for _, ic := range ics {
		require.NoError(t, icIdx.Add(ic))
		maintained.ingest(icDesc, ic)
	}
	for _, gc := range gcs {
		require.NoError(t, gcIdx.Add(gc))
		maintained.ingest(gcDesc, gc)
	}
	for _, vwh := range vwhs {
		require.NoError(t, vwhIdx.Add(vwh))
		maintained.ingest(vwhDesc, vwh)
	}
	for _, mwh := range mwhs {
		require.NoError(t, mwhIdx.Add(mwh))
		maintained.ingest(mwhDesc, mwh)
	}

	collect := clusterConfigCollectIndexer(scIdx, icIdx, gcIdx, vwhIdx, mwhIdx)
	listBuilder := &ClusterConfigBuilder{collectIndexer: collect}
	maintainedBuilder := &ClusterConfigBuilder{collectIndexer: collect, maintained: maintained}

	scopes := []string{
		"",
		"cluster-a|?limit=2&sortField=name&sortDirection=asc",
		"cluster-a|?limit=50&kinds=GatewayClass",
		"cluster-a|?search=istio",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(ClusterConfigSnapshot),
			maintSnap.Payload.(ClusterConfigSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
