package genrefreshcontracts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
)

// authoredScopeContract is one domain's scope language. Valid and invalid hold
// canonical scope tails (after "<clusterId>|") that both layers' codecs must
// accept or reject; the generator validates only the vocabulary.
type authoredScopeContract struct {
	Selectors []string `json:"selectors"`
	Query     string   `json:"query"`
	Valid     []string `json:"valid"`
	Invalid   []string `json:"invalid,omitempty"`
}

type authoredDomainInventory struct {
	BehaviorClass      string                `json:"behaviorClass"`
	ScopeContract      authoredScopeContract `json:"scopeContract"`
	SingleCluster      bool                  `json:"singleCluster"`
	PayloadOwner       string                `json:"payloadOwner"`
	RefreshPayloadType json.RawMessage       `json:"refreshPayloadType"`
	CachePolicy        string                `json:"cachePolicy"`
	StreamSemantics    []string              `json:"streamSemantics"`
	CoverageContract   string                `json:"coverageContract"`
	CoverageStatus     string                `json:"coverageStatus"`
}

type authoredBackendPolicy struct {
	Registration       string `json:"registration"`
	Permission         string `json:"permission"`
	ResourceStream     bool   `json:"resourceStream"`
	BypassSingleflight bool   `json:"bypassSingleflight,omitempty"`
}

type authoredFrontendTiming struct {
	Interval int `json:"interval"`
	Timeout  int `json:"timeout"`
}

type authoredFrontendPolicy struct {
	Orchestrator      string                 `json:"orchestrator"`
	DiagnosticsStream json.RawMessage        `json:"diagnosticsStream"`
	Timing            authoredFrontendTiming `json:"timing"`
	Priority          *int                   `json:"priority,omitempty"`
	RegistrationOrder *int                   `json:"registrationOrder"`
}

type authoredDomainRegistration struct {
	Domain       string                 `json:"domain"`
	Category     string                 `json:"category"`
	SourceClocks []string               `json:"sourceClocks,omitempty"`
	Backend      authoredBackendPolicy  `json:"backend"`
	Frontend     authoredFrontendPolicy `json:"frontend"`
}

type authoredDomainContract struct {
	Version         int                                `json:"version"`
	DomainInventory map[string]authoredDomainInventory `json:"domainInventory"`
	ResourceStream  json.RawMessage                    `json:"resourceStream"`
	Domains         []authoredDomainRegistration       `json:"domains"`
}

var knownCachePolicies = stringSet(
	"snapshot-cache",
	"snapshot-cache-with-merge",
	"snapshot-cache-bypass",
	"snapshot-cache-plus-provider-cache",
	"provider-cache",
	"external-catalog-cache",
	"external-catalog-cache-with-merge",
	"stream-only",
)

var knownDomainCategories = stringSet("system", "cluster", "namespace")
var knownSourceClocks = stringSet("object", "metric", "event", "catalog", "attention")
var knownBackendRegistrations = stringSet("direct", "list", "listWatch", "streamOnly")
var knownBackendPermissions = stringSet("runtime", "exempt", "stream-specific")
var knownFrontendOrchestrators = stringSet(
	"snapshot",
	"doorbell-snapshot",
	"resource-stream",
	"catalog-stream",
	"container-logs-stream",
)
var knownDiagnosticsStreams = stringSet("resources", "container-logs")

// knownScopeSelectors and knownScopeQueries mirror refresh.ScopeSelectorKind
// and refresh.ScopeQueryMode; the generated Go policy references those constants,
// so an unknown value here would fail to compile there.
var knownScopeSelectors = []string{"cluster", "namespace", "all-namespaces", "node", "workload", "object", "helm-release"}
var knownScopeQueries = []string{"none", "typed-table", "object-map", "catalog"}

func stringSet(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func loadContractDomains() ([]domainSpec, error) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		return nil, fmt.Errorf("locate refresh domain contract: caller path unavailable")
	}
	contractPath := filepath.Join(filepath.Dir(sourceFile), "..", "..", "refresh", "domain", "refresh-domain-contract.json")
	contents, err := os.ReadFile(contractPath)
	if err != nil {
		return nil, fmt.Errorf("read refresh domain contract: %w", err)
	}
	return parseContractDomains(contents)
}

func parseContractDomains(contents []byte) ([]domainSpec, error) {
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	var authored authoredDomainContract
	if err := decoder.Decode(&authored); err != nil {
		return nil, fmt.Errorf("decode refresh domain contract: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	if authored.Version != 2 {
		return nil, fmt.Errorf("refresh domain contract version must be 2, got %d", authored.Version)
	}
	if len(authored.Domains) == 0 {
		return nil, fmt.Errorf("refresh domain contract has no domain registrations")
	}

	result := make([]domainSpec, 0, len(authored.Domains))
	seenDomains := make(map[string]struct{}, len(authored.Domains))
	seenFrontendOrder := make(map[int]string, len(authored.Domains))
	for _, registration := range authored.Domains {
		domain, err := contractDomainSpec(registration, authored.DomainInventory, seenDomains, seenFrontendOrder)
		if err != nil {
			return nil, err
		}
		result = append(result, domain)
	}
	if len(seenDomains) != len(authored.DomainInventory) {
		return nil, fmt.Errorf("refresh domain contract has %d inventory entries but %d registrations", len(authored.DomainInventory), len(seenDomains))
	}
	for order := range result {
		if _, ok := seenFrontendOrder[order]; !ok {
			return nil, fmt.Errorf("refresh domain contract is missing frontend registrationOrder %d", order)
		}
	}
	return result, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("decode refresh domain contract: unexpected trailing JSON value")
		}
		return fmt.Errorf("decode refresh domain contract: %w", err)
	}
	return nil
}

type parsedFrontendDomainPolicy struct {
	diagnosticsStream string
	priority          int
	hasPriority       bool
	registrationOrder int
}

func registeredDomainInventory(
	registration authoredDomainRegistration,
	inventoryByDomain map[string]authoredDomainInventory,
	seenDomains map[string]struct{},
) (authoredDomainInventory, error) {
	if registration.Domain == "" {
		return authoredDomainInventory{}, fmt.Errorf("refresh domain contract contains an empty domain registration")
	}
	if _, duplicate := seenDomains[registration.Domain]; duplicate {
		return authoredDomainInventory{}, fmt.Errorf("refresh domain contract registers %q more than once", registration.Domain)
	}
	inventory, ok := inventoryByDomain[registration.Domain]
	if !ok {
		return authoredDomainInventory{}, fmt.Errorf("refresh domain %q is missing from domainInventory", registration.Domain)
	}
	return inventory, nil
}

func validateDomainPolicies(
	registration authoredDomainRegistration,
	inventory authoredDomainInventory,
) error {
	if err := validateKnownValue(registration.Domain, "cachePolicy", inventory.CachePolicy, knownCachePolicies); err != nil {
		return err
	}
	if err := validateKnownValue(registration.Domain, "category", registration.Category, knownDomainCategories); err != nil {
		return err
	}
	if err := validateKnownValue(registration.Domain, "backend.registration", registration.Backend.Registration, knownBackendRegistrations); err != nil {
		return err
	}
	if err := validateKnownValue(registration.Domain, "backend.permission", registration.Backend.Permission, knownBackendPermissions); err != nil {
		return err
	}
	return validateKnownValue(registration.Domain, "frontend.orchestrator", registration.Frontend.Orchestrator, knownFrontendOrchestrators)
}

func parseFrontendDomainPolicy(
	registration authoredDomainRegistration,
	inventorySize int,
	seenFrontendOrder map[int]string,
) (parsedFrontendDomainPolicy, error) {
	if registration.Frontend.Timing.Interval <= 0 || registration.Frontend.Timing.Timeout <= 0 {
		return parsedFrontendDomainPolicy{}, fmt.Errorf("refresh domain %q has non-positive frontend timing", registration.Domain)
	}
	if registration.Frontend.Priority != nil && *registration.Frontend.Priority < 0 {
		return parsedFrontendDomainPolicy{}, fmt.Errorf("refresh domain %q has a negative frontend priority", registration.Domain)
	}
	registrationOrder, err := parseFrontendRegistrationOrder(registration, inventorySize, seenFrontendOrder)
	if err != nil {
		return parsedFrontendDomainPolicy{}, err
	}
	diagnosticsStream, err := decodeNullableString(registration.Frontend.DiagnosticsStream)
	if err != nil {
		return parsedFrontendDomainPolicy{}, fmt.Errorf("refresh domain %q frontend.diagnosticsStream: %w", registration.Domain, err)
	}
	if diagnosticsStream != "" {
		if err := validateKnownValue(registration.Domain, "frontend.diagnosticsStream", diagnosticsStream, knownDiagnosticsStreams); err != nil {
			return parsedFrontendDomainPolicy{}, err
		}
	}

	policy := parsedFrontendDomainPolicy{
		diagnosticsStream: diagnosticsStream,
		hasPriority:       registration.Frontend.Priority != nil,
		registrationOrder: registrationOrder,
	}
	if policy.hasPriority {
		policy.priority = *registration.Frontend.Priority
	}
	return policy, nil
}

// parseFrontendRegistrationOrder requires a unique order within the inventory.
func parseFrontendRegistrationOrder(
	registration authoredDomainRegistration,
	inventorySize int,
	seenFrontendOrder map[int]string,
) (int, error) {
	if registration.Frontend.RegistrationOrder == nil {
		return 0, fmt.Errorf("refresh domain %q is missing frontend.registrationOrder", registration.Domain)
	}
	registrationOrder := *registration.Frontend.RegistrationOrder
	if registrationOrder < 0 || registrationOrder >= inventorySize {
		return 0, fmt.Errorf("refresh domain %q has out-of-range frontend.registrationOrder %d", registration.Domain, registrationOrder)
	}
	if previous, duplicate := seenFrontendOrder[registrationOrder]; duplicate {
		return 0, fmt.Errorf("refresh domains %q and %q share frontend.registrationOrder %d", previous, registration.Domain, registrationOrder)
	}
	return registrationOrder, nil
}

func validateDomainSourceClocks(registration authoredDomainRegistration) error {
	seenClocks := make(map[string]struct{}, len(registration.SourceClocks))
	for _, source := range registration.SourceClocks {
		if err := validateKnownValue(registration.Domain, "sourceClocks", source, knownSourceClocks); err != nil {
			return err
		}
		if _, duplicate := seenClocks[source]; duplicate {
			return fmt.Errorf("refresh domain %q declares source clock %q more than once", registration.Domain, source)
		}
		seenClocks[source] = struct{}{}
	}
	return nil
}

func contractDomainSpec(
	registration authoredDomainRegistration,
	inventoryByDomain map[string]authoredDomainInventory,
	seenDomains map[string]struct{},
	seenFrontendOrder map[int]string,
) (domainSpec, error) {
	inventory, err := registeredDomainInventory(registration, inventoryByDomain, seenDomains)
	if err != nil {
		return domainSpec{}, err
	}
	if err := validateDomainPolicies(registration, inventory); err != nil {
		return domainSpec{}, err
	}
	frontend, err := parseFrontendDomainPolicy(registration, len(inventoryByDomain), seenFrontendOrder)
	if err != nil {
		return domainSpec{}, err
	}
	if err := validateDomainSourceClocks(registration); err != nil {
		return domainSpec{}, err
	}
	if err := validateScopeContract(registration.Domain, inventory.ScopeContract); err != nil {
		return domainSpec{}, err
	}

	payload, frontendOwned, err := decodePayloadType(inventory.RefreshPayloadType)
	if err != nil {
		return domainSpec{}, fmt.Errorf("refresh domain %q refreshPayloadType: %w", registration.Domain, err)
	}

	seenDomains[registration.Domain] = struct{}{}
	seenFrontendOrder[frontend.registrationOrder] = registration.Domain
	return domainSpec{
		domain:                    registration.Domain,
		payload:                   payload,
		frontendOwned:             frontendOwned,
		cachePolicy:               inventory.CachePolicy,
		category:                  registration.Category,
		sourceClocks:              append([]string(nil), registration.SourceClocks...),
		backendRegistration:       registration.Backend.Registration,
		backendPermission:         registration.Backend.Permission,
		backendResourceStream:     registration.Backend.ResourceStream,
		backendBypassSingleflight: registration.Backend.BypassSingleflight,
		frontendOrchestrator:      registration.Frontend.Orchestrator,
		frontendDiagnosticsStream: frontend.diagnosticsStream,
		frontendTimingInterval:    registration.Frontend.Timing.Interval,
		frontendTimingTimeout:     registration.Frontend.Timing.Timeout,
		frontendPriority:          frontend.priority,
		frontendHasPriority:       frontend.hasPriority,
		frontendRegistrationOrder: frontend.registrationOrder,
		scopeSelectors:            append([]string(nil), inventory.ScopeContract.Selectors...),
		scopeQuery:                inventory.ScopeContract.Query,
	}, nil
}

func validateScopeContract(domain string, contract authoredScopeContract) error {
	if len(contract.Selectors) == 0 {
		return fmt.Errorf("refresh domain %q scopeContract.selectors is empty", domain)
	}
	known := stringSet(knownScopeSelectors...)
	seen := make(map[string]struct{}, len(contract.Selectors))
	for _, selector := range contract.Selectors {
		if err := validateKnownValue(domain, "scopeContract.selectors", selector, known); err != nil {
			return err
		}
		if _, duplicate := seen[selector]; duplicate {
			return fmt.Errorf("refresh domain %q declares scope selector %q more than once", domain, selector)
		}
		seen[selector] = struct{}{}
	}
	if err := validateKnownValue(domain, "scopeContract.query", contract.Query, stringSet(knownScopeQueries...)); err != nil {
		return err
	}
	// A catalog tail is the query itself, so there is no selector to choose.
	if contract.Query == "catalog" && (len(contract.Selectors) != 1 || contract.Selectors[0] != "cluster") {
		return fmt.Errorf("refresh domain %q catalog scope query requires exactly the cluster selector", domain)
	}
	if len(contract.Valid) == 0 {
		return fmt.Errorf("refresh domain %q scopeContract.valid is empty", domain)
	}
	return nil
}

func validateKnownValue(domain, field, value string, known map[string]struct{}) error {
	if _, ok := known[value]; !ok {
		return fmt.Errorf("refresh domain %q has unsupported %s %q", domain, field, value)
	}
	return nil
}

func decodeNullableString(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("value is missing")
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	if value == "" {
		return "", fmt.Errorf("value is empty")
	}
	return value, nil
}

func decodePayloadType(raw json.RawMessage) (payload string, frontendOwned bool, err error) {
	payload, err = decodeNullableString(raw)
	if err != nil {
		return "", false, err
	}
	return payload, payload == "", nil
}

func validateDomainPayloadTypes(domains []domainSpec, typesByName map[string]reflect.Type) error {
	for _, domain := range domains {
		if domain.frontendOwned {
			continue
		}
		if _, ok := typesByName[domain.payload]; !ok {
			return fmt.Errorf("refresh domain %q references unregistered payload type %q", domain.domain, domain.payload)
		}
	}
	return nil
}
