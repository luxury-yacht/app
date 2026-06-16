package gatewayapi

import (
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
)

var ErrGatewayAPINotInstalled = errors.New("gateway api kind is not installed on this cluster")

// EnsureKindInstalled reports whether the Gateway-API kind is reachable on the
// cluster: the gateway client must be wired and, when presence detection ran,
// the kind must be present. Kind packages call this through GetResource/
// ListResources so the CRD-discovery seam stays single-sourced here.
func EnsureKindInstalled(deps common.Dependencies, kind string) error {
	if deps.GatewayClient == nil {
		return fmt.Errorf("%w: %s", ErrGatewayAPINotInstalled, kind)
	}
	if deps.GatewayAPIPresence != nil && !deps.GatewayAPIPresence.Has(kind) {
		return fmt.Errorf("%w: %s", ErrGatewayAPINotInstalled, kind)
	}
	return nil
}
