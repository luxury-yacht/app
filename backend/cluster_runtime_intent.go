package backend

import (
	"context"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/authstate"
)

type ClusterRuntimeIntentKind string

const (
	ClusterRuntimeIntentKubeconfigSourceChanged ClusterRuntimeIntentKind = "kubeconfig-source-changed"
	ClusterRuntimeIntentAuthRebuild             ClusterRuntimeIntentKind = "auth-rebuild"
	ClusterRuntimeIntentTransportRebuild        ClusterRuntimeIntentKind = "transport-rebuild"
)

// ClusterRuntimeIntent carries cluster-originated work across the one-way
// cluster-runtime -> workspace boundary. Generation lets the workspace owner
// reject stale work before performing side effects.
type ClusterRuntimeIntent struct {
	Kind       ClusterRuntimeIntentKind
	ClusterID  string
	Generation uint64
	Paths      []string
	Cause      string
	AuthState  authstate.State
	Diagnostic authstate.FailureDiagnostic
}

type clusterRuntimeIntentKey struct {
	kind      ClusterRuntimeIntentKind
	clusterID string
}

// clusterRuntimeIntentQueue stores only the latest pending intent for each
// kind/cluster pair. The single buffered wakeup makes Publish non-blocking while
// retaining pending state until the consumer drains it.
type clusterRuntimeIntentQueue struct {
	mu      sync.Mutex
	pending map[clusterRuntimeIntentKey]ClusterRuntimeIntent
	wakeup  chan struct{}
	stopped chan struct{}
	stop    sync.Once
	closed  bool
}

func newClusterRuntimeIntentQueue() *clusterRuntimeIntentQueue {
	return &clusterRuntimeIntentQueue{
		pending: make(map[clusterRuntimeIntentKey]ClusterRuntimeIntent),
		wakeup:  make(chan struct{}, 1),
		stopped: make(chan struct{}),
	}
}

func (q *clusterRuntimeIntentQueue) Publish(intent ClusterRuntimeIntent) {
	if q == nil || intent.Kind == "" {
		return
	}
	select {
	case <-q.stopped:
		return
	default:
	}
	intent.Paths = append([]string(nil), intent.Paths...)
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return
	}
	q.pending[clusterRuntimeIntentKey{kind: intent.Kind, clusterID: intent.ClusterID}] = intent
	q.mu.Unlock()
	select {
	case q.wakeup <- struct{}{}:
	default:
	}
}

func (q *clusterRuntimeIntentQueue) Drain() []ClusterRuntimeIntent {
	if q == nil {
		return nil
	}
	q.mu.Lock()
	intents := make([]ClusterRuntimeIntent, 0, len(q.pending))
	for key, intent := range q.pending {
		intents = append(intents, intent)
		delete(q.pending, key)
	}
	q.mu.Unlock()
	sort.Slice(intents, func(i, j int) bool {
		if intents[i].Generation != intents[j].Generation {
			return intents[i].Generation < intents[j].Generation
		}
		if intents[i].Kind != intents[j].Kind {
			return intents[i].Kind < intents[j].Kind
		}
		return intents[i].ClusterID < intents[j].ClusterID
	})
	return intents
}

func (q *clusterRuntimeIntentQueue) Consume(ctx context.Context, handle func(ClusterRuntimeIntent)) {
	if q == nil || handle == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-q.stopped:
			return
		case <-q.wakeup:
			for _, intent := range q.Drain() {
				handle(intent)
			}
		}
	}
}

func (q *clusterRuntimeIntentQueue) Stop() {
	if q != nil {
		q.stop.Do(func() {
			q.mu.Lock()
			q.closed = true
			clear(q.pending)
			q.mu.Unlock()
			close(q.stopped)
		})
	}
}

func (a *WorkspaceCoordinator) acceptClusterRuntimeIntent(intent ClusterRuntimeIntent) bool {
	if a == nil || intent.Kind == "" || intent.Generation == 0 {
		return false
	}
	key := clusterRuntimeIntentKey{kind: intent.Kind, clusterID: intent.ClusterID}
	a.clusterIntentMu.Lock()
	defer a.clusterIntentMu.Unlock()
	if a.clusterIntentLatest == nil {
		a.clusterIntentLatest = make(map[clusterRuntimeIntentKey]uint64)
	}
	if intent.Generation <= a.clusterIntentLatest[key] {
		return false
	}
	a.clusterIntentLatest[key] = intent.Generation
	return true
}

func (a *WorkspaceCoordinator) clusterRuntimeIntentIsCurrent(intent ClusterRuntimeIntent) bool {
	if a == nil || intent.Kind == "" || intent.Generation == 0 {
		return false
	}
	key := clusterRuntimeIntentKey{kind: intent.Kind, clusterID: intent.ClusterID}
	a.clusterIntentMu.Lock()
	defer a.clusterIntentMu.Unlock()
	return a.clusterIntentLatest[key] == intent.Generation
}
