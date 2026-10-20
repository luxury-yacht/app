package snapshot

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// InformerUpdateIsEcho reports whether an informer Update delivery is a resync
// echo (unchanged ResourceVersion) rather than a real change. Informer resyncs
// re-deliver every cached object; a doorbell keyed on them would ring once per
// resync period for every object. Unrecognized objects are treated as real
// updates — suppression must never lose a signal.
func InformerUpdateIsEcho(oldObj, newObj interface{}) bool {
	oldMeta, okOld := oldObj.(metav1.Object)
	newMeta, okNew := newObj.(metav1.Object)
	if !okOld || !okNew {
		return false
	}
	return ResourceVersionUnchanged(oldMeta.GetResourceVersion(), newMeta.GetResourceVersion())
}

// ResourceVersionUnchanged is the echo rule for any re-delivered object or row:
// the same non-empty resourceVersion. An empty old version proves nothing, so
// it counts as a change.
func ResourceVersionUnchanged(oldVersion, newVersion string) bool {
	return oldVersion != "" && oldVersion == newVersion
}
