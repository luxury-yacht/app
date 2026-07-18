package ingest

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type bundleSinkFuncs struct {
	upsert func(Bundle)
	delete func(Bundle)
}

func (s bundleSinkFuncs) UpsertBundle(bundle Bundle) {
	if s.upsert != nil {
		s.upsert(bundle)
	}
}

func (s bundleSinkFuncs) DeleteBundle(bundle Bundle) {
	if s.delete != nil {
		s.delete(bundle)
	}
}

func TestAsyncBundleSinkBreaksTwoStoreLockCycle(t *testing.T) {
	podProjecting := make(chan struct{})
	jobProjecting := make(chan struct{})
	podDone := make(chan error, 1)
	jobDone := make(chan error, 1)
	healDone := make(chan struct{})

	var jobStore *ProjectingStore
	podStore := NewProjectingStore(func(obj interface{}) (interface{}, error) {
		close(podProjecting)
		<-jobProjecting
		if _, _, err := jobStore.GetByKey("batch/nightly-1"); err != nil {
			return nil, err
		}
		return Bundle{Table: row{NS: "batch", Name: "pod-1"}}, nil
	})
	jobStore = NewProjectingStore(func(obj interface{}) (interface{}, error) {
		close(jobProjecting)
		<-podProjecting
		return Bundle{Aggregate: "nightly"}, nil
	})

	healSink := NewAsyncBundleSink(bundleSinkFuncs{upsert: func(Bundle) {
		_ = podStore.List()
		close(healDone)
	}})
	t.Cleanup(healSink.Stop)
	jobStore.AddBundleSink(healSink)

	go func() {
		podDone <- podStore.Add(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "pod-1"}})
	}()
	go func() {
		jobDone <- jobStore.Add(&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Namespace: "batch", Name: "nightly-1"}})
	}()

	deadline := time.After(time.Second)
	for label, done := range map[string]<-chan error{"pod add": podDone, "job add": jobDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("%s: %v", label, err)
			}
		case <-deadline:
			t.Fatalf("%s deadlocked", label)
		}
	}
	select {
	case <-healDone:
	case <-time.After(time.Second):
		t.Fatal("asynchronous heal was not delivered")
	}
}
