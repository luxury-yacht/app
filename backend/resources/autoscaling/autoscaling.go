package autoscaling

import (
	"github.com/luxury-yacht/app/backend/resources/common"
)

type Dependencies struct {
	Common common.Dependencies
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}
