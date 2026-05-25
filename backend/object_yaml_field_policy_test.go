package backend

import (
	"encoding/json"
	"os"
	"testing"
)

type objectYAMLFieldPolicyContract struct {
	Version int `json:"version"`
	Fields  []struct {
		Path            []string `json:"path"`
		BackendBehavior string   `json:"backendBehavior"`
	} `json:"fields"`
}

func TestYAMLFieldPolicyContract(t *testing.T) {
	payload, err := os.ReadFile("object-yaml-field-policy-contract.json")
	if err != nil {
		t.Fatalf("failed to read YAML field policy contract: %v", err)
	}

	var contract objectYAMLFieldPolicyContract
	if err := json.Unmarshal(payload, &contract); err != nil {
		t.Fatalf("failed to decode YAML field policy contract: %v", err)
	}
	if contract.Version != 1 {
		t.Fatalf("expected YAML field policy contract version 1, got %d", contract.Version)
	}

	goBehaviors := objectYAMLFieldPolicyBackendBehavior()
	jsonBehaviors := map[string]objectYAMLBackendBehavior{}
	for _, field := range contract.Fields {
		if field.BackendBehavior == "" {
			continue
		}
		behavior := objectYAMLBackendBehavior(field.BackendBehavior)
		switch behavior {
		case objectYAMLBackendReject, objectYAMLBackendStrip, objectYAMLBackendPreserve, objectYAMLBackendAllow:
		default:
			t.Fatalf("contract field %v has unknown backendBehavior %q", field.Path, field.BackendBehavior)
		}
		key := objectYAMLFieldPathKey(field.Path)
		jsonBehaviors[key] = behavior
		if got, ok := goBehaviors[key]; !ok {
			t.Fatalf("contract field %v has backendBehavior %q but no Go enforcement entry", field.Path, field.BackendBehavior)
		} else if got != behavior {
			t.Fatalf("contract field %v behavior mismatch: contract=%q go=%q", field.Path, field.BackendBehavior, got)
		}
	}

	for _, rule := range objectYAMLFieldPolicyRules {
		key := objectYAMLFieldPathKey(rule.path)
		if got, ok := jsonBehaviors[key]; !ok {
			t.Fatalf("Go enforcement field %v has no JSON contract backendBehavior", rule.path)
		} else if got != rule.behavior {
			t.Fatalf("Go enforcement field %v behavior mismatch: contract=%q go=%q", rule.path, got, rule.behavior)
		}
	}
}
