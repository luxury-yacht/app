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
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
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

// Events fetches events matching the provided filter.
func (s *Service) Events(filter Filter) ([]Event, error) {
	if err := s.ensureClient(); err != nil {
		return nil, err
	}

	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	var (
		eventList *corev1.EventList
		err       error
	)

	ctx := s.deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	if filter.Namespace == "" {
		eventList, err = client.CoreV1().Events("").List(ctx, metav1.ListOptions{})
	} else {
		eventList, err = client.CoreV1().Events(filter.Namespace).List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		if filter.Namespace == "" {
			return nil, fmt.Errorf("failed to list events: %w", err)
		}
		return nil, fmt.Errorf("failed to list events in namespace %s: %w", filter.Namespace, err)
	}

	var events []Event
	for _, kubeEvent := range eventList.Items {
		if filter.ObjectName != "" && kubeEvent.InvolvedObject.Name != filter.ObjectName {
			continue
		}
		if filter.ObjectKind != "" && !equalResourceTypes(kubeEvent.InvolvedObject.Kind, filter.ObjectKind) {
			continue
		}
		if filter.ResourceKind != "" && !equalResourceTypes(kubeEvent.InvolvedObject.Kind, filter.ResourceKind) {
			continue
		}

		events = append(events, convertEvent(s.deps.ClusterID, kubeEvent))
	}

	sortEventsByTime(events)
	return events, nil
}

// AllEvents returns events across all namespaces.
func (s *Service) AllEvents() ([]Event, error) {
	return s.Events(Filter{})
}

// NamespaceEvents returns events scoped to a namespace.
func (s *Service) NamespaceEvents(namespace string) ([]Event, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace cannot be empty")
	}
	return s.Events(Filter{Namespace: namespace})
}

// ObjectEvents returns events tied to a specific object.
func (s *Service) ObjectEvents(resourceKind, namespace, name string) ([]Event, error) {
	if name == "" {
		return nil, fmt.Errorf("object name cannot be empty")
	}

	return s.Events(Filter{
		Namespace:  namespace,
		ObjectKind: resourceKind,
		ObjectName: name,
	})
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

func convertEvent(clusterID string, kubeEvent corev1.Event) Event {
	facts := BuildFacts(clusterID, &kubeEvent)
	e := Event{
		Kind:               "event",
		EventType:          facts.EventType,
		Reason:             facts.Reason,
		Message:            facts.Message,
		Count:              facts.Count,
		InvolvedObjectName: kubeEvent.InvolvedObject.Name,
		InvolvedObjectKind: kubeEvent.InvolvedObject.Kind,
		Namespace:          kubeEvent.Namespace,
		FirstTimestamp:     facts.FirstTimestamp.Time,
		LastTimestamp:      facts.LastTimestamp.Time,
	}

	e.Source = facts.Source
	if e.Source == "" {
		e.Source = "Unknown"
	}

	return e
}

func sortEventsByTime(events []Event) {
	sort.Slice(events, func(i, j int) bool {
		ti := events[i].LastTimestamp
		if ti.IsZero() {
			ti = events[i].FirstTimestamp
		}
		tj := events[j].LastTimestamp
		if tj.IsZero() {
			tj = events[j].FirstTimestamp
		}
		return ti.After(tj)
	})
}

func equalResourceTypes(kind1, kind2 string) bool {
	kind1Lower := strings.ToLower(kind1)
	kind2Lower := strings.ToLower(kind2)

	if kind1Lower == kind2Lower {
		return true
	}

	aliases := map[string]string{
		"deployment":              "deployment",
		"deploy":                  "deployment",
		"pod":                     "pod",
		"pods":                    "pod",
		"service":                 "service",
		"svc":                     "service",
		"statefulset":             "statefulset",
		"sts":                     "statefulset",
		"daemonset":               "daemonset",
		"ds":                      "daemonset",
		"job":                     "job",
		"cronjob":                 "cronjob",
		"cj":                      "cronjob",
		"replicaset":              "replicaset",
		"rs":                      "replicaset",
		"configmap":               "configmap",
		"cm":                      "configmap",
		"secret":                  "secret",
		"pvc":                     "persistentvolumeclaim",
		"persistentvolumeclaim":   "persistentvolumeclaim",
		"pv":                      "persistentvolume",
		"persistentvolume":        "persistentvolume",
		"ingress":                 "ingress",
		"ing":                     "ingress",
		"networkpolicy":           "networkpolicy",
		"netpol":                  "networkpolicy",
		"hpa":                     "horizontalpodautoscaler",
		"horizontalpodautoscaler": "horizontalpodautoscaler",
		"vpa":                     "verticalpodautoscaler",
		"verticalpodautoscaler":   "verticalpodautoscaler",
	}

	normalized1 := aliases[kind1Lower]
	if normalized1 == "" {
		normalized1 = kind1Lower
	}
	normalized2 := aliases[kind2Lower]
	if normalized2 == "" {
		normalized2 = kind2Lower
	}

	return normalized1 == normalized2
}
