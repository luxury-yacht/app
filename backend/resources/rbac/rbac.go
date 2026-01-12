/*
 * backend/resources/rbac/rbac.go
 *
 * RBAC service wiring.
 * - Defines the service container for RBAC resources.
 */

package rbac

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
