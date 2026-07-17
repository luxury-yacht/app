/*
 * backend/resources/events/model.go
 *
 * Event resource model: the single definition of an Event's intrinsic fields +
 * status presentation, plus the shared event display helpers (timestamp/object/
 * message/source) used across the live event stream and snapshot summaries. Shared
 * model helpers are reused from resourcemodel (exported network base).
 */

package events

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// BuildResourceModel builds the Event resource model. Facts are owned by this
// package (events.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, event *corev1.Event) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, event)
	status := statusPresentation(event, facts)
	return resourcemodel.NetworkResourceModel(clusterID, "", "v1", "Event", "events", resourcemodel.ResourceScopeNamespaced, event.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Event facts from the raw object.
func BuildFacts(clusterID string, event *corev1.Event) Facts {
	if event == nil {
		return Facts{}
	}
	first, last := eventTimes(event)
	facts := Facts{
		EventType:               event.Type,
		Reason:                  strings.TrimSpace(event.Reason),
		Message:                 strings.TrimSpace(event.Message),
		Count:                   event.Count,
		Source:                  FormatEventSource(*event, ""),
		FirstTimestamp:          first,
		LastTimestamp:           last,
		Action:                  strings.TrimSpace(event.Action),
		ReportingController:     strings.TrimSpace(event.ReportingController),
		ReportingInstance:       strings.TrimSpace(event.ReportingInstance),
		InvolvedObject:          eventObjectLink(clusterID, event.InvolvedObject),
		InvolvedObjectFieldPath: strings.TrimSpace(event.InvolvedObject.FieldPath),
	}
	if !event.EventTime.IsZero() {
		eventTime := metav1.NewTime(event.EventTime.Time)
		facts.EventTime = &eventTime
	}
	if event.Series != nil {
		seriesCount := event.Series.Count
		facts.SeriesCount = &seriesCount
		if !event.Series.LastObservedTime.IsZero() {
			lastObserved := metav1.NewTime(event.Series.LastObservedTime.Time)
			facts.SeriesLastObservedTime = &lastObserved
		}
	}
	if event.Related != nil {
		facts.RelatedObject = eventObjectLink(clusterID, *event.Related)
		facts.RelatedObjectFieldPath = strings.TrimSpace(event.Related.FieldPath)
	}
	return facts
}

func statusPresentation(event *corev1.Event, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strings.TrimSpace(facts.EventType)
	if state == "" {
		state = "Unknown"
	}
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "type",
		Status: state,
		Reason: facts.Reason,
	}}
	lifecycle := resourcemodel.ResourceLifecycle{}
	if event != nil {
		lifecycle = resourcemodel.NetworkLifecycle(event.ObjectMeta)
		if status, ok := resourcemodel.DeletingNetworkStatus(event.ObjectMeta, state, signals, lifecycle); ok {
			return status
		}
	}
	return resourcemodel.NetworkSourceStatus(state, state, facts.Reason, eventPresentation(state), signals, lifecycle)
}

// EventTimestamp returns the most-recent timestamp for an event (last seen, falling
// back through event-time/first-seen/creation).
func EventTimestamp(event *corev1.Event) metav1.Time {
	if event == nil {
		return metav1.Time{}
	}
	_, last := eventTimes(event)
	return last
}

// EventObjectDisplay renders the involved object as "Kind/Name" (or the available part).
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

// EventMessage returns the event message (falling back to the reason).
func EventMessage(event *corev1.Event) string {
	if event == nil {
		return ""
	}
	if msg := strings.TrimSpace(event.Message); msg != "" {
		return msg
	}
	return strings.TrimSpace(event.Reason)
}

// FormatEventSource renders the event source (component/host or reporting
// controller/instance), returning empty when neither is set.
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
	}
	if first.IsZero() {
		first = event.FirstTimestamp
	}
	if first.IsZero() {
		first = event.CreationTimestamp
	}
	last = first
	for _, candidate := range []metav1.Time{event.LastTimestamp, eventSeriesLastObservedTime(event)} {
		if !candidate.IsZero() && (last.IsZero() || candidate.After(last.Time)) {
			last = candidate
		}
	}
	if last.IsZero() {
		last = event.CreationTimestamp
	}
	return first, last
}

func eventSeriesLastObservedTime(event *corev1.Event) metav1.Time {
	if event == nil || event.Series == nil || event.Series.LastObservedTime.IsZero() {
		return metav1.Time{}
	}
	return metav1.NewTime(event.Series.LastObservedTime.Time)
}

func eventObjectLink(clusterID string, ref corev1.ObjectReference) *resourcemodel.ResourceLink {
	apiVersion := strings.TrimSpace(ref.APIVersion)
	group, version := "", ""
	if apiVersion != "" {
		group, version = resourcemodel.SplitAPIVersion(apiVersion)
	}
	kind := strings.TrimSpace(ref.Kind)
	name := strings.TrimSpace(ref.Name)
	namespace := strings.TrimSpace(ref.Namespace)
	uid := string(ref.UID)
	if kind == "" || name == "" {
		return nil
	}
	if version == "" {
		link := resourcemodel.NewDisplayResourceLink(clusterID, group, version, kind, "", namespace, name)
		if link.Display != nil {
			link.Display.UID = uid
		}
		return &link
	}
	link := resourcemodel.NewNamespacedResourceLink(clusterID, group, version, kind, "", namespace, name, uid)
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
