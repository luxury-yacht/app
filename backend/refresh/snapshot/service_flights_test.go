package snapshot

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/stretchr/testify/require"
)

type snapshotBuildResult struct {
	snapshot *refresh.Snapshot
	err      error
}

func TestServiceBuildLeaderCancellationDoesNotCancelFollower(t *testing.T) {
	registry := domain.New()
	started := make(chan struct{})
	release := make(chan struct{})
	buildCanceled := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	var mu sync.Mutex
	builds := 0
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "shared-build",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			mu.Lock()
			builds++
			if builds == 1 {
				close(started)
			}
			mu.Unlock()

			select {
			case <-ctx.Done():
				select {
				case <-buildCanceled:
				default:
					close(buildCanceled)
				}
				return nil, ctx.Err()
			case <-release:
				return &refresh.Snapshot{Domain: "shared-build", Scope: scope}, nil
			}
		},
	}))
	service := NewServiceWithPermissions(registry, nil, testClusterMeta(), nil)

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	leaderResult := make(chan snapshotBuildResult, 1)
	go func() {
		snapshot, err := service.Build(leaderCtx, "shared-build", "cluster-a|scope")
		leaderResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	<-started

	followerResult := make(chan snapshotBuildResult, 1)
	go func() {
		snapshot, err := service.Build(context.Background(), "shared-build", "cluster-a|scope")
		followerResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	require.Never(t, func() bool {
		select {
		case <-followerResult:
			return true
		default:
			return false
		}
	}, 50*time.Millisecond, time.Millisecond, "follower must join the blocked build")

	cancelLeader()
	result := requireResult(t, leaderResult)
	require.ErrorIs(t, result.err, context.Canceled)
	require.Never(t, func() bool {
		select {
		case <-buildCanceled:
			return true
		default:
			return false
		}
	}, 50*time.Millisecond, time.Millisecond, "a live follower must keep the shared build alive")

	releaseOnce.Do(func() { close(release) })
	result = requireResult(t, followerResult)
	require.NoError(t, result.err)
	require.NotNil(t, result.snapshot)
	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, 1, builds)
}

func TestServiceBuildCancelsSharedWorkAfterEveryWaiterLeaves(t *testing.T) {
	registry := domain.New()
	started := make(chan struct{})
	buildCanceled := make(chan struct{})
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "shared-build",
		BuildSnapshot: func(ctx context.Context, _ string) (*refresh.Snapshot, error) {
			close(started)
			<-ctx.Done()
			close(buildCanceled)
			return nil, ctx.Err()
		},
	}))
	service := NewServiceWithPermissions(registry, nil, testClusterMeta(), nil)

	leaderCtx, cancelLeader := context.WithCancel(context.Background())
	followerCtx, cancelFollower := context.WithCancel(context.Background())
	leaderResult := make(chan snapshotBuildResult, 1)
	followerResult := make(chan snapshotBuildResult, 1)
	go func() {
		snapshot, err := service.Build(leaderCtx, "shared-build", "cluster-a|scope")
		leaderResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	<-started
	go func() {
		snapshot, err := service.Build(followerCtx, "shared-build", "cluster-a|scope")
		followerResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	require.Never(t, func() bool {
		select {
		case <-followerResult:
			return true
		default:
			return false
		}
	}, 50*time.Millisecond, time.Millisecond, "follower must join the blocked build")

	cancelLeader()
	require.ErrorIs(t, requireResult(t, leaderResult).err, context.Canceled)
	select {
	case <-buildCanceled:
		t.Fatal("shared work stopped while the follower was still waiting")
	default:
	}

	cancelFollower()
	require.ErrorIs(t, requireResult(t, followerResult).err, context.Canceled)
	select {
	case <-buildCanceled:
	case <-time.After(2 * time.Second):
		t.Fatal("shared work was not canceled after every waiter left")
	}
}

func TestServiceCancelInFlightStopsCurrentBuildAndAllowsFreshBuild(t *testing.T) {
	registry := domain.New()
	started := make(chan struct{})
	var mu sync.Mutex
	builds := 0
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "generation-build",
		BuildSnapshot: func(ctx context.Context, scope string) (*refresh.Snapshot, error) {
			mu.Lock()
			builds++
			build := builds
			mu.Unlock()
			if build == 1 {
				close(started)
				<-ctx.Done()
				return nil, ctx.Err()
			}
			return &refresh.Snapshot{Domain: "generation-build", Scope: scope}, nil
		},
	}))
	service := NewServiceWithPermissions(registry, nil, testClusterMeta(), nil)

	firstResult := make(chan snapshotBuildResult, 1)
	go func() {
		snapshot, err := service.Build(context.Background(), "generation-build", "cluster-a|scope")
		firstResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	<-started

	service.CancelInFlight()
	require.ErrorIs(t, requireResult(t, firstResult).err, context.Canceled)

	snapshot, err := service.Build(context.Background(), "generation-build", "cluster-a|scope")
	require.NoError(t, err)
	require.NotNil(t, snapshot)
	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, 2, builds)
}

func TestServiceCancelInFlightStopsReadinessWaitAndAllowsFreshBuild(t *testing.T) {
	registry := domain.New()
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "readiness-build",
		BuildSnapshot: func(_ context.Context, scope string) (*refresh.Snapshot, error) {
			return &refresh.Snapshot{Domain: "readiness-build", Scope: scope}, nil
		},
	}))
	hub := &fakeInformerHub{}
	service := NewServiceWithPermissions(registry, nil, testClusterMeta(), nil).WithInformerHub(hub)
	service.informerSyncTimeout = 5 * time.Second

	firstResult := make(chan snapshotBuildResult, 1)
	go func() {
		snapshot, err := service.Build(context.Background(), "readiness-build", "cluster-a|scope")
		firstResult <- snapshotBuildResult{snapshot: snapshot, err: err}
	}()
	require.Never(t, func() bool {
		select {
		case <-firstResult:
			return true
		default:
			return false
		}
	}, 50*time.Millisecond, time.Millisecond, "build must be waiting for readiness")

	service.CancelInFlight()
	select {
	case result := <-firstResult:
		require.ErrorIs(t, result.err, context.Canceled)
	case <-time.After(500 * time.Millisecond):
		hub.setSynced(true)
		t.Fatal("generation cancellation did not stop the readiness wait")
	}

	hub.setSynced(true)
	snapshot, err := service.Build(context.Background(), "readiness-build", "cluster-a|scope")
	require.NoError(t, err)
	require.NotNil(t, snapshot)
}

func requireResult(t *testing.T, results <-chan snapshotBuildResult) snapshotBuildResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for snapshot build result")
		return snapshotBuildResult{}
	}
}

type recordedPanic struct {
	recovered any
	message   string
}

type panicRecordingLogger struct {
	mu     sync.Mutex
	panics []recordedPanic
}

func (*panicRecordingLogger) Debug(string, ...string) {}
func (*panicRecordingLogger) Info(string, ...string)  {}
func (*panicRecordingLogger) Warn(string, ...string)  {}
func (*panicRecordingLogger) Error(string, ...string) {}
func (l *panicRecordingLogger) Panic(recovered any, message string, _ ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.panics = append(l.panics, recordedPanic{recovered: recovered, message: message})
}

// A panicking build fails the request with a short message the UI can show;
// the panic itself, with its stack, goes to the backend's panic report.
func TestServiceBuildPanicIsReportedNotShown(t *testing.T) {
	registry := domain.New()
	require.NoError(t, registry.Register(refresh.DomainConfig{
		Name: "panicking",
		BuildSnapshot: func(context.Context, string) (*refresh.Snapshot, error) {
			panic("boom")
		},
	}))
	logger := &panicRecordingLogger{}
	service := NewServiceWithPermissions(registry, nil, testClusterMeta(), nil).WithLogger(logger)

	_, err := service.Build(context.Background(), "panicking", "cluster-a|scope")

	require.EqualError(t, err, "snapshot build panic: boom")
	logger.mu.Lock()
	defer logger.mu.Unlock()
	require.Len(t, logger.panics, 1)
	require.Equal(t, "boom", logger.panics[0].recovered)
}
