package objectcatalog

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestCollectionSourcePlanDocumentsSpecialCases(t *testing.T) {
	endpoints := planCollectionSourceForGroupResource(schema.GroupResource{Group: "", Resource: "endpoints"})
	require.Equal(t, collectionSourceSkip, endpoints.source)
	require.False(t, endpoints.promotable)

	unknown := planCollectionSourceForGroupResource(schema.GroupResource{
		Group:    "example.com",
		Resource: "widgets",
	})
	require.Equal(t, collectionSourceDynamicList, unknown.source)
	require.True(t, unknown.promotable)
}
