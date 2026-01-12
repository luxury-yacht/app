/*
 * backend/resources/autoscaling/autoscaling.go
 *
 * Autoscaling service wiring.
 * - Defines the service container for autoscaling resources.
 */

package autoscaling

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
