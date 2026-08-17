package backend

import "testing"

// operationsCoordinatorFixture composes only the cluster/refresh projections
// required by OperationsCoordinator component tests.
type operationsCoordinatorFixture struct {
	runtime     *workspaceCoordinatorTestFixture
	coordinator *OperationsCoordinator
}

func newOperationsCoordinatorFixture(t *testing.T) operationsCoordinatorFixture {
	t.Helper()
	runtime := newWorkspaceCoordinatorTestFixture(t)
	return operationsCoordinatorFixture{
		runtime:     runtime,
		coordinator: runtime.Operations,
	}
}
