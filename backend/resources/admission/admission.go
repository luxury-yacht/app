package admission

import "github.com/luxury-yacht/app/backend/resources/common"

// Dependencies captures collaborators needed for admission resources.
type Dependencies struct {
	Common common.Dependencies
}

// Service exposes helpers for mutating/validating webhook configurations.
type Service struct {
	deps Dependencies
}

// NewService constructs a new admission Service.
func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}
