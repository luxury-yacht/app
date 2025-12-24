package eventstream

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

func TestManagerBroadcastsToSubscribers(t *testing.T) {
	client := fake.NewClientset()
	factory := informers.NewSharedInformerFactory(client, 0)
	informer := factory.Core().V1().Events()

	manager := NewManager(informer, noopLogger{}, telemetry.NewRecorder())

	stopCh := make(chan struct{})
	defer close(stopCh)

	go factory.Start(stopCh)
	cache.WaitForCacheSync(stopCh, informer.Informer().HasSynced)

	ach, cancel := manager.Subscribe("namespace:default")
	defer cancel()

	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-event",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "web-123",
			Namespace: "default",
		},
		Message: "Pod restarted",
		Type:    "Warning",
	}

	manager.handleEvent(event)

	select {
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for event")
	case entry, ok := <-ach:
		if !ok {
			t.Fatalf("subscription channel closed")
		}
		if entry.Name != "test-event" || entry.Namespace != "default" {
			t.Fatalf("unexpected entry: %+v", entry)
		}
	}
}
