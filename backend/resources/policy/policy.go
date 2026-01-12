/*
 * backend/resources/policy/policy.go
 *
 * Policy service wiring.
 * - Defines the service container for policy resources.
 */

package policy

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
