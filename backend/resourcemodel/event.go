package resourcemodel

import (
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func BuildEventResourceModel(clusterID string, event *corev1.Event) ResourceModel {
	facts := BuildEventFacts(clusterID, event)
	status := BuildEventStatusPresentation(event, facts)
	return networkResourceModel(clusterID, "", "v1", "Event", "events", ResourceScopeNamespaced, event.ObjectMeta, status, ResourceFacts{Event: &facts})
}

func BuildEventFacts(clusterID string, event *corev1.Event) EventFacts {
	if event == nil {
		return EventFacts{}
	}
	first, last := eventTimes(event)
	return EventFacts{
		EventType:      event.Type,
		Reason:         strings.TrimSpace(event.Reason),
		Message:        strings.TrimSpace(event.Message),
		Count:          event.Count,
		Source:         FormatEventSource(*event, ""),
		FirstTimestamp: first,
		LastTimestamp:  last,
		InvolvedObject: eventInvolvedObjectLink(clusterID, event.InvolvedObject),
	}
}

func BuildEventStatusPresentation(event *corev1.Event, facts EventFacts) ResourceStatusPresentation {
	state := strings.TrimSpace(facts.EventType)
	if state == "" {
		state = "Unknown"
	}
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "type",
		Status: state,
		Reason: facts.Reason,
	}}
	lifecycle := ResourceLifecycle{}
	if event != nil {
		lifecycle = NetworkLifecycle(event.ObjectMeta)
		if status, ok := DeletingNetworkStatus(event.ObjectMeta, state, signals, lifecycle); ok {
			return status
		}
	}
	return NetworkSourceStatus(state, state, facts.Reason, eventPresentation(state), signals, lifecycle)
}

func EventTimestamp(event *corev1.Event) metav1.Time {
	if event == nil {
		return metav1.Time{}
	}
	_, last := eventTimes(event)
	return last
}

func EventObjectDisplay(event *corev1.Event) string {
	if event == nil {
		return "-"
	}
	kind := strings.TrimSpace(event.InvolvedObject.Kind)
	name := strings.TrimSpace(event.InvolvedObject.Name)
	if kind != "" && name != "" {
		return fmt.Sprintf("%s/%s", kind, name)
	}
	if name != "" {
		return name
	}
	if kind != "" {
		return kind
	}
	return "-"
}

func EventMessage(event *corev1.Event) string {
	if event == nil {
		return ""
	}
	if msg := strings.TrimSpace(event.Message); msg != "" {
		return msg
	}
	return strings.TrimSpace(event.Reason)
}

func FormatEventSource(event corev1.Event, empty string) string {
	if event.Source.Component != "" {
		if event.Source.Host != "" {
			return fmt.Sprintf("%s on %s", event.Source.Component, event.Source.Host)
		}
		return event.Source.Component
	}
	if event.ReportingController != "" {
		if event.ReportingInstance != "" {
			return fmt.Sprintf("%s (%s)", event.ReportingController, event.ReportingInstance)
		}
		return event.ReportingController
	}
	return empty
}

func eventTimes(event *corev1.Event) (first, last metav1.Time) {
	if event == nil {
		return metav1.Time{}, metav1.Time{}
	}
	if !event.EventTime.IsZero() {
		first = metav1.NewTime(event.EventTime.Time)
		last = metav1.NewTime(event.EventTime.Time)
	}
	if first.IsZero() {
		first = event.FirstTimestamp
	}
	if last.IsZero() {
		last = event.LastTimestamp
	}
	if first.IsZero() {
		first = event.CreationTimestamp
	}
	if last.IsZero() {
		last = first
	}
	return first, last
}

func eventInvolvedObjectLink(clusterID string, ref corev1.ObjectReference) *ResourceLink {
	apiVersion := strings.TrimSpace(ref.APIVersion)
	group, version := "", ""
	if apiVersion != "" {
		group, version = splitAPIVersion(apiVersion)
	}
	kind := strings.TrimSpace(ref.Kind)
	name := strings.TrimSpace(ref.Name)
	namespace := strings.TrimSpace(ref.Namespace)
	uid := string(ref.UID)
	if kind == "" || name == "" {
		return nil
	}
	if version == "" {
		link := NewDisplayResourceLink(clusterID, group, version, kind, "", namespace, name)
		if link.Display != nil {
			link.Display.UID = uid
		}
		return &link
	}
	link := NewNamespacedResourceLink(clusterID, group, version, kind, "", namespace, name, uid)
	return &link
}

func eventPresentation(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case strings.ToLower(corev1.EventTypeNormal):
		return "ready"
	case strings.ToLower(corev1.EventTypeWarning):
		return "warning"
	default:
		return "unknown"
	}
}
