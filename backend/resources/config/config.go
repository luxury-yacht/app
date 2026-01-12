/*
 * backend/resources/config/config.go
 *
 * Config service wiring.
 * - Defines the service container for config resources.
 */

package config

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
