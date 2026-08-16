package backend

import "testing"

// operationsCoordinatorFixture keeps the temporary App-backed cluster-access
// seam in one test helper while component tests exercise OperationsCoordinator
// directly. Full App calls are reserved for lifecycle integration assertions.
type operationsCoordinatorFixture struct {
	runtime     *App
	coordinator *OperationsCoordinator
}

func newOperationsCoordinatorFixture(t *testing.T) operationsCoordinatorFixture {
	t.Helper()
	runtime := newTestAppWithDefaults(t)
	return operationsCoordinatorFixture{
		runtime:     runtime,
		coordinator: runtime.OperationsCoordinator(),
	}
}
