/*
 * backend/resources/events/events.go
 *
 * Event resource handlers.
 * - Builds detail and list views for the frontend.
 */

package events

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service exposes helpers for querying Kubernetes events.
type Service struct {
	deps common.Dependencies
}

// Filter represents filtering options for events queries.
type Filter struct {
	Namespace    string
	ObjectKind   string
	ObjectName   string
	ResourceKind string
}

// NewService constructs an event service with shared dependencies.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Event returns the detailed view for one namespaced Event.
func (s *Service) Event(namespace, name string) (*EventDetails, error) {
	if err := s.ensureClient(); err != nil {
		return nil, err
	}
	ctx := s.deps.Context
	if ctx == nil {
		ctx = context.Background()
	}
	event, err := s.deps.KubernetesClient.CoreV1().Events(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get event %s/%s: %w", namespace, name, err)
	}

	model := BuildResourceModel(s.deps.ClusterID, event)
	facts := BuildFacts(s.deps.ClusterID, event)
	return &EventDetails{
		Kind:                    "Event",
		Name:                    event.Name,
		Namespace:               event.Namespace,
		StatusProjection:        restypes.NewStatusProjection(model.Status),
		EventType:               facts.EventType,
		Reason:                  facts.Reason,
		Message:                 facts.Message,
		Count:                   facts.Count,
		FirstTimestamp:          facts.FirstTimestamp,
		LastTimestamp:           facts.LastTimestamp,
		EventTime:               facts.EventTime,
		SeriesCount:             facts.SeriesCount,
		SeriesLastObservedTime:  facts.SeriesLastObservedTime,
		Source:                  facts.Source,
		Action:                  facts.Action,
		ReportingController:     facts.ReportingController,
		ReportingInstance:       facts.ReportingInstance,
		InvolvedObject:          facts.InvolvedObject,
		InvolvedObjectFieldPath: facts.InvolvedObjectFieldPath,
		RelatedObject:           facts.RelatedObject,
		RelatedObjectFieldPath:  facts.RelatedObjectFieldPath,
		Labels:                  event.Labels,
		Annotations:             event.Annotations,
	}, nil
}

func (s *Service) ensureClient() error {
	if s.deps.EnsureClient != nil {
		if err := s.deps.EnsureClient("events"); err != nil {
			return err
		}
	}
	if s.deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}
	return nil
}
