package certmanager

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/crdfacts"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type Facts struct {
	Conditions  []crdfacts.Condition         `json:"conditions,omitempty"`
	Issuer      *resourcemodel.ResourceLink  `json:"issuer,omitempty"`
	Secret      *resourcemodel.ResourceLink  `json:"secret,omitempty"`
	Owners      []resourcemodel.ResourceLink `json:"owners,omitempty"`
	Certificate *Certificate                 `json:"certificate,omitempty"`
	Request     *Request                     `json:"request,omitempty"`
	Authority   *Authority                   `json:"authority,omitempty"`
	Order       *Order                       `json:"order,omitempty"`
	Challenge   *Challenge                   `json:"challenge,omitempty"`
}

type Certificate struct {
	CommonName     string      `json:"commonName,omitempty"`
	DNSNames       []string    `json:"dnsNames,omitempty"`
	IPAddresses    []string    `json:"ipAddresses,omitempty"`
	URIs           []string    `json:"uris,omitempty"`
	EmailAddresses []string    `json:"emailAddresses,omitempty"`
	Duration       string      `json:"duration,omitempty"`
	RenewBefore    string      `json:"renewBefore,omitempty"`
	IsCA           bool        `json:"isCA"`
	Usages         []string    `json:"usages,omitempty"`
	PrivateKey     *PrivateKey `json:"privateKey,omitempty"`
	NotBefore      string      `json:"notBefore,omitempty"`
	NotAfter       string      `json:"notAfter,omitempty"`
	RenewalTime    string      `json:"renewalTime,omitempty"`
	Revision       *int64      `json:"revision,omitempty"`
}
type PrivateKey struct {
	Algorithm      string `json:"algorithm,omitempty"`
	Size           *int64 `json:"size,omitempty"`
	Encoding       string `json:"encoding,omitempty"`
	RotationPolicy string `json:"rotationPolicy,omitempty"`
}
type Request struct {
	Duration    string   `json:"duration,omitempty"`
	IsCA        bool     `json:"isCA"`
	Usages      []string `json:"usages,omitempty"`
	FailureTime string   `json:"failureTime,omitempty"`
}
type Authority struct {
	Type    string   `json:"type"`
	Server  string   `json:"server,omitempty"`
	Email   string   `json:"email,omitempty"`
	Path    string   `json:"path,omitempty"`
	Solvers []string `json:"solvers,omitempty"`
}
type Order struct {
	DNSNames    []string `json:"dnsNames,omitempty"`
	Duration    string   `json:"duration,omitempty"`
	State       string   `json:"state,omitempty"`
	Reason      string   `json:"reason,omitempty"`
	URL         string   `json:"url,omitempty"`
	FailureTime string   `json:"failureTime,omitempty"`
}
type Challenge struct {
	DNSName    string `json:"dnsName,omitempty"`
	Type       string `json:"type,omitempty"`
	Wildcard   bool   `json:"wildcard"`
	Presented  *bool  `json:"presented,omitempty"`
	Processing *bool  `json:"processing,omitempty"`
	State      string `json:"state,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

func matches(object *unstructured.Unstructured) bool {
	return object != nil && resourcekind.FamilyForResource(object.GroupVersionKind().Group, object.GetKind(), object.GetNamespace() != "") == resourcekind.CertManagerFamily
}

func BuildFacts(clusterID string, object *unstructured.Unstructured) *Facts {
	if !matches(object) {
		return nil
	}
	facts := &Facts{Conditions: crdfacts.Conditions(object), Issuer: issuerLink(clusterID, object)}
	switch strings.ToLower(object.GetKind()) {
	case "certificate":
		facts.Certificate = certificate(object)
		facts.Secret = crdfacts.Secret(clusterID, object.GetNamespace(), crdfacts.Text(object.Object, "spec", "secretName"))
	case "certificaterequest":
		facts.Request = crdfacts.Read[Request](object.Object, "spec")
		if facts.Request != nil {
			facts.Request.FailureTime = crdfacts.Text(object.Object, "status", "failureTime")
		}
		facts.Owners = certificateOwners(clusterID, object, "Certificate")
	case "issuer", "clusterissuer":
		facts.Authority = authority(object)
	case "order":
		facts.Order = order(object)
		facts.Owners = certificateOwners(clusterID, object, "CertificateRequest")
	case "challenge":
		facts.Challenge = challenge(object)
		facts.Owners = certificateOwners(clusterID, object, "Order")
	}
	return facts
}

func certificate(object *unstructured.Unstructured) *Certificate {
	facts := crdfacts.Read[Certificate](object.Object, "spec")
	if facts == nil {
		return nil
	}
	facts.NotBefore = crdfacts.Text(object.Object, "status", "notBefore")
	facts.NotAfter = crdfacts.Text(object.Object, "status", "notAfter")
	facts.RenewalTime = crdfacts.Text(object.Object, "status", "renewalTime")
	facts.Revision = crdfacts.Number(object.Object, "status", "revision")
	return facts
}

func issuerLink(clusterID string, object *unstructured.Unstructured) *resourcemodel.ResourceLink {
	name := crdfacts.Text(object.Object, "spec", "issuerRef", "name")
	group := crdfacts.Text(object.Object, "spec", "issuerRef", "group")
	if group == "" {
		group = "cert-manager.io"
	}
	kind := crdfacts.Text(object.Object, "spec", "issuerRef", "kind")
	if kind == "" {
		kind = "Issuer"
	}
	namespace := object.GetNamespace()
	if kind == "ClusterIssuer" {
		namespace = ""
	}
	return crdfacts.Reference(clusterID, group, kind, namespace, name)
}

func certificateOwners(clusterID string, object *unstructured.Unstructured, kind string) []resourcemodel.ResourceLink {
	group := "cert-manager.io"
	if kind == "Order" {
		group = "acme.cert-manager.io"
	}
	return crdfacts.Owners(clusterID, object, group, kind)
}

func authority(object *unstructured.Unstructured) *Authority {
	facts := &Authority{Type: strings.Join(crdfacts.Keys(object.Object, "spec"), ", ")}
	for _, provider := range []string{"acme", "vault", "venafi"} {
		if server := crdfacts.Text(object.Object, "spec", provider, "server"); server != "" {
			facts.Server = server
		}
	}
	facts.Email = crdfacts.Text(object.Object, "spec", "acme", "email")
	facts.Path = crdfacts.Text(object.Object, "spec", "vault", "path")
	solvers, _, _ := unstructured.NestedSlice(object.Object, "spec", "acme", "solvers")
	for _, solver := range solvers {
		if s, ok := solver.(map[string]any); ok {
			facts.Solvers = append(facts.Solvers, solverTypes(s)...)
		}
	}
	return facts
}

func solverTypes(solver map[string]any) []string {
	var result []string
	if _, found := solver["http01"]; found {
		result = append(result, "HTTP-01")
	}
	for _, provider := range crdfacts.Keys(solver, "dns01") {
		if _, found, _ := unstructured.NestedMap(solver, "dns01", provider); found {
			result = append(result, "DNS-01 ("+provider+")")
		}
	}
	return result
}

func order(object *unstructured.Unstructured) *Order {
	facts := crdfacts.Read[Order](object.Object, "status")
	if facts == nil {
		facts = &Order{}
	}
	facts.DNSNames = crdfacts.Strings(object.Object, "spec", "dnsNames")
	facts.Duration = crdfacts.Text(object.Object, "spec", "duration")
	return facts
}

func challenge(object *unstructured.Unstructured) *Challenge {
	facts := crdfacts.Read[Challenge](object.Object, "spec")
	if facts == nil {
		facts = &Challenge{}
	}
	facts.Presented = crdfacts.Bool(object.Object, "status", "presented")
	facts.Processing = crdfacts.Bool(object.Object, "status", "processing")
	facts.State = crdfacts.Text(object.Object, "status", "state")
	facts.Reason = crdfacts.Text(object.Object, "status", "reason")
	return facts
}

func PrimaryStatus(object *unstructured.Unstructured) (state, label, presentation string, ok bool) {
	if !matches(object) {
		return "", "", "", false
	}
	conditions := crdfacts.Conditions(object)
	if denied := crdfacts.FindCondition(conditions, "Denied"); denied != nil && denied.Status == "True" {
		return "Denied", "Denied", "error", true
	}
	if state = crdfacts.Text(object.Object, "status", "state"); state != "" {
		return state, state, acmePresentation(state), true
	}
	state, label, presentation = crdfacts.Readiness(conditions, "Ready")
	return state, label, presentation, true
}

func acmePresentation(state string) string {
	switch state {
	case "valid":
		return "ready"
	case "pending", "processing", "ready":
		return "progressing"
	case "invalid", "expired", "revoked", "deactivated", "errored":
		return "error"
	default:
		return "unknown"
	}
}
