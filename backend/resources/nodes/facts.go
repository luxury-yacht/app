/*
 * backend/resources/nodes/facts.go
 *
 * Canonical Node facts. Conditions are shared ConditionFacts (resourcemodel);
 * TaintFacts is Node-only and owned here.
 */

package nodes

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Node model facts.
type Facts struct {
	Roles         []string                       `json:"roles,omitempty"`
	Unschedulable bool                           `json:"unschedulable"`
	Cordoned      bool                           `json:"cordoned"`
	Conditions    []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	Taints        []TaintFacts                   `json:"taints,omitempty"`
}

// TaintFacts describes a single Node taint.
type TaintFacts struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect,omitempty"`
}
