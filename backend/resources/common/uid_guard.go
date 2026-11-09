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

// UserDeleteOptions are the options for a delete the user asked for, limited to the
// object with this UID when one is given. Like kubectl's default, it removes what
// the object owns: left unset, the API server orphans the Pods of a batch/v1 Job or
// a v1 ReplicationController.
func UserDeleteOptions(uid string) metav1.DeleteOptions {
	options := DeleteOptionsForUID(uid)
	background := metav1.DeletePropagationBackground
	options.PropagationPolicy = &background
	return options
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
