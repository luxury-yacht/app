/*
 * backend/resources/network/network.go
 *
 * Network service wiring.
 * - Defines the service container for network resources.
 */

package network

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
