/*
 * backend/resources/generic/generic.go
 *
 * Generic resource deletion helpers.
 * - Uses dynamic clients to delete resources by kind.
 */

package generic

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/client-go/dynamic"
)

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) dynamicClient() (dynamic.Interface, error) {
	if s.deps.DynamicClient != nil {
		return s.deps.DynamicClient, nil
	}
	if s.deps.RestConfig == nil {
		return nil, fmt.Errorf("rest config not initialized")
	}
	return dynamic.NewForConfig(s.deps.RestConfig)
}

func (s *Service) context() context.Context {
	if s.deps.Context != nil {
		return s.deps.Context
	}
	return context.Background()
}

func (s *Service) logInfo(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Info(msg, "GenericResource")
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "GenericResource")
	}
}
