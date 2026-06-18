/*
 * backend/resources/common/managedfields.go
 *
 * "Last modified" derivation from Kubernetes managedFields.
 *
 * Kubernetes objects have no native last-modified timestamp. The closest
 * honest proxy is the most recent managedFields entry time, restricted to
 * entries that manage the main resource (spec/metadata). Status-subresource
 * entries are excluded so frequent controller status writes don't masquerade
 * as user edits.
 */

package common

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// LastModifiedTime returns the most recent time any field manager changed the
// object's spec or metadata, based on managedFields. Entries that manage a
// subresource (e.g. status) are ignored. Returns false when no usable
// timestamp is available.
func LastModifiedTime(obj metav1.Object) (time.Time, bool) {
	var latest time.Time
	found := false
	for _, entry := range obj.GetManagedFields() {
		// Skip subresource writes (status, scale, ...) — only main-resource
		// (spec/metadata) changes count as "modified".
		if entry.Subresource != "" {
			continue
		}
		if entry.Time == nil {
			continue
		}
		t := entry.Time.Time
		if !found || t.After(latest) {
			latest = t
			found = true
		}
	}
	return latest, found
}

// FormatLastModified renders the last-modified time using the same relative
// format as the Age field. It returns "" when no last-modified time is
// available, and "Never" when the most recent spec/metadata change is the
// object's own creation (the timestamps match), i.e. it has never been modified
// since being created.
func FormatLastModified(obj metav1.Object) string {
	t, ok := LastModifiedTime(obj)
	if !ok {
		return ""
	}
	// Both timestamps are second-granular (metav1.Time); compare at that
	// precision so a creation-only object reads "Never" rather than echoing Age.
	creation := obj.GetCreationTimestamp().Time
	if !creation.IsZero() && t.Truncate(time.Second).Equal(creation.Truncate(time.Second)) {
		return "Never"
	}
	return FormatAge(t)
}
