package resourcestream

import (
	"k8s.io/client-go/tools/cache"
)

// objectAs decodes an informer event payload to the requested type, unwrapping
// delete tombstones. It is the generic replacement for the per-kind
// <kind>FromObject decoders. Descriptor-driven streaming uses it via
// streamObjectRowFromDescriptor (see stream_descriptor_dispatch.go).
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
