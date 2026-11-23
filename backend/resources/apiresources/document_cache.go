package apiresources

import (
	"bytes"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
)

// DocumentCache retains a bounded number of OpenAPI documents for conditional
// GETs. The server authorizes every read, including when the bytes are cached.
type DocumentCache struct {
	mu       sync.Mutex
	capacity int
	// entries is ordered least recently used first.
	entries []cachedDocument
}

type documentKey struct {
	clusterID string
	url       string
	accept    string
}

type cachedDocument struct {
	key      documentKey
	etag     string
	header   http.Header
	document []byte
}

// NewDocumentCache returns a cache that holds up to capacity documents.
func NewDocumentCache(capacity int) *DocumentCache {
	return &DocumentCache{capacity: max(1, capacity)}
}

// WrapTransport adds conditional document reads to a cluster's OpenAPI client.
func (c *DocumentCache) WrapTransport(clusterID string, next http.RoundTripper) http.RoundTripper {
	return documentTransport{cache: c, clusterID: clusterID, next: next}
}

func (c *DocumentCache) get(key documentKey) (cachedDocument, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for index, entry := range c.entries {
		if entry.key == key {
			// Move to the most recently used end.
			copy(c.entries[index:], c.entries[index+1:])
			c.entries[len(c.entries)-1] = entry
			return entry, true
		}
	}
	return cachedDocument{}, false
}

func (c *DocumentCache) put(entry cachedDocument) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = slices.DeleteFunc(c.entries, func(existing cachedDocument) bool { return existing.key == entry.key })
	c.entries = append(c.entries, entry)
	if len(c.entries) > c.capacity {
		c.entries = slices.Delete(c.entries, 0, 1)
	}
}

func (c *DocumentCache) forget(key documentKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = slices.DeleteFunc(c.entries, func(entry cachedDocument) bool { return entry.key == key })
}

type documentTransport struct {
	cache     *DocumentCache
	clusterID string
	next      http.RoundTripper
}

func (t documentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodGet {
		return t.next.RoundTrip(req)
	}
	req = req.Clone(req.Context())
	req.Header.Set("Cache-Control", "no-cache")
	// Kubernetes includes a hash on versioned document URLs. Index and other
	// unversioned responses are always read directly.
	if req.URL.Query().Get("hash") == "" {
		return t.next.RoundTrip(req)
	}
	key := documentKey{clusterID: t.clusterID, url: req.URL.String(), accept: req.Header.Get("Accept")}
	cached, found := t.cache.get(key)
	if found {
		req.Header.Set("If-None-Match", cached.etag)
	}
	response, err := t.next.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	noStore := forbidsStorage(response.Header)
	if noStore {
		t.cache.forget(key)
	}
	if response.StatusCode == http.StatusNotModified && found {
		return cached.restore(response), nil
	}
	if noStore {
		return response, nil
	}
	return t.cache.remember(key, response)
}

func (c *DocumentCache) remember(key documentKey, response *http.Response) (*http.Response, error) {
	etag := response.Header.Get("ETag")
	if response.StatusCode != http.StatusOK || etag == "" {
		return response, nil
	}
	document, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil {
		return nil, err
	}
	c.put(cachedDocument{key: key, etag: etag, header: response.Header.Clone(), document: document})
	response.Body = io.NopCloser(bytes.NewReader(document))
	return response, nil
}

func forbidsStorage(header http.Header) bool {
	for _, value := range header.Values("Cache-Control") {
		for directive := range strings.SplitSeq(value, ",") {
			if strings.EqualFold(strings.TrimSpace(directive), "no-store") {
				return true
			}
		}
	}
	return false
}

func (d cachedDocument) restore(response *http.Response) *http.Response {
	_ = response.Body.Close()
	response.Status = "200 OK"
	response.StatusCode = http.StatusOK
	response.Header = d.header.Clone()
	response.ContentLength = int64(len(d.document))
	response.Body = io.NopCloser(bytes.NewReader(d.document))
	return response
}
