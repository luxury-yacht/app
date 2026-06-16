package gatewayapi

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
)

// GetResource runs the shared ensure-kind → fetch → build flow for a single
// Gateway-API object on behalf of a kind package's detail service. The kind
// package owns the typed fetch + build; this seam owns CRD-availability gating.
func GetResource[T any, D any](
	deps common.Dependencies,
	kind, noun string,
	fetch func() (*T, error),
	build func(*T) *D,
) (*D, error) {
	if err := EnsureKindInstalled(deps, kind); err != nil {
		return nil, err
	}
	item, err := fetch()
	if err != nil {
		return nil, fmt.Errorf("failed to get %s: %w", noun, err)
	}
	return build(item), nil
}

// ListResources runs the shared ensure-kind → list → build flow for a
// Gateway-API kind on behalf of a kind package's detail service.
func ListResources[T any, D any](
	deps common.Dependencies,
	kind, noun string,
	list func() ([]T, error),
	build func(*T) *D,
) ([]*D, error) {
	if err := EnsureKindInstalled(deps, kind); err != nil {
		return nil, err
	}
	items, err := list()
	if err != nil {
		return nil, fmt.Errorf("failed to list %s: %w", noun, err)
	}
	out := make([]*D, 0, len(items))
	for i := range items {
		out = append(out, build(&items[i]))
	}
	return out, nil
}
