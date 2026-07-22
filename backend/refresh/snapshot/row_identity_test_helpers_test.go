package snapshot

import "github.com/luxury-yacht/app/backend/resourcemodel"

func testCanonicalRowRef(kind, namespace, name string) resourcemodel.ResourceRef {
	return resourcemodel.ResourceRef{
		ClusterID: "c",
		Version:   "v1",
		Kind:      kind,
		Resource:  "testresources",
		Namespace: namespace,
		Name:      name,
	}
}
