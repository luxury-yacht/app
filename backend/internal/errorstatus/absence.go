package errorstatus

import (
	"errors"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// ConfirmsObjectAbsent reports whether err, from reading an object, is the
// Kubernetes API saying exactly that object does not exist. Callers treat this as
// the object being gone, so nothing weaker counts: a proxy or an API version no
// longer served answers with a plain 404 that client-go still labels with the
// request's resource and name, and the API server's own 404 for a route with no
// handler names nothing. Pass only a read's error: a write's 404 can come from an
// admission webhook, which can return any status it likes.
func ConfirmsObjectAbsent(err error, resource schema.GroupResource, name string) bool {
	if !apierrors.IsNotFound(err) || apierrors.IsUnexpectedServerError(err) {
		return false
	}
	var api apierrors.APIStatus
	if !errors.As(err, &api) {
		return false
	}
	details := api.Status().Details
	return details != nil && details.Group == resource.Group &&
		details.Kind == resource.Resource && details.Name == name
}
