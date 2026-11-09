/*
 * backend/resources/common/delete_options.go
 *
 * Delete options shared by the object delete paths.
 */

package common

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeleteOptionsForUID limits a delete to the object with this UID, so a
// replacement created under the same name is left alone. An empty UID deletes
// by name.
func DeleteOptionsForUID(uid string) metav1.DeleteOptions {
	if uid == "" {
		return metav1.DeleteOptions{}
	}
	return metav1.DeleteOptions{Preconditions: metav1.NewUIDPreconditions(uid)}
}
