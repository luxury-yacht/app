/*
 * backend/resources/pods/facts.go
 *
 * Canonical Pod facts — the shared readiness/phase extraction reused by the table,
 * detail, and object-map projections. Conditions reference the shared ConditionFacts
 * (resourcemodel). (PodTemplateFacts, which the workload kinds embed, is a separate
 * type that stays in resourcemodel.)
 */

package pods

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Pod model facts.
type Facts struct {
	Phase           string                         `json:"phase,omitempty"`
	NodeName        string                         `json:"nodeName,omitempty"`
	PodIP           string                         `json:"podIP,omitempty"`
	ReadyContainers int32                          `json:"readyContainers"`
	TotalContainers int32                          `json:"totalContainers"`
	RestartCount    int32                          `json:"restartCount"`
	Conditions      []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
}
