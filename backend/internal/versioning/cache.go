package versioning

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"sync"
)

// Cache tracks resource versions to support conditional responses.
type Cache struct {
	mu       sync.RWMutex
	versions map[string]string
}

// NewCache constructs an empty cache.
func NewCache() *Cache {
	return &Cache{versions: make(map[string]string)}
}

func computeVersion(data interface{}) (string, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	hash := md5.Sum(payload)
	return hex.EncodeToString(hash[:]), nil
}

// CheckAndUpdate compares the incoming payload with the stored version.
func (c *Cache) CheckAndUpdate(key string, data interface{}, clientVersion string) (string, bool, error) {
	version, err := computeVersion(data)
	if err != nil {
		return "", false, err
	}

	if clientVersion != "" && clientVersion == version {
		return version, true, nil
	}

	c.mu.Lock()
	c.versions[key] = version
	c.mu.Unlock()

	return version, false, nil
}
