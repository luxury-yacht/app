/*
 * backend/resources/rbac/rbac_test.go
 *
 * Test helpers for RBAC resources.
 * - Provides shared helpers for RBAC tests.
 */

package rbac

import (
	"context"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
	"k8s.io/client-go/kubernetes"
)

// newManagerWithClient is a test helper for building a service with a fake client.
func newManagerWithClient(client kubernetes.Interface) *Service {
	return NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NoopLogger{},
		KubernetesClient: client,
	})
}
