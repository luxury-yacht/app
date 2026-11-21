package apiresources

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/client-go/openapi"
)

// countingOpenAPI serves one group version whose document URL carries a content
// hash, as a real API server's does, and counts document downloads.
type countingOpenAPI struct {
	hash      string
	downloads int
}

func (c *countingOpenAPI) Paths() (map[string]openapi.GroupVersion, error) {
	return map[string]openapi.GroupVersion{"apis/apps/v1": countingGroupVersion{client: c, url: "/openapi/v3/apis/apps/v1?hash=" + c.hash}}, nil
}

type countingGroupVersion struct {
	client *countingOpenAPI
	url    string
}

func (g countingGroupVersion) Schema(string) ([]byte, error) {
	g.client.downloads++
	return []byte(g.url), nil
}

func (g countingGroupVersion) ServerRelativeURL() string { return g.url }

func fetchDocument(t *testing.T, client openapi.Client) string {
	t.Helper()
	paths, err := client.Paths()
	require.NoError(t, err)
	document, err := paths["apis/apps/v1"].Schema("application/json")
	require.NoError(t, err)
	return string(document)
}

// Group-version documents are megabytes; the Explain tab asks for one on every
// field the user selects, so it must be downloaded once per version of the
// schema, and downloaded again as soon as the server publishes a new one.
func TestDocumentCacheDownloadsEachSchemaVersionOnce(t *testing.T) {
	cache := NewDocumentCache(4)
	server := &countingOpenAPI{hash: "one"}
	client := cache.Client("cluster-a", server)

	first := fetchDocument(t, client)
	require.Equal(t, first, fetchDocument(t, client))
	require.Equal(t, 1, server.downloads)

	server.hash = "two"
	require.NotEqual(t, first, fetchDocument(t, client))
	require.Equal(t, 2, server.downloads)
}

func TestDocumentCacheKeepsClustersApart(t *testing.T) {
	cache := NewDocumentCache(4)
	clusterA, clusterB := &countingOpenAPI{hash: "same"}, &countingOpenAPI{hash: "same"}

	fetchDocument(t, cache.Client("cluster-a", clusterA))
	fetchDocument(t, cache.Client("cluster-b", clusterB))

	require.Equal(t, 1, clusterA.downloads)
	require.Equal(t, 1, clusterB.downloads, "another cluster's document is never served from cache")
}

func TestDocumentCacheKeepsOnlyTheMostRecentDocuments(t *testing.T) {
	cache := NewDocumentCache(2)
	server := &countingOpenAPI{}
	client := cache.Client("cluster-a", server)
	for _, hash := range []string{"one", "two", "three"} {
		server.hash = hash
		fetchDocument(t, client)
	}
	require.Equal(t, 3, server.downloads)

	server.hash = "three"
	fetchDocument(t, client)
	require.Equal(t, 3, server.downloads, "a recent document stays cached")

	server.hash = "one"
	fetchDocument(t, client)
	require.Equal(t, 4, server.downloads, "the oldest document was evicted")
}
