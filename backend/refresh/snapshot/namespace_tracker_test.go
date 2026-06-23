package snapshot

import (
	"fmt"
	"sync"
	"testing"
)

// trackerKey is the "namespace/name" key the tracker stores presence under — the same key
// the ingest sinks derive from a projected row's namespace/name (and the typed event path
// derived via meta.Accessor before the cut). The tests add/remove through addNamespaceKey/
// deleteNamespaceKey, the sink-facing core, exercising the same state machine the sinks feed.
func trackerKey(namespace, name string) string {
	return namespace + "/" + name
}

func TestNamespaceWorkloadTrackerAddRemove(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.addNamespaceKey(resourceDeployment, "alpha", trackerKey("alpha", "web"))
	tracker.addNamespaceKey(resourcePod, "alpha", trackerKey("alpha", "web-123"))

	if has, known := tracker.HasWorkloads("alpha"); !has || !known {
		t.Fatalf("expected workloads present and known, got has=%t known=%t", has, known)
	}

	tracker.deleteNamespaceKey(resourceDeployment, "alpha", trackerKey("alpha", "web"))
	tracker.deleteNamespaceKey(resourcePod, "alpha", trackerKey("alpha", "web-123"))

	if has, known := tracker.HasWorkloads("alpha"); has || !known {
		t.Fatalf("expected no workloads and known=true, got has=%t known=%t", has, known)
	}
}

func TestNamespaceWorkloadTrackerSeparateNamespaces(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.addNamespaceKey(resourceDeployment, "alpha", trackerKey("alpha", "web"))
	tracker.addNamespaceKey(resourceStateful, "beta", trackerKey("beta", "db"))
	tracker.addNamespaceKey(resourcePod, "alpha", trackerKey("alpha", "web-1"))

	if has, known := tracker.HasWorkloads("alpha"); !has || !known {
		t.Fatalf("expected namespace alpha to be marked with workloads, got has=%t known=%t", has, known)
	}

	if has, known := tracker.HasWorkloads("beta"); !has || !known {
		t.Fatalf("expected namespace beta to be marked with workloads, got has=%t known=%t", has, known)
	}

	tracker.deleteNamespaceKey(resourceDeployment, "alpha", trackerKey("alpha", "web"))
	tracker.deleteNamespaceKey(resourcePod, "alpha", trackerKey("alpha", "web-1"))

	if has, known := tracker.HasWorkloads("alpha"); has || !known {
		t.Fatalf("expected namespace alpha to be empty and known after deletions, got has=%t known=%t", has, known)
	}

	if has, known := tracker.HasWorkloads("beta"); !has || !known {
		t.Fatalf("namespace beta should remain with workloads while alpha cleared, got has=%t known=%t", has, known)
	}
}

func TestNamespaceWorkloadTrackerUnknownOnMixedDelete(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.addNamespaceKey(resourceCronJob, "gamma", trackerKey("gamma", "nightly"))

	// Delete succeeds once, unknown deletion should flip to unknown state.
	tracker.deleteNamespaceKey(resourceCronJob, "gamma", trackerKey("gamma", "nightly"))
	tracker.deleteNamespaceKey(resourceCronJob, "gamma", trackerKey("gamma", "nightly"))

	if has, known := tracker.HasWorkloads("gamma"); has || known {
		t.Fatalf("expected namespace gamma to be unknown after redundant delete, got has=%t known=%t", has, known)
	}
}

func TestNamespaceWorkloadTrackerConcurrentNamespaces(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	var wg sync.WaitGroup
	namespaces := []string{"alpha", "beta", "gamma", "delta"}
	resources := []workloadResource{resourceDeployment, resourceStateful, resourceDaemon, resourceJob, resourceCronJob, resourcePod}

	for _, ns := range namespaces {
		ns := ns
		for idx, res := range resources {
			wg.Add(1)
			go func(i int, r workloadResource) {
				defer wg.Done()
				name := fmt.Sprintf("%s-%d", ns, i)
				tracker.addNamespaceKey(r, ns, trackerKey(ns, name))
			}(idx, res)
		}
	}

	wg.Wait()

	for _, ns := range namespaces {
		if has, known := tracker.HasWorkloads(ns); !has || !known {
			t.Fatalf("expected namespace %s to have workloads after concurrent adds, got has=%t known=%t", ns, has, known)
		}
	}

	for _, ns := range namespaces {
		for idx, res := range resources {
			name := fmt.Sprintf("%s-%d", ns, idx)
			tracker.deleteNamespaceKey(res, ns, trackerKey(ns, name))
		}
	}

	for _, ns := range namespaces {
		if has, known := tracker.HasWorkloads(ns); has || !known {
			t.Fatalf("expected namespace %s to be empty after deletions, got has=%t known=%t", ns, has, known)
		}
	}
}

func TestNamespaceWorkloadTrackerUnknownOnUnexpectedDelete(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.deleteNamespaceKey(resourceJob, "beta", trackerKey("beta", "cleanup"))

	if has, known := tracker.HasWorkloads("beta"); has || known {
		t.Fatalf("expected unknown state after unexpected delete, got has=%t known=%t", has, known)
	}
}

func TestNamespaceWorkloadTrackerMarkUnknown(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.MarkUnknown("gamma")

	if has, known := tracker.HasWorkloads("gamma"); has || known {
		t.Fatalf("expected unknown state after mark, got has=%t known=%t", has, known)
	}
}
