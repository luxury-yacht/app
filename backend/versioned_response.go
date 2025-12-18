package backend

// VersionedResponse wraps responses that support conditional refreshes.
type VersionedResponse struct {
	Data        interface{} `json:"data"`
	Version     string      `json:"version"`
	NotModified bool        `json:"notModified"`
}

// CreateVersionedEndpoint executes the fetch function and annotates the response
// with a stable version hash so the frontend can avoid redundant payloads.
func (a *App) CreateVersionedEndpoint(resourceKind string, namespace string, fetchFunc func() (interface{}, error), clientVersion string) (*VersionedResponse, error) {
	payload, err := fetchFunc()
	if err != nil {
		return nil, err
	}

	cacheKey := resourceKind
	if namespace != "" {
		cacheKey = resourceKind + ":" + namespace
	}

	version, notModified, err := a.versionCache.CheckAndUpdate(cacheKey, payload, clientVersion)
	if err != nil {
		return nil, err
	}

	if notModified {
		return &VersionedResponse{Version: version, NotModified: true}, nil
	}

	return &VersionedResponse{Data: payload, Version: version, NotModified: false}, nil
}
