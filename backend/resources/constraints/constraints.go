/*
 * backend/resources/constraints/constraints.go
 *
 * Constraints service wiring.
 * - Defines the service container for constraint resources.
 */

package constraints

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
