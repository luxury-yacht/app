package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes/fake"
)

// The informer reports synced once its cache holds the initial list, but each
// handler applies that list on its own listener afterwards. A builder that
// gated on the informer could serve a store the handler is still filling; the
// helper's synced gate must stay closed until this handler has applied it.
func TestMaintainedInformerHandlerSyncedWaitsForTheHandlerToApplyTheInitialList(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1"}
	client := fake.NewClientset(nsEventObj("web.1", "prod", "Pod", "Started", "3", 1))
	factory := informers.NewSharedInformerFactory(client, 0)
	informer := factory.Core().V1().Events().Informer()
	maintained := newTypedMaintainedStore(meta, namespaceEventsQuerypageSchema(), namespacedEventTableQueryAdapter())

	release := make(chan struct{})
	synced, err := registerMaintainedInformerHandler(maintained, informer,
		func(obj interface{}) (EventSummary, metav1.Object, bool) {
			<-release // the handler lags behind the informer cache
			evt := obj.(*corev1.Event)
			summary, keep := projectNamespaceEventSummary(meta, evt)
			return summary, evt, keep
		},
		nil,
	)
	require.NoError(t, err)

	stop := make(chan struct{})
	defer close(stop)
	factory.Start(stop)
	require.Eventually(t, informer.HasSynced, 2*time.Second, 5*time.Millisecond)

	require.False(t, synced(), "the handler has not applied the initial list yet")
	require.Empty(t, maintained.rowsInNamespace(""))

	close(release)
	require.Eventually(t, synced, 2*time.Second, 5*time.Millisecond)
	require.Len(t, maintained.rowsInNamespace(""), 1)
}
