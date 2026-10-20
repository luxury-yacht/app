package resourcestream

import (
	"k8s.io/client-go/tools/cache"
)

// objectAs decodes an informer event payload to the requested type, unwrapping
// delete tombstones.
func objectAs[T any](obj interface{}) (T, bool) {
	if typed, ok := obj.(T); ok {
		return typed, true
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		return objectAs[T](tombstone.Obj)
	}
	var zero T
	return zero, false
}
