package apiresources

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type revalidatingDocumentServer struct {
	requests  int
	downloads int
	noStore   bool
}

func (s *revalidatingDocumentServer) RoundTrip(req *http.Request) (*http.Response, error) {
	s.requests++
	hash := req.URL.Query().Get("hash")
	etag := strconv.Quote(hash)
	header := http.Header{}
	header.Set("ETag", etag)
	if s.noStore {
		header.Add("Cache-Control", "private, no-store")
	}
	if req.Header.Get("If-None-Match") == etag {
		return &http.Response{StatusCode: http.StatusNotModified, Header: header, Body: http.NoBody}, nil
	}
	s.downloads++
	header.Set("Content-Type", "application/json")
	return &http.Response{StatusCode: http.StatusOK, Header: header, Body: io.NopCloser(strings.NewReader(hash))}, nil
}

func fetchDocument(t *testing.T, transport http.RoundTripper, hash string) string {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://kubernetes.example/openapi/v3/apis/apps/v1?hash="+hash, nil)
	require.NoError(t, err)
	req.Header.Set("Accept", "application/json")
	response, err := transport.RoundTrip(req)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "application/json", response.Header.Get("Content-Type"))
	document, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return string(document)
}

func TestDocumentCacheRevalidatesEachReadAndDownloadsChangedSchemas(t *testing.T) {
	server := &revalidatingDocumentServer{}
	transport := NewDocumentCache(4).WrapTransport("cluster-a", server)
	require.Equal(t, "one", fetchDocument(t, transport, "one"))
	require.Equal(t, "one", fetchDocument(t, transport, "one"))
	require.Equal(t, "two", fetchDocument(t, transport, "two"))
	require.Equal(t, 3, server.requests)
	require.Equal(t, 2, server.downloads)
}

func TestDocumentCacheKeepsClustersApart(t *testing.T) {
	cache := NewDocumentCache(4)
	server := &revalidatingDocumentServer{}
	fetchDocument(t, cache.WrapTransport("cluster-a", server), "same")
	fetchDocument(t, cache.WrapTransport("cluster-b", server), "same")
	require.Equal(t, 2, server.downloads, "a different cluster needs its own validator and document")
}

func TestDocumentCacheKeepsOnlyTheMostRecentDocuments(t *testing.T) {
	server := &revalidatingDocumentServer{}
	transport := NewDocumentCache(2).WrapTransport("cluster-a", server)
	for _, hash := range []string{"one", "two", "one", "three", "one"} {
		fetchDocument(t, transport, hash)
	}
	require.Equal(t, 3, server.downloads, "a recently used document stays cached")
	fetchDocument(t, transport, "two")
	require.Equal(t, 4, server.downloads, "the oldest document was evicted")
}

func TestDocumentCacheHonorsNoStore(t *testing.T) {
	server := &revalidatingDocumentServer{}
	transport := NewDocumentCache(4).WrapTransport("cluster-a", server)
	fetchDocument(t, transport, "one")
	server.noStore = true
	fetchDocument(t, transport, "one")
	require.Equal(t, 1, server.downloads, "an authorized 304 can satisfy the current request")
	fetchDocument(t, transport, "one")
	fetchDocument(t, transport, "one")
	require.Equal(t, 3, server.downloads, "no-store evicts the cache entry and prevents reuse")
}
