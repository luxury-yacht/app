package backend

import (
	"slices"
	"testing"

	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"

	"github.com/luxury-yacht/app/backend/refresh/ingest/ingesttest"
)

// crdAPIServer is the API the subsystem's reflectors watch: it holds crds and
// allows access reviews only for the allowed resources. The catalog keeps
// using the cluster's fake clients for discovery and its own reviews.
func crdAPIServer(t *testing.T, allowed []string, crds ...*apiextensionsv1.CustomResourceDefinition) *ingesttest.APIServer {
	t.Helper()
	server := ingesttest.NewAPIServer(t)
	server.Allow(func(attrs authorizationv1.ResourceAttributes) bool { return slices.Contains(allowed, attrs.Resource) })
	for _, crd := range crds {
		server.Create(t, crd)
	}
	return server
}
