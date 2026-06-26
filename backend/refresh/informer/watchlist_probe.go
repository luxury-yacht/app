package informer

import (
	"context"
	"os"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"
	"k8s.io/klog/v2"
	"k8s.io/utils/ptr"
)

// WatchList (KEP-3157) streams a GVR's initial state as ADDED events terminated
// by a bookmark carrying the `k8s.io/initial-events-end: "true"` annotation;
// client-go's reflector treats that terminal bookmark as "initial sync
// complete". A bookmark-stripping proxy (for example Teleport #64188) can drop
// that terminal bookmark, leaving the reflector to wait forever — the GVR never
// reaches readiness and the whole cluster wedges.
//
// client-go v0.36 defaults the WatchListClient feature gate ON, so every
// informer uses WatchList. This file probes whether the cluster's apiserver
// (through whatever proxy is in front of it) actually delivers the terminal
// bookmark, and if not, disables the process-global gate so informers fall back
// to the safe LIST+WATCH path before the first informer factory reads the gate.

// watchListProbeTimeout bounds how long startup waits for the terminal
// initial-events-end bookmark before deciding WatchList is unavailable. A false
// negative only falls back to LIST+WATCH, so keep this below the user-visible
// first-load budget.
const watchListProbeTimeout = time.Second

// watchListEnvVar is the client-go feature-gate environment variable that
// controls the WatchListClient gate. client-go reads it lazily (cached on first
// use via sync.Once in k8s.io/client-go/features), so setting it before the
// first informer watch takes effect.
const watchListEnvVar = "KUBE_FEATURE_WatchListClient"

// watchListDecisionOnce guards EnsureWatchListDecision so the probe runs at most
// once per process, regardless of how many clusters are connected.
var watchListDecisionOnce sync.Once

// ProbeWatchListSupport reports whether the apiserver delivers the WatchList
// terminal bookmark for a SendInitialEvents watch. It issues an EXPLICIT watch
// (SendInitialEvents + ResourceVersionMatchNotOlderThan), so it exercises the
// WatchList semantics directly and does not depend on the process-global feature
// gate — it works as a probe whether the gate is on or off.
//
// It returns ok=true only when a bookmark carrying the
// `k8s.io/initial-events-end: "true"` annotation arrives before the timeout.
// Any of: the watch failing to open, SendInitialEvents being unsupported, the
// stream erroring, the stream closing without the bookmark, or the timeout
// firing, yields ok=false — so the caller falls back to LIST+WATCH, which is
// always safe.
func ProbeWatchListSupport(ctx context.Context, client kubernetes.Interface, timeout time.Duration) (ok bool, err error) {
	if client == nil {
		return false, nil
	}
	if timeout <= 0 {
		timeout = watchListProbeTimeout
	}

	watchCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	w, err := client.CoreV1().Namespaces().Watch(watchCtx, metav1.ListOptions{
		ResourceVersion:      "0",
		ResourceVersionMatch: metav1.ResourceVersionMatchNotOlderThan,
		SendInitialEvents:    ptr.To(true),
		AllowWatchBookmarks:  true,
	})
	if err != nil {
		// The server (or proxy) rejected the SendInitialEvents watch outright —
		// treat WatchList as unavailable and fall back to LIST+WATCH.
		return false, err
	}
	// Stop the watch on every return path so the probe never leaks a goroutine
	// or an open connection.
	defer w.Stop()

	for {
		select {
		case <-watchCtx.Done():
			// Timeout (or parent cancellation) before the terminal bookmark —
			// the bookmark may have been stripped, or the cluster is slow. Either
			// way, fall back to LIST+WATCH.
			return false, nil
		case event, open := <-w.ResultChan():
			if !open {
				// Stream closed before the terminal bookmark arrived.
				return false, nil
			}
			if event.Type == watch.Error {
				// The server returned a *metav1.Status error mid-stream; WatchList
				// is not usable here.
				return false, nil
			}
			if event.Type != watch.Bookmark {
				continue
			}
			if isInitialEventsEndBookmark(event.Object) {
				return true, nil
			}
		}
	}
}

// isInitialEventsEndBookmark reports whether a Bookmark event's object carries
// the `k8s.io/initial-events-end: "true"` annotation that terminates the
// WatchList initial-events stream.
func isInitialEventsEndBookmark(obj interface{}) bool {
	accessor, err := meta.Accessor(obj)
	if err != nil {
		return false
	}
	return accessor.GetAnnotations()[metav1.InitialEventsAnnotationKey] == "true"
}

// EnsureWatchListDecision probes WatchList support once per process and, if the
// terminal bookmark does not arrive, disables the process-global WatchListClient
// feature gate so informers fall back to LIST+WATCH. It is idempotent: only the
// first call runs the probe (sync.Once), so calling it on every per-cluster
// factory build is fine.
//
// It MUST run before the first informer factory issues a watch, because
// client-go reads the gate lazily and caches it on first use.
func EnsureWatchListDecision(ctx context.Context, client kubernetes.Interface) {
	watchListDecisionOnce.Do(func() {
		ok, err := ProbeWatchListSupport(ctx, client, watchListProbeTimeout)
		if ok {
			// WatchList works end to end — leave the gate at its (on) default.
			return
		}
		// Disable the gate for the rest of the process. Logged exactly once.
		if setErr := os.Setenv(watchListEnvVar, "false"); setErr != nil {
			klog.Warningf("WatchList unavailable/stripped — failed to set %s=false: %v", watchListEnvVar, setErr)
			return
		}
		klog.Warningf("WatchList unavailable/stripped — using LIST+WATCH (probe error: %v)", err)
	})
}
