/*
 * backend/resources/common/uid_guard.go
 *
 * Ties a write to one object, so a replacement created under the same name is
 * left alone. The API server does the checking in every case.
 */

package common

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeleteOptionsForUID limits a delete to the object with this UID. An empty UID
// deletes by name.
func DeleteOptionsForUID(uid string) metav1.DeleteOptions {
	if uid == "" {
		return metav1.DeleteOptions{}
	}
	return metav1.DeleteOptions{Preconditions: metav1.NewUIDPreconditions(uid)}
}

// BindPatchToUID limits a patch to the object with this UID: a patch cannot change
// an object's UID, so the API server refuses it for any other object. An empty UID
// patches by name.
func BindPatchToUID(patch map[string]any, uid string) map[string]any {
	if uid != "" {
		patch["metadata"] = map[string]any{"uid": uid}
	}
	return patch
}
