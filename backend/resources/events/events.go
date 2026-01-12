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

// Events fetches events matching the provided filter.
func (s *Service) Events(filter Filter) ([]restypes.Event, error) {
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

	var events []restypes.Event
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

		events = append(events, convertEvent(kubeEvent))
	}

	sortEventsByTime(events)
	return events, nil
}

// AllEvents returns events across all namespaces.
func (s *Service) AllEvents() ([]restypes.Event, error) {
	return s.Events(Filter{})
}

// NamespaceEvents returns events scoped to a namespace.
func (s *Service) NamespaceEvents(namespace string) ([]restypes.Event, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace cannot be empty")
	}
	return s.Events(Filter{Namespace: namespace})
}

// ObjectEvents returns events tied to a specific object.
func (s *Service) ObjectEvents(resourceKind, namespace, name string) ([]restypes.Event, error) {
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

func convertEvent(kubeEvent corev1.Event) restypes.Event {
	e := restypes.Event{
		Kind:               "event",
		EventType:          kubeEvent.Type,
		Reason:             kubeEvent.Reason,
		Message:            kubeEvent.Message,
		Count:              kubeEvent.Count,
		InvolvedObjectName: kubeEvent.InvolvedObject.Name,
		InvolvedObjectKind: kubeEvent.InvolvedObject.Kind,
		Namespace:          kubeEvent.Namespace,
	}

	if !kubeEvent.EventTime.IsZero() {
		e.FirstTimestamp = kubeEvent.EventTime.Time
		e.LastTimestamp = kubeEvent.EventTime.Time
	} else {
		if !kubeEvent.FirstTimestamp.IsZero() {
			e.FirstTimestamp = kubeEvent.FirstTimestamp.Time
		}
		if !kubeEvent.LastTimestamp.IsZero() {
			e.LastTimestamp = kubeEvent.LastTimestamp.Time
		}
	}

	if kubeEvent.Source.Component != "" {
		e.Source = kubeEvent.Source.Component
		if kubeEvent.Source.Host != "" {
			e.Source += " on " + kubeEvent.Source.Host
		}
	} else if kubeEvent.ReportingController != "" {
		e.Source = kubeEvent.ReportingController
		if kubeEvent.ReportingInstance != "" {
			e.Source += " (" + kubeEvent.ReportingInstance + ")"
		}
	} else {
		e.Source = "Unknown"
	}

	return e
}

func sortEventsByTime(events []restypes.Event) {
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
