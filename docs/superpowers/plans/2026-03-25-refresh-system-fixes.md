# Refresh System Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five bugs in the refresh system — make the browse view update in sub-second time via informer-driven catalog updates, fix `upsertByUID` deletion blindness, fix manual fetch hijacking by stalled streams, add SSE health tracking, and document `DEFAULT_AUTO_START`.

**Architecture:** Item A adds informer event handlers to the catalog service that incrementally update `s.items` and broadcast to SSE subscribers, bypassing the 60-second sync timer. Item B makes four targeted frontend fixes to the refresh orchestrator, catalog stream manager, and browse utilities. Items A and B are independent and can be executed in parallel.

**Tech Stack:** Go 1.26 / `k8s.io/client-go` informers (Item A), TypeScript / React (Item B).

**Spec:** `docs/superpowers/specs/2026-03-25-refresh-system-fixes-design.md`

---

## File Structure

### Item A — Catalog reactive updates (backend)

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `backend/objectcatalog/watch.go` | `watchNotifier`, `watchEvent`, `flush()`, `run()`, `send()`, `registerWatchHandlers()`, `resolveGRToDescriptor()`, `toMetaObject()`, `watchInformerAccessor` map |
| Create | `backend/objectcatalog/watch_test.go` | All tests for the watch path |
| Modify | `backend/objectcatalog/service.go` | Add `syncInProgress atomic.Bool` to `Service` |
| Modify | `backend/objectcatalog/types.go` | Add `EnableReactiveUpdates` to `Options` |
| Modify | `backend/objectcatalog/sync.go` | Set `syncInProgress` flag in `sync()`, start notifier in `runLoop()` |

### Item B — Frontend refresh robustness

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `frontend/src/modules/browse/utils/browseUtils.ts` | JSDoc on `upsertByUID` (Fix #2) |
| Modify | `frontend/src/core/refresh/orchestrator.ts` | Fix manual fetch hijack (Fix #3), extend `isStreamingHealthy` (Fix #4), comment on `DEFAULT_AUTO_START` (Fix #5) |
| Modify | `frontend/src/core/refresh/streaming/catalogStreamManager.ts` | Add `lastEventAt` tracking and `isHealthy()` (Fix #4) |

---

## Item A: Catalog Reactive Updates

### Task 1: Add `syncInProgress` flag and `EnableReactiveUpdates` option

**Files:**
- Modify: `backend/objectcatalog/service.go:63-97`
- Modify: `backend/objectcatalog/types.go:118-128`
- Modify: `backend/objectcatalog/service.go:114-150`

- [ ] **Step 1: Add `syncInProgress` field to Service struct**

In `service.go`, add after the `healthMu`/`health` fields (line 87), before `startOnce`:

```go
syncInProgress atomic.Bool // true while sync() is running — prevents watch flush races
```

Add `"sync/atomic"` to the import block.

- [ ] **Step 2: Add `EnableReactiveUpdates` to Options**

In `types.go`, add after `StreamingFlushInterval` (line 127):

```go
EnableReactiveUpdates bool // enables informer-driven incremental updates (default true)
```

- [ ] **Step 3: Set the default in NewService**

In `service.go` `NewService()`, add to the serviceOpts initializer (after line ~123):

```go
EnableReactiveUpdates: true,
```

In the `if opts != nil` block, add a conditional override after the `StreamingFlushInterval` check. Use `!opts.EnableReactiveUpdates` so that only an explicit `false` disables the feature — passing `&Options{}` with other fields set preserves the default `true`:

```go
if !opts.EnableReactiveUpdates {
	serviceOpts.EnableReactiveUpdates = false
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -count=1`
Expected: All PASS.

---

### Task 2: Set `syncInProgress` flag in sync()

**Files:**
- Modify: `backend/objectcatalog/sync.go:202-210`

- [ ] **Step 1: Add flag guards in sync()**

In `sync.go`, add after `start := s.now()` (line 203):

```go
s.syncInProgress.Store(true)
defer s.syncInProgress.Store(false)
```

- [ ] **Step 2: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -count=1`
Expected: All PASS.

---

### Task 3: Create watch.go with types, notifier, and flush

**Files:**
- Create: `backend/objectcatalog/watch.go`
- Create: `backend/objectcatalog/watch_test.go`

- [ ] **Step 1: Write tests for flush behavior**

Create `backend/objectcatalog/watch_test.go`:

```go
package objectcatalog

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

func newTestWatchService() *Service {
	return &Service{
		now:               time.Now,
		items:             make(map[string]Summary),
		lastSeen:          make(map[string]time.Time),
		resources:         make(map[string]resourceDescriptor),
		streamSubscribers: make(map[int]chan StreamingUpdate),
		promoted:          make(map[string]*promotedDescriptor),
		health:            healthStatus{State: HealthStateUnknown},
		doneCh:            make(chan struct{}),
		clusterID:         "test-cluster",
		clusterName:       "test",
	}
}

func testDeploymentDescriptor() resourceDescriptor {
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"},
		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
}

func testNodeDescriptor() resourceDescriptor {
	return resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"},
		Namespaced: false,
		Kind:       "Node",
		Group:      "",
		Version:    "v1",
		Resource:   "nodes",
		Scope:      ScopeCluster,
	}
}

func registerDesc(svc *Service, desc resourceDescriptor) {
	svc.resources[desc.GVR.String()] = desc
}

func TestFlushAddEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-deploy", Namespace: "default",
		UID: "uid-1", ResourceVersion: "100",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "my-deploy"),
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 {
		t.Fatalf("expected 1 item, got %d", result.TotalItems)
	}
	if result.Items[0].Name != "my-deploy" || result.Items[0].Kind != "Deployment" {
		t.Fatalf("unexpected item: %+v", result.Items[0])
	}
}

func TestFlushUpdateEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	key := catalogKey(desc, "default", "my-deploy")
	svc.items[key] = Summary{Name: "my-deploy", Namespace: "default", Kind: "Deployment", ResourceVersion: "1"}
	svc.lastSeen[key] = time.Now()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "my-deploy", Namespace: "default",
		UID: "uid-1", ResourceVersion: "200",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventUpdate,
		gvr:       desc.GVR.String(),
		key:       key,
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 {
		t.Fatalf("expected 1 item, got %d", result.TotalItems)
	}
	if result.Items[0].ResourceVersion != "200" {
		t.Fatalf("expected rv 200, got %s", result.Items[0].ResourceVersion)
	}
}

func TestFlushDeleteEvent(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	key := catalogKey(desc, "default", "my-deploy")
	svc.items[key] = Summary{Name: "my-deploy", Namespace: "default", Kind: "Deployment"}
	svc.lastSeen[key] = time.Now()
	svc.rebuildCacheFromItems(cloneSummaryMap(svc.items), svc.Descriptors())

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventDelete,
		gvr:       desc.GVR.String(),
		key:       key,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushSkipsUnknownGVR(t *testing.T) {
	svc := newTestWatchService()
	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "orphan", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       "unknown/v1/things",
		key:       "unknown/v1/things/default/orphan",
		obj:       obj,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushSkipsDuringSyncInProgress(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)
	svc.syncInProgress.Store(true)

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "blocked", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "blocked"),
		obj:       obj,
	}})

	if svc.Count() != 0 {
		t.Fatalf("expected 0 items, got %d", svc.Count())
	}
}

func TestFlushClusterScopedResource(t *testing.T) {
	svc := newTestWatchService()
	desc := testNodeDescriptor()
	registerDesc(svc, desc)

	obj := &corev1.Node{ObjectMeta: metav1.ObjectMeta{
		Name: "node-1", UID: "node-uid", ResourceVersion: "50",
	}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "", "node-1"),
		obj:       obj,
	}})

	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 || result.Items[0].Scope != ScopeCluster {
		t.Fatalf("unexpected: %+v", result)
	}
}

func TestFlushBroadcastsToSubscribers(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ch, unsub := svc.SubscribeStreaming()
	defer unsub()
	<-ch // drain initial signal

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "x", Namespace: "default"}}

	notifier := newWatchNotifier(context.Background(), svc)
	notifier.flush([]watchEvent{{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "default", "x"),
		obj:       obj,
	}})

	select {
	case update := <-ch:
		if !update.Ready {
			t.Fatal("expected ready broadcast")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}
}

func TestWatchNotifierDebouncesBatch(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)
	go notifier.run()

	for i := 0; i < 3; i++ {
		name := "pod-" + string(rune('a'+i))
		obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "default", UID: types.UID("uid-" + name),
		}}
		notifier.send(watchEvent{
			eventType: watchEventAdd,
			gvr:       desc.GVR.String(),
			key:       catalogKey(desc, "default", name),
			obj:       obj,
		})
	}

	time.Sleep(500 * time.Millisecond)
	if svc.Count() != 3 {
		t.Fatalf("expected 3 items, got %d", svc.Count())
	}
}

func TestWatchNotifierStopsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	notifier := newWatchNotifier(ctx, newTestWatchService())

	done := make(chan struct{})
	go func() { notifier.run(); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run() did not exit")
	}
}

func TestRegisterWatchHandlersNilFactory(t *testing.T) {
	svc := newTestWatchService()
	notifier := newWatchNotifier(context.Background(), svc)
	registerWatchHandlers(nil, nil, notifier, svc)
	if len(notifier.pending) != 0 {
		t.Fatal("expected no events from nil factory")
	}
}

func TestReactiveUpdateEndToEnd(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)
	go notifier.run()

	obj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "e2e-pod", Namespace: "prod", UID: "e2e-uid", ResourceVersion: "1",
	}}
	notifier.send(watchEvent{
		eventType: watchEventAdd,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "prod", "e2e-pod"),
		obj:       obj,
	})

	time.Sleep(500 * time.Millisecond)
	result := svc.Query(QueryOptions{})
	if result.TotalItems != 1 || result.Items[0].Name != "e2e-pod" {
		t.Fatalf("add failed: %+v", result)
	}

	notifier.send(watchEvent{
		eventType: watchEventDelete,
		gvr:       desc.GVR.String(),
		key:       catalogKey(desc, "prod", "e2e-pod"),
	})

	time.Sleep(500 * time.Millisecond)
	result = svc.Query(QueryOptions{})
	if result.TotalItems != 0 {
		t.Fatalf("delete failed: %d items remain", result.TotalItems)
	}
}

func TestMakeHandlerSkipsNoOpUpdates(t *testing.T) {
	svc := newTestWatchService()
	desc := testDeploymentDescriptor()
	registerDesc(svc, desc)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	notifier := newWatchNotifier(ctx, svc)

	gr := schema.GroupResource{Group: "apps", Resource: "deployments"}
	handler := makeHandler(gr, notifier, svc)

	// Simulate an informer resync: old and new have the same ResourceVersion.
	oldObj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "42",
	}}
	newObj := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "42",
	}}
	handler.OnUpdate(oldObj, newObj)

	// No event should be enqueued.
	select {
	case evt := <-notifier.pending:
		t.Fatalf("expected no event for same ResourceVersion, got %+v", evt)
	default:
		// Success — no event.
	}

	// Now verify a real update (different RV) does enqueue.
	newObj2 := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name: "same-rv", Namespace: "default", ResourceVersion: "43",
	}}
	handler.OnUpdate(oldObj, newObj2)

	select {
	case evt := <-notifier.pending:
		if evt.eventType != watchEventUpdate {
			t.Fatalf("expected update event, got %d", evt.eventType)
		}
	default:
		t.Fatal("expected an update event for changed ResourceVersion")
	}
}

func TestReactiveUpdatesDisabledByFlag(t *testing.T) {
	svc := NewService(Dependencies{Now: time.Now}, &Options{EnableReactiveUpdates: false})
	if svc.opts.EnableReactiveUpdates {
		t.Fatal("expected false when explicitly disabled")
	}
	svc2 := NewService(Dependencies{Now: time.Now}, nil)
	if !svc2.opts.EnableReactiveUpdates {
		t.Fatal("expected true by default")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -run "TestFlush|TestWatch|TestReactive|TestRegister" -v -count=1`
Expected: FAIL — types not defined.

- [ ] **Step 3: Create watch.go with all implementation code**

Create `backend/objectcatalog/watch.go`:

```go
/*
 * backend/objectcatalog/watch.go
 *
 * Informer-driven incremental catalog updates.
 */

package objectcatalog

import (
	"context"
	"time"

	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

type watchEventType int

const (
	watchEventAdd watchEventType = iota
	watchEventUpdate
	watchEventDelete
)

type watchEvent struct {
	eventType watchEventType
	gvr       string
	key       string
	obj       metav1.Object
}

const (
	watchPendingBufferSize = 8192
	watchDebounceInterval  = 200 * time.Millisecond
)

// watchInformerAccessor maps GroupResource to informer accessors.
// Mirrors sharedInformerListers in informer_registry.go but returns the
// informer handle needed for AddEventHandler.
var watchInformerAccessor = map[schema.GroupResource]func(informers.SharedInformerFactory) cache.SharedIndexInformer{
	{Group: "", Resource: "pods"}:                                          func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Pods().Informer() },
	{Group: "apps", Resource: "deployments"}:                               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().Deployments().Informer() },
	{Group: "apps", Resource: "statefulsets"}:                              func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().StatefulSets().Informer() },
	{Group: "apps", Resource: "daemonsets"}:                                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().DaemonSets().Informer() },
	{Group: "apps", Resource: "replicasets"}:                               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Apps().V1().ReplicaSets().Informer() },
	{Group: "batch", Resource: "jobs"}:                                     func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Batch().V1().Jobs().Informer() },
	{Group: "batch", Resource: "cronjobs"}:                                 func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Batch().V1().CronJobs().Informer() },
	{Group: "", Resource: "services"}:                                      func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Services().Informer() },
	{Group: "discovery.k8s.io", Resource: "endpointslices"}:                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Discovery().V1().EndpointSlices().Informer() },
	{Group: "", Resource: "configmaps"}:                                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().ConfigMaps().Informer() },
	{Group: "", Resource: "secrets"}:                                       func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Secrets().Informer() },
	{Group: "", Resource: "persistentvolumeclaims"}:                        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().PersistentVolumeClaims().Informer() },
	{Group: "", Resource: "resourcequotas"}:                                func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().ResourceQuotas().Informer() },
	{Group: "", Resource: "limitranges"}:                                   func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().LimitRanges().Informer() },
	{Group: "networking.k8s.io", Resource: "ingresses"}:                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Networking().V1().Ingresses().Informer() },
	{Group: "networking.k8s.io", Resource: "networkpolicies"}:              func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Networking().V1().NetworkPolicies().Informer() },
	{Group: "autoscaling", Resource: "horizontalpodautoscalers"}:           func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Autoscaling().V1().HorizontalPodAutoscalers().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}:        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().ClusterRoles().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}: func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().ClusterRoleBindings().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "roles"}:               func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().Roles().Informer() },
	{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}:        func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Rbac().V1().RoleBindings().Informer() },
	{Group: "", Resource: "namespaces"}:                                    func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Namespaces().Informer() },
	{Group: "", Resource: "nodes"}:                                         func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().Nodes().Informer() },
	{Group: "", Resource: "persistentvolumes"}:                             func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Core().V1().PersistentVolumes().Informer() },
	{Group: "storage.k8s.io", Resource: "storageclasses"}:                 func(f informers.SharedInformerFactory) cache.SharedIndexInformer { return f.Storage().V1().StorageClasses().Informer() },
}

type watchNotifier struct {
	service *Service
	pending chan watchEvent
	ctx     context.Context
}

func newWatchNotifier(ctx context.Context, svc *Service) *watchNotifier {
	return &watchNotifier{
		service: svc,
		pending: make(chan watchEvent, watchPendingBufferSize),
		ctx:     ctx,
	}
}

// flush applies a batch of watch events to the catalog.
func (n *watchNotifier) flush(events []watchEvent) {
	if len(events) == 0 {
		return
	}
	// sync() parallel goroutines write to the aliased s.items/newItems map
	// without holding s.mu. Skip to avoid a concurrent-write race.
	if n.service.syncInProgress.Load() {
		return
	}

	s := n.service
	changed := false

	s.mu.Lock()
	for _, evt := range events {
		desc, ok := s.resources[evt.gvr]
		if !ok {
			continue
		}
		switch evt.eventType {
		case watchEventAdd, watchEventUpdate:
			if evt.obj == nil {
				continue
			}
			s.items[evt.key] = s.buildSummary(desc, evt.obj)
			s.lastSeen[evt.key] = s.now()
			changed = true
		case watchEventDelete:
			if _, exists := s.items[evt.key]; exists {
				delete(s.items, evt.key)
				delete(s.lastSeen, evt.key)
				changed = true
			}
		}
	}
	if !changed {
		s.mu.Unlock()
		return
	}
	itemsCopy := cloneSummaryMap(s.items)
	s.mu.Unlock()

	// Descriptors() acquires s.mu.RLock — must call after Unlock.
	descriptors := s.Descriptors()
	// rebuildCacheFromItems calls publishStreamingState which acquires s.mu.Lock.
	s.rebuildCacheFromItems(itemsCopy, descriptors)
	s.broadcastStreaming(true)
}

// run collects events and flushes in debounced batches.
func (n *watchNotifier) run() {
	var batch []watchEvent
	var timer *time.Timer
	var timerC <-chan time.Time

	for {
		select {
		case <-n.ctx.Done():
			if len(batch) > 0 {
				n.flush(batch)
			}
			if timer != nil {
				timer.Stop()
			}
			return
		case evt, ok := <-n.pending:
			if !ok {
				if len(batch) > 0 {
					n.flush(batch)
				}
				return
			}
			batch = append(batch, evt)
			if timer == nil {
				timer = time.NewTimer(watchDebounceInterval)
				timerC = timer.C
			} else {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(watchDebounceInterval)
			}
		case <-timerC:
			if len(batch) > 0 {
				n.flush(batch)
				batch = nil
			}
			timer = nil
			timerC = nil
		}
	}
}

// send enqueues a watch event. Drops if buffer is full.
func (n *watchNotifier) send(evt watchEvent) {
	select {
	case n.pending <- evt:
	default:
		if n.service.deps.Logger != nil {
			n.service.logWarn("catalog watch notifier buffer full, dropping event")
		}
	}
}

// makeHandler builds an informer event handler that sends watch events for the given GroupResource.
func makeHandler(gr schema.GroupResource, notifier *watchNotifier, svc *Service) cache.ResourceEventHandlerFuncs {
	return cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			metaObj, ok := toMetaObject(obj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventAdd,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       metaObj,
			})
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			// Skip no-op updates from informer resync.
			if oldMeta, ok := toMetaObject(oldObj); ok {
				if newMeta, ok := toMetaObject(newObj); ok {
					if oldMeta.GetResourceVersion() == newMeta.GetResourceVersion() {
						return
					}
				}
			}
			metaObj, ok := toMetaObject(newObj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventUpdate,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       metaObj,
			})
		},
		DeleteFunc: func(obj interface{}) {
			if d, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				obj = d.Obj
			}
			metaObj, ok := toMetaObject(obj)
			if !ok {
				return
			}
			gvr, desc := svc.resolveGRToDescriptor(gr)
			if desc == nil {
				return
			}
			notifier.send(watchEvent{
				eventType: watchEventDelete,
				gvr:       gvr,
				key:       catalogKey(*desc, metaObj.GetNamespace(), metaObj.GetName()),
				obj:       nil,
			})
		},
	}
}

// registerWatchHandlers attaches event handlers to shared informers.
func registerWatchHandlers(
	factory informers.SharedInformerFactory,
	apiextFactory apiextinformers.SharedInformerFactory,
	notifier *watchNotifier,
	svc *Service,
) {
	if factory == nil {
		return
	}
	for gr, accessor := range watchInformerAccessor {
		inf := accessor(factory)
		if inf == nil {
			continue
		}
		inf.AddEventHandler(makeHandler(gr, notifier, svc))
	}
	if apiextFactory != nil {
		crdInformer := apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Informer()
		gr := schema.GroupResource{Group: "apiextensions.k8s.io", Resource: "customresourcedefinitions"}
		crdInformer.AddEventHandler(makeHandler(gr, notifier, svc))
	}
}

func (s *Service) resolveGRToDescriptor(gr schema.GroupResource) (string, *resourceDescriptor) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for gvr, desc := range s.resources {
		if desc.Group == gr.Group && desc.Resource == gr.Resource {
			return gvr, &desc
		}
	}
	return "", nil
}

func toMetaObject(obj interface{}) (metav1.Object, bool) {
	if obj == nil {
		return nil, false
	}
	metaObj, ok := obj.(metav1.Object)
	return metaObj, ok
}
```

Note: the `makeHandler` function is extracted to avoid duplicating the Add/Update/Delete handler closures for both the main informer loop and the CRD informer. Both call `makeHandler` with the appropriate `GroupResource`.

- [ ] **Step 4: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -count=1 -v`
Expected: All PASS.

---

### Task 4: Wire notifier into runLoop()

**Files:**
- Modify: `backend/objectcatalog/sync.go:173-200`

- [ ] **Step 1: Add notifier startup after initial sync**

In `sync.go`, in `runLoop()`, after the initial sync call (line 180) and before the `ResyncInterval <= 0` check (line 182), add:

```go
// Start reactive update notifier if enabled.
if s.opts.EnableReactiveUpdates && s.deps.InformerFactory != nil {
	notifier := newWatchNotifier(ctx, s)
	registerWatchHandlers(s.deps.InformerFactory, s.deps.APIExtensionsInformerFactory, notifier, s)
	go notifier.run()
	s.logInfo("catalog reactive updates enabled")
}
```

- [ ] **Step 2: Extend resync interval when reactive updates are active**

Replace `ticker := time.NewTicker(s.opts.ResyncInterval)` (line 187) with:

```go
resyncInterval := s.opts.ResyncInterval
if s.opts.EnableReactiveUpdates && s.deps.InformerFactory != nil {
	// With reactive updates the full resync is a consistency safety net.
	if resyncInterval < 5*time.Minute {
		resyncInterval = 5 * time.Minute
	}
}
ticker := time.NewTicker(resyncInterval)
```

- [ ] **Step 3: Run all objectcatalog tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -count=1`
Expected: All PASS.

- [ ] **Step 4: Run full backend test suite**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/... -count=1 -timeout 300s`
Expected: All PASS.

---

## Item B: Frontend Refresh Robustness

### Task 5: Fix #2 — Document `upsertByUID` limitations

**Files:**
- Modify: `frontend/src/modules/browse/utils/browseUtils.ts:98-102`

- [ ] **Step 1: Add JSDoc warning**

Replace the existing comment above `upsertByUID` (lines 98-102):

```typescript
/**
 * Upserts incoming items into the current list by UID.
 * Updates existing items if their resourceVersion differs, appends new items.
 *
 * WARNING: This function only handles additions and updates — it never removes
 * items from `current` that are absent in `incoming`. Do NOT use this for
 * auto-refresh where deletions must be reflected. Use `dedupeByUID` with full
 * replacement instead. This function is only correct for append/pagination
 * (load-more) where the incoming set is additive by definition.
 */
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

---

### Task 6: Fix #3 — Manual fetch always hits snapshot endpoint

**Files:**
- Modify: `frontend/src/core/refresh/orchestrator.ts:1170-1185`

- [ ] **Step 1: Change the manual fetch path**

Replace lines 1173-1184:

```typescript
        if (options.isManual) {
          // Only use refreshOnce when the stream is already connected.
          // If the stream is still being set up (e.g. WebSocket handshake
          // in progress), fall through to a snapshot fetch so data arrives
          // immediately rather than waiting for the connection.
          if (this.isStreamingActive(domain, normalizedScope)) {
            await this.refreshStreamingDomainOnce(domain, normalizedScope);
            return;
          }
        } else {
          this.startStreamingScope(domain, normalizedScope, config.streaming);
        }
```

With:

```typescript
        if (options.isManual) {
          // For resource-stream (WebSocket) domains, use refreshOnce when
          // the stream is already connected for immediate delta delivery.
          // For SSE domains (catalog, events), always fall through to a
          // snapshot fetch — the SSE stream delivers full snapshots on its
          // own schedule and refreshStreamingDomainOnce just restarts the
          // connection, which is wasteful for a manual refresh.
          if (this.isResourceStreamDomain(domain) && this.isStreamingActive(domain, normalizedScope)) {
            await this.refreshStreamingDomainOnce(domain, normalizedScope);
            return;
          }
          // SSE domains and inactive streams fall through to performFetch.
        } else {
          this.startStreamingScope(domain, normalizedScope, config.streaming);
        }
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

---

### Task 7: Fix #4 — SSE stream health tracking

**Files:**
- Modify: `frontend/src/core/refresh/streaming/catalogStreamManager.ts:80-96`
- Modify: `frontend/src/core/refresh/orchestrator.ts:822-827`

- [ ] **Step 1: Add `lastEventAt` and `isHealthy` to CatalogStreamManager**

In `catalogStreamManager.ts`, add a field after `lastFallbackAt` (line 92):

```typescript
private lastEventAt = 0;
```

In `handleMessage` (around line 240), after the `isValidCatalogStreamEvent` check succeeds, add:

```typescript
this.lastEventAt = Date.now();
```

Add a public method after the `stop` method:

```typescript
/** Reports whether the catalog stream has delivered data recently. */
isHealthy(): boolean {
  if (!this.eventSource || this.closed) {
    return false;
  }
  // Consider healthy if we received an event within the last 90 seconds.
  // The catalog sync runs every 60s (or 5min with reactive updates),
  // so 90s gives margin for one missed cycle.
  return this.lastEventAt > 0 && Date.now() - this.lastEventAt < 90_000;
}
```

- [ ] **Step 2: Extend `isStreamingHealthy` in the orchestrator**

In `orchestrator.ts`, replace `isStreamingHealthy` (lines 822-827):

```typescript
  private isStreamingHealthy(domain: RefreshDomain, scope?: string): boolean {
    if (!scope) {
      return false;
    }
    if (this.isResourceStreamDomain(domain)) {
      return resourceStreamManager.isHealthy(domain, scope);
    }
    // SSE-based streaming domains: check the stream manager directly.
    if (domain === 'catalog') {
      return catalogStreamManager.isHealthy();
    }
    return false;
  }
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

---

### Task 8: Fix #5 — Document `DEFAULT_AUTO_START`

**Files:**
- Modify: `frontend/src/core/refresh/orchestrator.ts:89`

- [ ] **Step 1: Add explanatory comment**

Replace line 89:

```typescript
const DEFAULT_AUTO_START = false;
```

With:

```typescript
// Refreshers are disabled at registration by default. Most domains rely on
// view hooks (e.g. ClusterResourcesContext, useBrowseCatalog) to enable
// scopes on demand rather than polling from app startup. Changing this to
// true would cause all streaming domains to start polling immediately at
// registration, regardless of whether the user is on the relevant view.
// Set autoStart: true on individual domain registrations when needed.
const DEFAULT_AUTO_START = false;
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

---

### Task 9: Final verification

- [ ] **Step 1: Run full Go test suite**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./... -count=1 -timeout 600s`
Expected: All PASS.

- [ ] **Step 2: Run frontend TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Build the app**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: No errors.

- [ ] **Step 4: Verify feature flag**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/objectcatalog/... -run TestReactiveUpdatesDisabledByFlag -v -count=1`
Expected: PASS — confirms `EnableReactiveUpdates: false` disables, default enables.
