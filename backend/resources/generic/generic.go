/*
 * backend/resources/generic/generic.go
 *
 * Generic resource deletion helpers.
 * - Uses dynamic clients to delete resources by kind.
 */

package generic

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
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

func (s *Service) logInfo(msg string) {
	applog.Info(s.deps.Logger, msg, "GenericResource")
}

func (s *Service) logError(err error, msg string) error {
	return s.deps.LogOperationalFailure(err, msg, "GenericResource")
}
