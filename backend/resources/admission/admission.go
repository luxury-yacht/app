/*
 * backend/resources/admission/admission.go
 *
 * Admission service wiring.
 * - Defines the service container for admission resources.
 */

package admission

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
