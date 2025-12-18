package snapshot

import (
	"fmt"
	"sync"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestNamespaceWorkloadTrackerAddRemove(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	deployment := &appsv1.Deployment{ObjectMeta: objectMeta("alpha", "web")}
	pod := &corev1.Pod{ObjectMeta: objectMeta("alpha", "web-123")}

	tracker.handleAdd(deployment, resourceDeployment)
	tracker.handleAdd(pod, resourcePod)

	if has, known := tracker.HasWorkloads("alpha"); !has || !known {
		t.Fatalf("expected workloads present and known, got has=%t known=%t", has, known)
	}

	tracker.handleDelete(deployment, resourceDeployment)
	tracker.handleDelete(pod, resourcePod)

	if has, known := tracker.HasWorkloads("alpha"); has || !known {
		t.Fatalf("expected no workloads and known=true, got has=%t known=%t", has, known)
	}
}

func TestNamespaceWorkloadTrackerSeparateNamespaces(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	alphaDeploy := &appsv1.Deployment{ObjectMeta: objectMeta("alpha", "web")}
	betaStateful := &appsv1.StatefulSet{ObjectMeta: objectMeta("beta", "db")}
	alphaPod := &corev1.Pod{ObjectMeta: objectMeta("alpha", "web-1")}

	tracker.handleAdd(alphaDeploy, resourceDeployment)
	tracker.handleAdd(betaStateful, resourceStateful)
	tracker.handleAdd(alphaPod, resourcePod)

	if has, known := tracker.HasWorkloads("alpha"); !has || !known {
		t.Fatalf("expected namespace alpha to be marked with workloads, got has=%t known=%t", has, known)
	}

	if has, known := tracker.HasWorkloads("beta"); !has || !known {
		t.Fatalf("expected namespace beta to be marked with workloads, got has=%t known=%t", has, known)
	}

	tracker.handleDelete(alphaDeploy, resourceDeployment)
	tracker.handleDelete(alphaPod, resourcePod)

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

	cron := &batchv1.CronJob{ObjectMeta: objectMeta("gamma", "nightly")}
	tracker.handleAdd(cron, resourceCronJob)

	// Delete succeeds once, unknown deletion should flip to unknown state.
	tracker.handleDelete(cron, resourceCronJob)
	tracker.handleDelete(cron, resourceCronJob)

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
				obj := makeObject(ns, name, r)
				tracker.handleAdd(obj, r)
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
			obj := makeObject(ns, name, res)
			tracker.handleDelete(obj, res)
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

	job := &batchv1.Job{ObjectMeta: objectMeta("beta", "cleanup")}
	tracker.handleDelete(job, resourceJob)

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

func objectMeta(namespace, name string) metav1.ObjectMeta {
	return metav1.ObjectMeta{
		Namespace: namespace,
		Name:      name,
	}
}

func makeObject(namespace, name string, resource workloadResource) interface{} {
	switch resource {
	case resourceDeployment:
		return &appsv1.Deployment{ObjectMeta: objectMeta(namespace, name)}
	case resourceStateful:
		return &appsv1.StatefulSet{ObjectMeta: objectMeta(namespace, name)}
	case resourceDaemon:
		return &appsv1.DaemonSet{ObjectMeta: objectMeta(namespace, name)}
	case resourceJob:
		return &batchv1.Job{ObjectMeta: objectMeta(namespace, name)}
	case resourceCronJob:
		return &batchv1.CronJob{ObjectMeta: objectMeta(namespace, name)}
	case resourcePod:
		return &corev1.Pod{ObjectMeta: objectMeta(namespace, name)}
	default:
		return &corev1.Pod{ObjectMeta: objectMeta(namespace, name)}
	}
}
