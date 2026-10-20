package system

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	apiextv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextgroup "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions/apiextensions"
	apiextv1informers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/informers"
	autoscalinggroup "k8s.io/client-go/informers/autoscaling"
	autoscalingv1informers "k8s.io/client-go/informers/autoscaling/v1"
	"k8s.io/client-go/kubernetes/fake"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
	gatewayapis "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions/apis"
	gatewayv1informers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions/apis/v1"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// gatewayGV is the Gateway API v1 group version in apimachinery's type.
var gatewayGV = schema.GroupVersion{Group: gatewayv1.GroupVersion.Group, Version: gatewayv1.GroupVersion.Version}

// handlerHold holds back the listeners of the informer handlers registered
// through a gated factory. client-go runs each handler on its own goroutine,
// so a slow listener is a schedule production allows; the hold only makes it
// deterministic.
type handlerHold struct {
	registrations atomic.Int32
	mu            sync.Mutex
	held          bool
	release       chan struct{}
	applied       chan struct{}
}

func newHandlerHold() *handlerHold {
	return &handlerHold{applied: make(chan struct{}, 64)}
}

func (h *handlerHold) hold() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.held = true
	h.release = make(chan struct{})
}

func (h *handlerHold) releaseHeld() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.held {
		close(h.release)
		h.held = false
	}
}

func (h *handlerHold) wait() {
	h.mu.Lock()
	held, release := h.held, h.release
	h.mu.Unlock()
	if held {
		<-release
	}
}

func (h *handlerHold) done() {
	select {
	case h.applied <- struct{}{}:
	default:
	}
}

func (h *handlerHold) informer(inner cache.SharedIndexInformer) cache.SharedIndexInformer {
	return heldInformer{SharedIndexInformer: inner, hold: h}
}

type heldInformer struct {
	cache.SharedIndexInformer
	hold *handlerHold
}

func (i heldInformer) AddEventHandler(handler cache.ResourceEventHandler) (cache.ResourceEventHandlerRegistration, error) {
	i.hold.registrations.Add(1)
	h := i.hold
	return i.SharedIndexInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { h.wait(); handler.OnAdd(obj, false); h.done() },
		UpdateFunc: func(oldObj, newObj interface{}) { h.wait(); handler.OnUpdate(oldObj, newObj); h.done() },
		DeleteFunc: func(obj interface{}) { h.wait(); handler.OnDelete(obj); h.done() },
	})
}

// Gated factory views: each passes through except the one informer a store's
// registration reaches, whose handlers the hold controls.
type heldGatewayFactory struct {
	gatewayinformers.SharedInformerFactory
	hold *handlerHold
}

func (f heldGatewayFactory) Gateway() gatewayapis.Interface {
	return heldGatewayGroup{Interface: f.SharedInformerFactory.Gateway(), hold: f.hold}
}

type heldGatewayGroup struct {
	gatewayapis.Interface
	hold *handlerHold
}

func (g heldGatewayGroup) V1() gatewayv1informers.Interface {
	return heldGatewayV1{Interface: g.Interface.V1(), hold: g.hold}
}

type heldGatewayV1 struct {
	gatewayv1informers.Interface
	hold *handlerHold
}

func (v heldGatewayV1) HTTPRoutes() gatewayv1informers.HTTPRouteInformer {
	return heldHTTPRoutes{HTTPRouteInformer: v.Interface.HTTPRoutes(), hold: v.hold}
}

func (v heldGatewayV1) GatewayClasses() gatewayv1informers.GatewayClassInformer {
	return heldGatewayClasses{GatewayClassInformer: v.Interface.GatewayClasses(), hold: v.hold}
}

type heldHTTPRoutes struct {
	gatewayv1informers.HTTPRouteInformer
	hold *handlerHold
}

func (r heldHTTPRoutes) Informer() cache.SharedIndexInformer {
	return r.hold.informer(r.HTTPRouteInformer.Informer())
}

type heldGatewayClasses struct {
	gatewayv1informers.GatewayClassInformer
	hold *handlerHold
}

func (r heldGatewayClasses) Informer() cache.SharedIndexInformer {
	return r.hold.informer(r.GatewayClassInformer.Informer())
}

type heldSharedFactory struct {
	informers.SharedInformerFactory
	hold *handlerHold
}

func (f heldSharedFactory) Autoscaling() autoscalinggroup.Interface {
	return heldAutoscaling{Interface: f.SharedInformerFactory.Autoscaling(), hold: f.hold}
}

type heldAutoscaling struct {
	autoscalinggroup.Interface
	hold *handlerHold
}

func (a heldAutoscaling) V1() autoscalingv1informers.Interface {
	return heldAutoscalingV1{Interface: a.Interface.V1(), hold: a.hold}
}

type heldAutoscalingV1 struct {
	autoscalingv1informers.Interface
	hold *handlerHold
}

func (v heldAutoscalingV1) HorizontalPodAutoscalers() autoscalingv1informers.TypedHorizontalPodAutoscalerInformer {
	return heldHPAs{TypedHorizontalPodAutoscalerInformer: v.Interface.HorizontalPodAutoscalers(), hold: v.hold}
}

type heldHPAs struct {
	autoscalingv1informers.TypedHorizontalPodAutoscalerInformer
	hold *handlerHold
}

func (i heldHPAs) Informer() cache.SharedIndexInformer {
	return i.hold.informer(i.TypedHorizontalPodAutoscalerInformer.Informer())
}

type heldAPIExtensionsFactory struct {
	apiextinformers.SharedInformerFactory
	hold *handlerHold
}

func (f heldAPIExtensionsFactory) Apiextensions() apiextgroup.Interface {
	return heldAPIExtensions{Interface: f.SharedInformerFactory.Apiextensions(), hold: f.hold}
}

type heldAPIExtensions struct {
	apiextgroup.Interface
	hold *handlerHold
}

func (a heldAPIExtensions) V1() apiextv1informers.Interface {
	return heldAPIExtensionsV1{Interface: a.Interface.V1(), hold: a.hold}
}

type heldAPIExtensionsV1 struct {
	apiextv1informers.Interface
	hold *handlerHold
}

func (v heldAPIExtensionsV1) CustomResourceDefinitions() apiextv1informers.TypedCustomResourceDefinitionInformer {
	return heldCRDs{TypedCustomResourceDefinitionInformer: v.Interface.CustomResourceDefinitions(), hold: v.hold}
}

type heldCRDs struct {
	apiextv1informers.TypedCustomResourceDefinitionInformer
	hold *handlerHold
}

func (i heldCRDs) Informer() cache.SharedIndexInformer {
	return i.hold.informer(i.TypedCustomResourceDefinitionInformer.Informer())
}

type heldHelmStorage struct {
	source *informer.HelmStorageSource
	hold   *handlerHold
}

func (h heldHelmStorage) SecretLister() corelisters.SecretLister { return h.source.SecretLister() }
func (h heldHelmStorage) SecretsHasSynced() cache.InformerSynced { return h.source.SecretsHasSynced() }
func (h heldHelmStorage) SecretInformer() cache.SharedIndexInformer {
	return h.hold.informer(h.source.SecretInformer())
}

type gatewayClassAndRoutePresence struct{}

func (gatewayClassAndRoutePresence) AnyPresent() bool { return true }
func (gatewayClassAndRoutePresence) Has(kind string) bool {
	return kind == "HTTPRoute" || kind == "GatewayClass"
}

// informerFedHarness composes one informer-fed table with the production
// owners: the domain's registration (store + its handler), the resource
// stream (the generation's doorbell and its remaining translators), and the
// snapshot service the doorbell's refetch reads.
type informerFedHarness struct {
	kube     *fake.Clientset
	gateway  *gatewayfake.Clientset
	apiext   *apiextensionsfake.Clientset
	hold     *handlerHold
	service  *snapshot.Service
	manager  *resourcestream.Manager
	registry *domain.Registry
}

type informerFedSource struct {
	name       string
	domain     string
	scope      string
	otherScope string
	register   func(h *informerFedHarness, factory *informer.Factory, ingestManager *ingest.IngestManager) error
	create     func(t *testing.T, h *informerFedHarness, name, rv string)
	update     func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool)
	remove     func(t *testing.T, h *informerFedHarness, name string)
}

func newInformerFedHarness(t *testing.T, source informerFedSource, resync time.Duration, objects ...runtime.Object) *informerFedHarness {
	t.Helper()
	require.NoError(t, informer.DisableWatchList())
	meta := snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := &informerFedHarness{
		kube:    fake.NewClientset(objects...),
		gateway: gatewayfake.NewSimpleClientset(), //nolint:staticcheck // tracker-driven watch events
		apiext:  apiextensionsfake.NewClientset(),
		hold:    newHandlerHold(),
	}
	t.Cleanup(h.hold.releaseHeld)
	checker := permissions.NewCheckerWithReview("c1", time.Minute, func(context.Context, string, string, string, string) (bool, error) {
		return true, nil
	})
	gatewayFactory := gatewayinformers.NewSharedInformerFactory(h.gateway, resync)
	factory := informer.New(ctx, h.kube, h.apiext, resync, checker).
		WithGatewayFactory(ctx, gatewayFactory, gatewayClassAndRoutePresence{})
	ingestManager := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, fake.NewClientset(), nil, nil)
	h.registry = domain.New()
	h.service = snapshot.NewServiceWithPermissions(h.registry, nil, meta, nil)
	h.manager = resourcestream.NewManager(nil, nil, meta, h.service.InvalidateDomainCache)
	t.Cleanup(h.manager.Stop)
	require.NoError(t, source.register(h, factory, ingestManager))
	h.manager.RegisterSources(factory, ingestManager)
	require.NoError(t, factory.Start(ctx))
	syncCtx, syncCancel := context.WithTimeout(ctx, 5*time.Second)
	defer syncCancel()
	for resource, synced := range gatewayFactory.WaitForCacheSync(syncCtx.Done()) {
		require.True(t, synced, "gateway informer did not sync: %v", resource)
	}
	require.Equal(t, int32(1), h.hold.registrations.Load(), "the store must register exactly one held handler")
	return h
}

func (h *informerFedHarness) subscribe(t *testing.T, domainName, scope string) *resourcestream.Subscription {
	t.Helper()
	selector, err := resourcestream.ParseStreamSelector("c1", domainName, scope)
	require.NoError(t, err)
	sub, err := h.manager.SubscribeSelector(selector)
	require.NoError(t, err)
	t.Cleanup(sub.Cancel)
	return sub
}

func (h *informerFedHarness) rowNames(t *testing.T, domainName, scope string) []string {
	t.Helper()
	snap, err := h.service.Build(context.Background(), domainName, "c1|"+scope)
	require.NoError(t, err)
	rows := reflect.ValueOf(snap.Payload).FieldByName("Rows")
	require.True(t, rows.IsValid(), "payload %T has no rows", snap.Payload)
	names := make([]string, 0, rows.Len())
	for i := 0; i < rows.Len(); i++ {
		names = append(names, rows.Index(i).FieldByName("Ref").FieldByName("Name").String())
	}
	return names
}

func awaitDoorbell(t *testing.T, sub *resourcestream.Subscription, domainName string) {
	t.Helper()
	select {
	case update := <-sub.Updates:
		require.Equal(t, domainName, update.Domain)
	case <-time.After(3 * time.Second):
		t.Fatalf("no %s doorbell", domainName)
	}
}

func quietFor(sub *resourcestream.Subscription, window time.Duration) bool {
	select {
	case <-sub.Updates:
		return false
	case <-time.After(window):
		return true
	}
}

func drain(sub *resourcestream.Subscription) {
	for {
		select {
		case <-sub.Updates:
		case <-time.After(100 * time.Millisecond):
			return
		}
	}
}

func helmReleaseSecret(name, rv string, deleting bool) *corev1.Secret {
	rls := &release.Release{
		Name:      name,
		Namespace: "default",
		Version:   1,
		Info:      &release.Info{Status: release.StatusDeployed},
		Chart:     &chart.Chart{Metadata: &chart.Metadata{Name: "demo", Version: "1.0.0"}},
	}
	encoded, _ := json.Marshal(rls)
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: "sh.helm.release.v1." + name + ".v1", Namespace: "default", ResourceVersion: rv, UID: types.UID("uid-" + name),
			Labels: map[string]string{"owner": "helm", "name": name, "status": "deployed", "version": "1"},
		},
		Type: corev1.SecretType("helm.sh/release.v1"),
		Data: map[string][]byte{"release": []byte(base64.StdEncoding.EncodeToString(encoded))},
	}
	markDeleting(&secret.ObjectMeta, deleting)
	return secret
}

func markDeleting(meta *metav1.ObjectMeta, deleting bool) {
	if !deleting {
		return
	}
	now := metav1.Now()
	meta.DeletionTimestamp = &now
	meta.Finalizers = []string{"test.example/hold"}
}

func hpaObject(name, rv, target string, deleting bool) *autoscalingv1.HorizontalPodAutoscaler {
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: rv, UID: types.UID("uid-" + name)},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: target},
			MaxReplicas:    3,
		},
	}
	markDeleting(&hpa.ObjectMeta, deleting)
	return hpa
}

func crdObject(name, rv string, deleting bool) *apiextv1.CustomResourceDefinition {
	crd := &apiextv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv, UID: types.UID("uid-" + name)},
		Spec: apiextv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextv1.CustomResourceDefinitionNames{Plural: "widgets", Kind: "Widget"},
			Scope: apiextv1.NamespaceScoped,
			Versions: []apiextv1.CustomResourceDefinitionVersion{{
				Name: "v1", Served: true, Storage: true,
			}},
		},
	}
	markDeleting(&crd.ObjectMeta, deleting)
	return crd
}

func gatewayTrackerCreate(t *testing.T, h *informerFedHarness, resource string, obj runtime.Object, namespace string) {
	t.Helper()
	require.NoError(t, h.gateway.Tracker().Create(gatewayGV.WithResource(resource), obj, namespace))
}

func gatewayTrackerUpdate(t *testing.T, h *informerFedHarness, resource string, obj runtime.Object, namespace string) {
	t.Helper()
	require.NoError(t, h.gateway.Tracker().Update(gatewayGV.WithResource(resource), obj, namespace))
}

func httpRoute(name, rv string, deleting bool) *gatewayv1.HTTPRoute {
	route := &gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", ResourceVersion: rv, UID: types.UID("uid-" + name)}}
	route.SetGroupVersionKind(gatewayGV.WithKind("HTTPRoute"))
	markDeleting(&route.ObjectMeta, deleting)
	return route
}

func gatewayClass(name, rv string, deleting bool) *gatewayv1.GatewayClass {
	class := &gatewayv1.GatewayClass{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv, UID: types.UID("uid-" + name)},
		Spec:       gatewayv1.GatewayClassSpec{ControllerName: "example.com/gateway"},
	}
	class.SetGroupVersionKind(gatewayGV.WithKind("GatewayClass"))
	markDeleting(&class.ObjectMeta, deleting)
	return class
}

func informerFedSources() []informerFedSource {
	gatewayAllowed := domainpermissions.AllowedResources{
		permissions.ResourceKey("gateway.networking.k8s.io", "httproutes"):     true,
		permissions.ResourceKey("gateway.networking.k8s.io", "gatewayclasses"): true,
	}
	return []informerFedSource{
		{
			name: "HTTPRoute", domain: "namespace-network", scope: "namespace:default", otherScope: "namespace:other",
			register: func(h *informerFedHarness, factory *informer.Factory, ingestManager *ingest.IngestManager) error {
				return snapshot.RegisterNamespaceNetworkDomainWithGatewayAPI(h.registry, factory.SharedInformerFactory(),
					heldGatewayFactory{SharedInformerFactory: factory.GatewayInformerFactory(), hold: h.hold},
					gatewayAllowed, snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, ingestManager, h.manager)
			},
			create: func(t *testing.T, h *informerFedHarness, name, rv string) {
				gatewayTrackerCreate(t, h, "httproutes", httpRoute(name, rv, false), "default")
			},
			update: func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool) {
				gatewayTrackerUpdate(t, h, "httproutes", httpRoute(name, rv, deleting), "default")
			},
			remove: func(t *testing.T, h *informerFedHarness, name string) {
				require.NoError(t, h.gateway.Tracker().Delete(gatewayGV.WithResource("httproutes"), "default", name))
			},
		},
		{
			name: "GatewayClass", domain: "cluster-config", scope: "",
			register: func(h *informerFedHarness, factory *informer.Factory, ingestManager *ingest.IngestManager) error {
				return snapshot.RegisterClusterConfigDomainWithGatewayAPI(h.registry, factory.SharedInformerFactory(),
					heldGatewayFactory{SharedInformerFactory: factory.GatewayInformerFactory(), hold: h.hold},
					gatewayAllowed, snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, ingestManager, h.manager)
			},
			create: func(t *testing.T, h *informerFedHarness, name, rv string) {
				gatewayTrackerCreate(t, h, "gatewayclasses", gatewayClass(name, rv, false), "")
			},
			update: func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool) {
				gatewayTrackerUpdate(t, h, "gatewayclasses", gatewayClass(name, rv, deleting), "")
			},
			remove: func(t *testing.T, h *informerFedHarness, name string) {
				require.NoError(t, h.gateway.Tracker().Delete(gatewayGV.WithResource("gatewayclasses"), "", name))
			},
		},
		{
			name: "HorizontalPodAutoscaler", domain: "namespace-autoscaling", scope: "namespace:default", otherScope: "namespace:other",
			register: func(h *informerFedHarness, factory *informer.Factory, _ *ingest.IngestManager) error {
				return snapshot.RegisterNamespaceAutoscalingDomain(h.registry,
					heldSharedFactory{SharedInformerFactory: factory.SharedInformerFactory(), hold: h.hold},
					snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, h.manager)
			},
			create: func(t *testing.T, h *informerFedHarness, name, rv string) {
				_, err := h.kube.AutoscalingV1().HorizontalPodAutoscalers("default").Create(context.Background(), hpaObject(name, rv, "web", false), metav1.CreateOptions{})
				require.NoError(t, err)
			},
			update: func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool) {
				_, err := h.kube.AutoscalingV1().HorizontalPodAutoscalers("default").Update(context.Background(), hpaObject(name, rv, "api", deleting), metav1.UpdateOptions{})
				require.NoError(t, err)
			},
			remove: func(t *testing.T, h *informerFedHarness, name string) {
				require.NoError(t, h.kube.AutoscalingV1().HorizontalPodAutoscalers("default").Delete(context.Background(), name, metav1.DeleteOptions{}))
			},
		},
		{
			name: "CustomResourceDefinition", domain: "cluster-crds", scope: "",
			register: func(h *informerFedHarness, factory *informer.Factory, _ *ingest.IngestManager) error {
				return snapshot.RegisterClusterCRDDomain(h.registry,
					heldAPIExtensionsFactory{SharedInformerFactory: factory.APIExtensionsInformerFactory(), hold: h.hold},
					snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, h.manager)
			},
			create: func(t *testing.T, h *informerFedHarness, name, rv string) {
				_, err := h.apiext.ApiextensionsV1().CustomResourceDefinitions().Create(context.Background(), crdObject(name, rv, false), metav1.CreateOptions{})
				require.NoError(t, err)
			},
			update: func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool) {
				_, err := h.apiext.ApiextensionsV1().CustomResourceDefinitions().Update(context.Background(), crdObject(name, rv, deleting), metav1.UpdateOptions{})
				require.NoError(t, err)
			},
			remove: func(t *testing.T, h *informerFedHarness, name string) {
				require.NoError(t, h.apiext.ApiextensionsV1().CustomResourceDefinitions().Delete(context.Background(), name, metav1.DeleteOptions{}))
			},
		},
		{
			name: "Helm release", domain: "namespace-helm", scope: "namespace:default", otherScope: "namespace:other",
			register: func(h *informerFedHarness, factory *informer.Factory, _ *ingest.IngestManager) error {
				return snapshot.RegisterNamespaceHelmDomain(h.registry,
					heldHelmStorage{source: factory.HelmStorage(), hold: h.hold},
					snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, h.manager)
			},
			create: func(t *testing.T, h *informerFedHarness, name, rv string) {
				_, err := h.kube.CoreV1().Secrets("default").Create(context.Background(), helmReleaseSecret(name, rv, false), metav1.CreateOptions{})
				require.NoError(t, err)
			},
			update: func(t *testing.T, h *informerFedHarness, name, rv string, deleting bool) {
				_, err := h.kube.CoreV1().Secrets("default").Update(context.Background(), helmReleaseSecret(name, rv, deleting), metav1.UpdateOptions{})
				require.NoError(t, err)
			},
			remove: func(t *testing.T, h *informerFedHarness, name string) {
				require.NoError(t, h.kube.CoreV1().Secrets("default").Delete(context.Background(), "sh.helm.release.v1."+name+".v1", metav1.DeleteOptions{}))
			},
		},
	}
}

// changeWhileStoreHeld runs one source change with the store's handler held:
// no doorbell may ring until the store applies it, and the read the doorbell
// triggers, and a later cached read, must both show the change.
func changeWhileStoreHeld(t *testing.T, h *informerFedHarness, source informerFedSource, sub *resourcestream.Subscription, change func(), wantPresent bool, step string) {
	t.Helper()
	h.hold.hold()
	change()
	require.True(t, quietFor(sub, 300*time.Millisecond), "%s: the doorbell rang before the store applied the change", step)
	h.hold.releaseHeld()
	select {
	case <-h.hold.applied:
	case <-time.After(3 * time.Second):
		t.Fatalf("%s: the store never applied the change", step)
	}
	awaitDoorbell(t, sub, source.domain)
	for _, read := range []string{"doorbell refetch", "later cached read"} {
		names := h.rowNames(t, source.domain, source.scope)
		if wantPresent {
			require.Contains(t, names, "web", "%s: %s", step, read)
		} else {
			require.NotContains(t, names, "web", "%s: %s", step, read)
		}
	}
	drain(sub)
}

// An informer-fed table's doorbell rings only after the table's own store
// holds the change, for create, update, a finalizer-held deletion request,
// and a completed delete; and a namespaced change never rings another
// namespace's view.
func TestInformerFedTableDoorbellFollowsItsStore(t *testing.T) {
	for _, source := range informerFedSources() {
		t.Run(source.name, func(t *testing.T) {
			h := newInformerFedHarness(t, source, 0)
			sub := h.subscribe(t, source.domain, source.scope)
			var other *resourcestream.Subscription
			if source.otherScope != "" {
				other = h.subscribe(t, source.domain, source.otherScope)
			}
			require.NotContains(t, h.rowNames(t, source.domain, source.scope), "web", "prime the cache")

			changeWhileStoreHeld(t, h, source, sub, func() { source.create(t, h, "web", "10") }, true, "create")
			changeWhileStoreHeld(t, h, source, sub, func() { source.update(t, h, "web", "11", false) }, true, "update")
			changeWhileStoreHeld(t, h, source, sub, func() { source.update(t, h, "web", "12", true) }, true, "deletion requested")
			changeWhileStoreHeld(t, h, source, sub, func() { source.remove(t, h, "web") }, false, "delete")
			if other != nil {
				require.True(t, quietFor(other, 100*time.Millisecond), "another namespace's view rang")
			}
		})
	}
}

// An HPA change rings its target workload's row after the HPA store applies
// it, including the previous target when the HPA is retargeted.
func TestHPAChangeRingsTargetWorkloadRows(t *testing.T) {
	source := informerFedSources()[2]
	h := newInformerFedHarness(t, source, 0)
	workloads := h.subscribe(t, "namespace-workloads", "namespace:default")
	source.create(t, h, "web", "10")
	awaitDoorbell(t, workloads, "namespace-workloads")
	drain(workloads)
	source.update(t, h, "web", "11", false)
	awaitDoorbell(t, workloads, "namespace-workloads")
}

// Informer resyncs re-deliver every cached object with an unchanged
// resourceVersion; they must not ring an informer-fed table, while a real
// update right after still does.
func TestInformerFedTableDoorbellsIgnoreResyncEchoes(t *testing.T) {
	for _, source := range informerFedSources() {
		t.Run(source.name, func(t *testing.T) {
			h := newInformerFedHarness(t, source, time.Second)
			sub := h.subscribe(t, source.domain, source.scope)
			source.create(t, h, "web", "10")
			awaitDoorbell(t, sub, source.domain)
			drain(sub)
			require.True(t, quietFor(sub, 2500*time.Millisecond), "a resync echo rang the doorbell")
			source.update(t, h, "web", "11", false)
			awaitDoorbell(t, sub, source.domain)
		})
	}
}

// A store restored from a spill can hold rows deleted while the cluster was
// Cold. Reconcile drops them on re-warm, and must ring their scopes, or the
// view keeps the ghost row until some unrelated change.
func TestInformerFedStoresRingWhenReconcileDropsRestoredRows(t *testing.T) {
	for _, source := range informerFedSources() {
		if source.domain == "namespace-helm" {
			continue // Helm releases are not spilled (namespace_helm.go).
		}
		t.Run(source.name, func(t *testing.T) {
			spillDir := t.TempDir()
			before := newInformerFedHarness(t, source, 0)
			beforeSub := before.subscribe(t, source.domain, source.scope)
			source.create(t, before, "web", "10")
			awaitDoorbell(t, beforeSub, source.domain)
			require.Contains(t, before.rowNames(t, source.domain, source.scope), "web")
			require.NoError(t, before.registry.SpillMaintainedStores(spillDir))

			after := newInformerFedHarness(t, source, 0)
			require.NoError(t, after.registry.RestoreMaintainedStores(spillDir))
			sub := after.subscribe(t, source.domain, source.scope)
			require.Contains(t, after.rowNames(t, source.domain, source.scope), "web", "the restored row is served until Reconcile runs")
			after.registry.ReconcileMaintainedStores()
			awaitDoorbell(t, sub, source.domain)
			require.NotContains(t, after.rowNames(t, source.domain, source.scope), "web")
		})
	}
}
