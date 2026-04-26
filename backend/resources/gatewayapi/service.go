package gatewayapi

import (
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
)

var ErrGatewayAPINotInstalled = errors.New("gateway api kind is not installed on this cluster")

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) ensureKind(kind string) error {
	if s == nil || s.deps.GatewayClient == nil {
		return fmt.Errorf("%w: %s", ErrGatewayAPINotInstalled, kind)
	}
	if s.deps.GatewayAPIPresence != nil && !s.deps.GatewayAPIPresence.Has(kind) {
		return fmt.Errorf("%w: %s", ErrGatewayAPINotInstalled, kind)
	}
	return nil
}
