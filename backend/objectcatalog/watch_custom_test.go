package objectcatalog

import (
	"fmt"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// A startup burst larger than the former object queue must converge by rereading
// the authoritative ingest projection after baseline publication, without LIST.
func TestCustomResourceStartupBurstCoalescesWithoutFullSync(t *testing.T) {
	mgr, svc, desc := dynamicCatalogFixture(t, "c1")
	dyn := svc.deps.Common.DynamicClient
	unsubscribe := mgr.SubscribeDynamicCatalogChanges(svc.applyDynamicCatalogChange)
	defer unsubscribe()
	objects := config.ObjectCatalogWatchPendingBufferSize + 1
	func() {
		svc.syncMu.Lock()
		defer svc.syncMu.Unlock()
		for i := range objects {
			obj := widgetObject("default", fmt.Sprintf("widget-%d", i), "1")
			obj.SetUID("initial")
			_, err := dyn.Resource(desc.GVR()).Namespace("default").Create(t.Context(), obj, metav1.CreateOptions{})
			require.NoError(t, err)
			// Drain client-go's small fake transport buffer while publication stays blocked.
			if i%50 == 49 {
				require.Eventually(t, func() bool { return len(mgr.CatalogRows(desc.GVR())) == i+2 }, time.Second, time.Millisecond)
			}
		}
		latest := widgetObject("default", "widget-0", "2")
		latest.SetUID("replacement")
		_, err := dyn.Resource(desc.GVR()).Namespace("default").Update(t.Context(), latest, metav1.UpdateOptions{})
		require.NoError(t, err)
		require.NoError(t, dyn.Resource(desc.GVR()).Namespace("default").Delete(t.Context(), "widget", metav1.DeleteOptions{}))
		require.Eventually(t, func() bool {
			source, ok := mgr.ReadDynamicCatalogSource(desc.GVR().GroupResource())
			if !ok || len(source.Rows) != objects {
				return false
			}
			for _, raw := range source.Rows {
				if row := raw.(Summary); row.Ref.Name == "widget-0" {
					return row.Ref.UID == "replacement"
				}
			}
			return false
		}, 3*time.Second, time.Millisecond)
		// Events preceded descriptor publication and this deliberately stale baseline.
		registerDesc(svc, desc)
		svc.replaceIngestCatalogSummariesLocked(desc.GVR(), nil)
	}()
	require.Eventually(t, func() bool {
		result := svc.Query(QueryOptions{})
		if result.TotalItems != objects {
			return false
		}
		for _, row := range result.Items {
			if row.Ref.Name == "widget-0" {
				return row.ResourceVersion == "2" && row.Ref.UID == "replacement"
			}
		}
		return false
	}, 3*time.Second, time.Millisecond)
}
