package informer

import (
	"context"
	"errors"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiruntime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/watch"
	clientfeatures "k8s.io/client-go/features"
	clientfeaturestesting "k8s.io/client-go/features/testing"
	"k8s.io/client-go/tools/cache"
)

type testClientFeatureGates struct {
	enabled bool
	err     error
}

func (g *testClientFeatureGates) Enabled(clientfeatures.Feature) bool { return g.enabled }

func (g *testClientFeatureGates) Set(_ clientfeatures.Feature, enabled bool) error {
	if g.err != nil {
		return g.err
	}
	g.enabled = enabled
	return nil
}

type readOnlyClientFeatureGates struct{}

func (readOnlyClientFeatureGates) Enabled(clientfeatures.Feature) bool { return true }

func TestDisableWatchListMakesReflectorListBeforeWatch(t *testing.T) {
	clientfeaturestesting.SetFeatureDuringTest(t, clientfeatures.WatchListClient, true)
	if err := DisableWatchList(); err != nil {
		t.Fatalf("DisableWatchList: %v", err)
	}

	listOptions := make(chan metav1.ListOptions, 1)
	watchOptions := make(chan metav1.ListOptions, 1)
	watcher := watch.NewRaceFreeFake()
	lw := &cache.ListWatch{
		ListWithContextFunc: func(context.Context, metav1.ListOptions) (apiruntime.Object, error) {
			listOptions <- metav1.ListOptions{}
			return &corev1.PodList{ListMeta: metav1.ListMeta{ResourceVersion: "1"}}, nil
		},
		WatchFuncWithContext: func(_ context.Context, options metav1.ListOptions) (watch.Interface, error) {
			watchOptions <- options
			return watcher, nil
		},
	}
	reflector := cache.NewReflector(
		cache.ToListWatcherWithWatchListSemantics(lw, struct{}{}),
		&corev1.Pod{},
		cache.NewStore(cache.MetaNamespaceKeyFunc),
		0,
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		reflector.Run(ctx.Done())
	}()

	select {
	case <-listOptions:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("reflector did not issue its initial LIST")
	}
	select {
	case options := <-watchOptions:
		if options.SendInitialEvents != nil && *options.SendInitialEvents {
			cancel()
			t.Fatal("reflector issued a WatchList request, want an ordinary WATCH after LIST")
		}
	case <-time.After(time.Second):
		cancel()
		t.Fatal("reflector did not issue its WATCH after the initial LIST")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("reflector did not stop after cancellation")
	}
}

func TestDisableWatchListRejectsFeatureGateOverrideFailures(t *testing.T) {
	t.Run("read-only feature gates", func(t *testing.T) {
		err := disableWatchList(readOnlyClientFeatureGates{})
		if err == nil {
			t.Fatal("disableWatchList succeeded with read-only feature gates")
		}
	})

	t.Run("setter error", func(t *testing.T) {
		err := disableWatchList(&testClientFeatureGates{enabled: true, err: errors.New("locked")})
		if err == nil {
			t.Fatal("disableWatchList succeeded when the feature-gate setter failed")
		}
	})

	t.Run("override did not stick", func(t *testing.T) {
		gates := &testClientFeatureGates{enabled: true}
		setter := stickyEnabledFeatureGates{testClientFeatureGates: gates}
		err := disableWatchList(setter)
		if err == nil {
			t.Fatal("disableWatchList succeeded while WatchList remained enabled")
		}
	})
}

type stickyEnabledFeatureGates struct {
	*testClientFeatureGates
}

func (stickyEnabledFeatureGates) Set(clientfeatures.Feature, bool) error { return nil }
