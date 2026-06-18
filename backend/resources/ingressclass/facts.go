/*
 * backend/resources/ingressclass/facts.go
 *
 * Canonical IngressClass facts — the single typed extraction of an IngressClass's
 * intrinsic fields.
 */

package ingressclass

// Facts is the canonical IngressClass model facts.
type Facts struct {
	Controller                  string `json:"controller,omitempty"`
	DefaultClass                bool   `json:"defaultClass"`
	DefaultClassAnnotation      string `json:"defaultClassAnnotation,omitempty"`
	DefaultClassAnnotationValue string `json:"defaultClassAnnotationValue,omitempty"`
}
