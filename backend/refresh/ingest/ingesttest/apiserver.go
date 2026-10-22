// Package ingesttest serves a Kubernetes-shaped API from a client-go object
// tracker, so tests can run production reflectors end to end: LIST, WATCH,
// WatchList, resourceVersion resume, and the 410 relist a watch gap forces.
// Only tests import it.
//
// The server sends no bookmarks, so a store's spilled resourceVersion is the
// one its last list returned, and a resumed watch replays every write after
// it. A restore test that must see no events after the resume creates its
// objects before the first list.
package ingesttest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/runtime/serializer"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	clienttesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
)

// scheme decodes and encodes every kind the server can serve: the client-go
// built-ins and CustomResourceDefinitions.
var scheme = func() *runtime.Scheme {
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(apiextensionsv1.AddToScheme(s))
	return s
}()

var codecs = serializer.NewCodecFactory(scheme)

// Route is one served resource.
type Route struct {
	GVR     schema.GroupVersionResource
	ItemGVK schema.GroupVersionKind
}

// APIServer answers GET, LIST and WATCH for its routes from an object tracker, and
// SelfSubjectAccessReviews from its access policy. Every write is stamped with
// the next resourceVersion and recorded, so a watch from a resourceVersion
// replays every later change, as the Kubernetes API does.
type APIServer struct {
	tracker clienttesting.ObjectTracker
	routes  map[string]Route
	server  *httptest.Server

	mu       sync.Mutex
	revision int64
	history  []recordedEvent
	// changed is closed and replaced on every recorded write.
	changed chan struct{}
	// floor is the oldest resourceVersion a watch may resume from; an older
	// one is answered 410 Gone, which makes the reflector relist.
	floor   int64
	gap     chan struct{}
	watches map[*openWatch]struct{}
	allow   func(attrs authorizationv1.ResourceAttributes) bool
}

type recordedEvent struct {
	revision  int64
	gvr       schema.GroupVersionResource
	namespace string
	eventType watch.EventType
	object    runtime.Object
}

type openWatch struct {
	stop chan struct{}
	done chan struct{}
}

// NewAPIServer serves every built-in streamed kind in the registry plus the
// extra kinds a test names (bespoke reflectors' kinds). Every access review is
// allowed until Allow replaces the policy.
func NewAPIServer(t testing.TB, extra ...schema.GroupVersionKind) *APIServer {
	t.Helper()
	s := &APIServer{
		tracker: clienttesting.NewObjectTracker(scheme, codecs.UniversalDecoder()),
		routes:  make(map[string]Route),
		// Start past zero: resourceVersion "0" means "any version" to a
		// client, so a list must never report it.
		revision: 1,
		changed:  make(chan struct{}),
		watches:  make(map[*openWatch]struct{}),
		allow:    func(authorizationv1.ResourceAttributes) bool { return true },
	}
	for _, d := range kindregistry.StreamDescriptors() {
		s.addRoute(schema.GroupVersionResource{Group: d.Group, Version: d.Version, Resource: d.Resource}, schema.GroupVersionKind{Group: d.Group, Version: d.Version, Kind: d.Kind})
	}
	for _, gvk := range extra {
		gvr, _ := apimeta.UnsafeGuessKindToResource(gvk)
		s.addRoute(gvr, gvk)
	}
	s.server = httptest.NewServer(s)
	t.Cleanup(s.close)
	return s
}

// addRoute serves a kind the server's scheme can decode; Gateway kinds are
// served by another client and skipped.
func (s *APIServer) addRoute(gvr schema.GroupVersionResource, gvk schema.GroupVersionKind) {
	if _, err := scheme.New(gvk); err != nil {
		return
	}
	s.routes[gvr.Group+"/"+gvr.Version+"/"+gvr.Resource] = Route{GVR: gvr, ItemGVK: gvk}
}

func (s *APIServer) close() {
	s.mu.Lock()
	gate := s.gap
	s.gap = nil
	s.mu.Unlock()
	if gate != nil {
		close(gate)
	}
	s.server.CloseClientConnections()
	s.server.Close()
}

// Routes returns the served resources.
func (s *APIServer) Routes() []Route {
	routes := make([]Route, 0, len(s.routes))
	for _, route := range s.routes {
		routes = append(routes, route)
	}
	return routes
}

// NewObject returns an empty object of a served kind.
func (s *APIServer) NewObject(gvk schema.GroupVersionKind) (runtime.Object, error) {
	return scheme.New(gvk)
}

// Serves reports whether the server answers the resource.
func (s *APIServer) Serves(gvr schema.GroupVersionResource) bool {
	_, ok := s.routes[gvr.Group+"/"+gvr.Version+"/"+gvr.Resource]
	return ok
}

// Config returns a client configuration for the server: JSON on the wire, and
// no client-side rate limit, which would serialize a subsystem's startup
// access reviews.
func (s *APIServer) Config() *rest.Config {
	return &rest.Config{
		Host:          s.server.URL,
		QPS:           -1,
		ContentConfig: rest.ContentConfig{ContentType: runtime.ContentTypeJSON, AcceptContentTypes: runtime.ContentTypeJSON},
	}
}

// Client returns a typed client for the server.
func (s *APIServer) Client(t testing.TB) kubernetes.Interface {
	t.Helper()
	kube, err := kubernetes.NewForConfig(s.Config())
	if err != nil {
		t.Fatalf("kubernetes.NewForConfig: %v", err)
	}
	return kube
}

// APIExtensionsClient returns a CustomResourceDefinition client for the server.
func (s *APIServer) APIExtensionsClient(t testing.TB) apiextensionsclientset.Interface {
	t.Helper()
	client, err := apiextensionsclientset.NewForConfig(s.Config())
	if err != nil {
		t.Fatalf("apiextensions client: %v", err)
	}
	return client
}

// Allow replaces the access-review policy.
func (s *APIServer) Allow(allow func(attrs authorizationv1.ResourceAttributes) bool) {
	s.mu.Lock()
	s.allow = allow
	s.mu.Unlock()
}

// Create stores a new object and sends an ADDED event.
func (s *APIServer) Create(t testing.TB, obj runtime.Object) {
	t.Helper()
	s.write(t, obj, watch.Added, func(route Route, namespace string) error {
		return s.tracker.Create(route.GVR, obj, namespace)
	})
}

// Update replaces an object and sends a MODIFIED event.
func (s *APIServer) Update(t testing.TB, obj runtime.Object) {
	t.Helper()
	s.write(t, obj, watch.Modified, func(route Route, namespace string) error {
		return s.tracker.Update(route.GVR, obj, namespace)
	})
}

// Delete removes an object and sends a DELETED event.
func (s *APIServer) Delete(t testing.TB, obj runtime.Object) {
	t.Helper()
	s.write(t, obj, watch.Deleted, func(route Route, namespace string) error {
		return s.tracker.Delete(route.GVR, namespace, metaOf(t, obj).GetName())
	})
}

// write stamps obj with the next resourceVersion, applies change to the
// tracker, and records the event, all under one lock, so lists and watch
// replays always agree on which writes a resourceVersion includes.
func (s *APIServer) write(t testing.TB, obj runtime.Object, eventType watch.EventType, change func(Route, string) error) {
	t.Helper()
	route := s.routeOf(t, obj)
	obj.GetObjectKind().SetGroupVersionKind(route.ItemGVK)
	accessor := metaOf(t, obj)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revision++
	accessor.SetResourceVersion(strconv.FormatInt(s.revision, 10))
	if err := change(route, accessor.GetNamespace()); err != nil {
		t.Fatalf("%s %s: %v", eventType, route.GVR.Resource, err)
	}
	s.history = append(s.history, recordedEvent{
		revision: s.revision, gvr: route.GVR, namespace: accessor.GetNamespace(),
		eventType: eventType, object: obj.DeepCopyObject(),
	})
	close(s.changed)
	s.changed = make(chan struct{})
}

// WatchGap closes every open watch, runs change while no watch is open, and
// then expires every resourceVersion issued before the gap, so each reflector
// relists and never sees change as individual events. Requests made during the
// gap wait for it to end.
func (s *APIServer) WatchGap(t testing.TB, change func()) {
	t.Helper()
	gate := make(chan struct{})
	s.mu.Lock()
	s.gap = gate
	open := make([]*openWatch, 0, len(s.watches))
	for w := range s.watches {
		open = append(open, w)
	}
	s.mu.Unlock()
	for _, w := range open {
		close(w.stop)
	}
	for _, w := range open {
		<-w.done
	}
	change()
	s.mu.Lock()
	s.revision++
	s.floor = s.revision
	s.gap = nil
	s.mu.Unlock()
	close(gate)
}

func (s *APIServer) routeOf(t testing.TB, obj runtime.Object) Route {
	t.Helper()
	kinds, _, err := scheme.ObjectKinds(obj)
	if err != nil || len(kinds) == 0 {
		t.Fatalf("object kind: %v", err)
	}
	for _, route := range s.routes {
		if route.ItemGVK == kinds[0] {
			return route
		}
	}
	t.Fatalf("no route serves %s", kinds[0])
	return Route{}
}

func metaOf(t testing.TB, obj runtime.Object) metav1.Object {
	t.Helper()
	accessor, err := apimeta.Accessor(obj)
	if err != nil {
		t.Fatalf("accessor: %v", err)
	}
	return accessor
}

// routeFor parses a REST path into its route, namespace, and object name (""
// for a collection). Paths are the /api/v1/... (core) and
// /apis/<group>/<version>/... shapes client-go builds.
func (s *APIServer) routeFor(path string) (Route, string, string, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	var group, version string
	var rest []string
	switch {
	case len(parts) >= 3 && parts[0] == "api":
		version, rest = parts[1], parts[2:]
	case len(parts) >= 4 && parts[0] == "apis":
		group, version, rest = parts[1], parts[2], parts[3:]
	default:
		return Route{}, "", "", false
	}
	namespace, resource, name := "", rest[0], ""
	switch {
	case len(rest) >= 3 && rest[0] == "namespaces":
		namespace, resource = rest[1], rest[2]
		if len(rest) >= 4 {
			name = rest[3]
		}
	case len(rest) >= 2:
		name = rest[1]
	}
	route, ok := s.routes[group+"/"+version+"/"+resource]
	return route, namespace, name, ok
}

func (s *APIServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/selfsubjectaccessreviews") {
		s.serveAccessReview(w, r)
		return
	}
	route, namespace, name, ok := s.routeFor(r.URL.Path)
	if !ok {
		http.Error(w, "unknown resource: "+r.URL.Path, http.StatusNotFound)
		return
	}
	if !s.waitForGap(r.Context()) {
		return
	}
	encoder := codecs.LegacyCodec(route.ItemGVK.GroupVersion())
	switch {
	case name != "":
		s.serveGet(w, route, namespace, name, encoder)
	case r.URL.Query().Get("watch") != "true":
		s.serveList(w, route, namespace, encoder)
	default:
		s.serveWatch(w, r, route, namespace, encoder)
	}
}

// waitForGap holds a request until an open watch gap ends.
func (s *APIServer) waitForGap(ctx context.Context) bool {
	s.mu.Lock()
	gate := s.gap
	s.mu.Unlock()
	if gate == nil {
		return true
	}
	select {
	case <-gate:
		return true
	case <-ctx.Done():
		return false
	}
}

func (s *APIServer) serveAccessReview(w http.ResponseWriter, r *http.Request) {
	var review authorizationv1.SelfSubjectAccessReview
	if err := json.NewDecoder(r.Body).Decode(&review); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	allow := s.allow
	s.mu.Unlock()
	if attrs := review.Spec.ResourceAttributes; attrs != nil {
		review.Status.Allowed = allow(*attrs)
	}
	review.APIVersion, review.Kind = authorizationv1.SchemeGroupVersion.String(), "SelfSubjectAccessReview"
	setJSONContentType(w)
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(&review)
}

// list returns the route's objects at the current resourceVersion.
func (s *APIServer) list(route Route, namespace string) (runtime.Object, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list, err := s.tracker.List(route.GVR, route.ItemGVK, namespace)
	if err != nil {
		return nil, 0, err
	}
	if listMeta, metaErr := apimeta.ListAccessor(list); metaErr == nil {
		listMeta.SetResourceVersion(strconv.FormatInt(s.revision, 10))
	}
	return list, s.revision, nil
}

// serveGet answers a GET of one object, or 404 when the tracker has none.
func (s *APIServer) serveGet(w http.ResponseWriter, route Route, namespace, name string, encoder runtime.Encoder) {
	s.mu.Lock()
	obj, err := s.tracker.Get(route.GVR, namespace, name)
	s.mu.Unlock()
	if apierrors.IsNotFound(err) {
		status := apierrors.NewNotFound(route.GVR.GroupResource(), name).ErrStatus
		status.APIVersion, status.Kind = "v1", "Status"
		setJSONContentType(w)
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(&status)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	data, err := runtime.Encode(encoder, obj)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	setJSONContentType(w)
	_, _ = w.Write(data)
}

func (s *APIServer) serveList(w http.ResponseWriter, route Route, namespace string, encoder runtime.Encoder) {
	list, _, err := s.list(route, namespace)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	data, err := runtime.Encode(encoder, list)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	setJSONContentType(w)
	_, _ = w.Write(data)
}

// watchStart is the resourceVersion a plain watch resumes after, or false
// when it starts from now ("", "0", or a WatchList).
func watchStart(r *http.Request) (int64, bool) {
	query := r.URL.Query()
	if query.Get("sendInitialEvents") == "true" {
		return 0, false
	}
	version, err := strconv.ParseInt(query.Get("resourceVersion"), 10, 64)
	if err != nil || version == 0 {
		return 0, false
	}
	return version, true
}

func setJSONContentType(w http.ResponseWriter) {
	w.Header().Set("Content-Type", runtime.ContentTypeJSON)
}

func writeGone(w http.ResponseWriter) {
	status := apierrors.NewResourceExpired("resource version too old").ErrStatus
	status.APIVersion, status.Kind = "v1", "Status"
	setJSONContentType(w)
	w.WriteHeader(http.StatusGone)
	_ = json.NewEncoder(w).Encode(&status)
}

// register records an open watch and returns its starting revision: the
// requested one, or the current one for a watch that starts from now. It
// reports false when the requested revision has expired or a gap began.
func (s *APIServer) register(r *http.Request) (*openWatch, int64, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	from, resuming := watchStart(r)
	if resuming && from < s.floor {
		return nil, 0, true, false
	}
	if s.gap != nil {
		return nil, 0, false, false
	}
	if !resuming {
		from = s.revision
	}
	open := &openWatch{stop: make(chan struct{}), done: make(chan struct{})}
	s.watches[open] = struct{}{}
	return open, from, false, true
}

func (s *APIServer) unregister(open *openWatch) {
	s.mu.Lock()
	delete(s.watches, open)
	s.mu.Unlock()
	close(open.done)
}

// eventsAfter returns the recorded events for the route after revision, and
// the channel that closes on the next write.
func (s *APIServer) eventsAfter(revision int64, route Route, namespace string) ([]recordedEvent, chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var events []recordedEvent
	for _, event := range s.history {
		if event.revision > revision && event.gvr == route.GVR && (namespace == "" || event.namespace == namespace) {
			events = append(events, event)
		}
	}
	return events, s.changed
}

// serveWatch serves both a plain WATCH and a WatchList (sendInitialEvents). A
// WatchList streams the current set as ADDED events and then the BOOKMARK
// carrying k8s.io/initial-events-end, which marks the reflector synced. Both
// then stream every later recorded change as concatenated WatchEvent JSON
// objects; a plain watch from a resourceVersion first replays the changes
// after it.
func (s *APIServer) serveWatch(w http.ResponseWriter, r *http.Request, route Route, namespace string, encoder runtime.Encoder) {
	open, cursor, expired, ok := s.register(r)
	if expired {
		writeGone(w)
		return
	}
	if !ok {
		// A gap began after this request passed the gate; end it so the
		// client retries.
		return
	}
	defer s.unregister(open)

	setJSONContentType(w)
	w.WriteHeader(http.StatusOK)
	write := eventWriter(w, encoder)
	if r.URL.Query().Get("sendInitialEvents") == "true" {
		listed, ok := s.sendInitialEvents(route, namespace, write)
		if !ok {
			return
		}
		cursor = listed
	}
	s.streamEvents(r.Context(), open, route, namespace, cursor, write)
}

// streamEvents writes every recorded change after cursor, then each later
// one, until the client goes away or the watch is stopped.
func (s *APIServer) streamEvents(ctx context.Context, open *openWatch, route Route, namespace string, cursor int64, write func(watch.EventType, runtime.Object) bool) {
	for {
		events, changed := s.eventsAfter(cursor, route, namespace)
		for _, event := range events {
			if stopped(open) || !write(event.eventType, event.object) {
				return
			}
			cursor = event.revision
		}
		select {
		case <-ctx.Done():
			return
		case <-open.stop:
			return
		case <-changed:
		}
	}
}

func stopped(open *openWatch) bool {
	select {
	case <-open.stop:
		return true
	default:
		return false
	}
}

// sendInitialEvents streams the current set and the initial-events-end
// bookmark, and returns the revision the set reflects.
func (s *APIServer) sendInitialEvents(route Route, namespace string, write func(watch.EventType, runtime.Object) bool) (int64, bool) {
	list, revision, err := s.list(route, namespace)
	if err != nil {
		return 0, false
	}
	items, _ := apimeta.ExtractList(list)
	for _, item := range items {
		if !write(watch.Added, item) {
			return 0, false
		}
	}
	return revision, write(watch.Bookmark, initialEventsEndBookmark(route, list))
}

func eventWriter(w http.ResponseWriter, encoder runtime.Encoder) func(watch.EventType, runtime.Object) bool {
	flusher, _ := w.(http.Flusher)
	return func(eventType watch.EventType, obj runtime.Object) bool {
		raw, err := runtime.Encode(encoder, obj)
		if err != nil {
			return false
		}
		frame, err := json.Marshal(metav1.WatchEvent{Type: string(eventType), Object: runtime.RawExtension{Raw: raw}})
		if err != nil {
			return false
		}
		if _, err := w.Write(frame); err != nil {
			return false
		}
		if flusher != nil {
			flusher.Flush()
		}
		return true
	}
}

// initialEventsEndBookmark is the terminal WatchList bookmark: an empty object
// of the kind carrying the list's resourceVersion and the
// k8s.io/initial-events-end annotation.
func initialEventsEndBookmark(route Route, list runtime.Object) runtime.Object {
	obj, err := scheme.New(route.ItemGVK)
	if err != nil {
		return nil
	}
	accessor, err := apimeta.Accessor(obj)
	if err != nil {
		return nil
	}
	if listMeta, err := apimeta.ListAccessor(list); err == nil {
		accessor.SetResourceVersion(listMeta.GetResourceVersion())
	}
	accessor.SetAnnotations(map[string]string{"k8s.io/initial-events-end": "true"})
	return obj
}
