package backend

// registerTestClusterWithClients sets up cluster clients with the provided clients.
// All Kubernetes clients are now per-cluster - there are no global client fields.
func registerTestClusterWithClients(app *App, clusterID string, cc *clusterClients) {
	app.clusterClients = map[string]*clusterClients{clusterID: cc}
}

// TestLoadGVRCachedEvictsExpiredEntry and TestGetGVRFallsBackToCRD
// (both removed) used to exercise the legacy App.getGVR and its
// backing gvrCache. That cache and the resolver were retired as part
// of the kind-only-objects fix — no production caller remains. Strict
// GVK resolution now delegates to the object-catalog-backed resource
// resolver, whose discovery and CRD hydration are covered by objectcatalog
// resolver tests.
