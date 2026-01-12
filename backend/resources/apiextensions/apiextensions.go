/*
 * backend/resources/apiextensions/apiextensions.go
 *
 * APIExtensions service wiring.
 * - Defines the service container for API extensions resources.
 */

package apiextensions

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
