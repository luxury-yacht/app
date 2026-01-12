/*
 * backend/resources/storage/storage.go
 *
 * Storage service wiring.
 * - Defines the service container for storage resources.
 */

package storage

import "github.com/luxury-yacht/app/backend/resources/common"

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}
