package templates

import (
	"testing"

	"sigs.k8s.io/yaml"
)

func TestAllTemplatesAreValidYAML(t *testing.T) {
	templates := GetAll()
	if len(templates) == 0 {
		t.Fatal("expected at least one template")
	}

	for _, tmpl := range templates {
		t.Run(tmpl.Name, func(t *testing.T) {
			if tmpl.Name == "" {
				t.Fatal("template name is empty")
			}
			if tmpl.Kind == "" {
				t.Fatal("template kind is empty")
			}
			if tmpl.APIVersion == "" {
				t.Fatal("template apiVersion is empty")
			}
			if tmpl.Category == "" {
				t.Fatal("template category is empty")
			}
			if tmpl.Description == "" {
				t.Fatal("template description is empty")
			}
			if tmpl.YAML == "" {
				t.Fatal("template YAML is empty")
			}

			// Verify the YAML is parseable.
			var parsed map[string]interface{}
			if err := yaml.Unmarshal([]byte(tmpl.YAML), &parsed); err != nil {
				t.Fatalf("template YAML is invalid: %v", err)
			}

			// Verify apiVersion and kind in the YAML match the struct fields.
			if apiVersion, ok := parsed["apiVersion"].(string); !ok || apiVersion != tmpl.APIVersion {
				t.Fatalf("YAML apiVersion %q does not match struct field %q", parsed["apiVersion"], tmpl.APIVersion)
			}
			if kind, ok := parsed["kind"].(string); !ok || kind != tmpl.Kind {
				t.Fatalf("YAML kind %q does not match struct field %q", parsed["kind"], tmpl.Kind)
			}
		})
	}
}

func TestTemplateCategoriesAreValid(t *testing.T) {
	validCategories := map[string]bool{
		"Workloads":  true,
		"Networking": true,
		"Config":     true,
	}

	for _, tmpl := range GetAll() {
		if !validCategories[tmpl.Category] {
			t.Errorf("template %q has invalid category %q", tmpl.Name, tmpl.Category)
		}
	}
}

func TestTemplateNamesAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, tmpl := range GetAll() {
		if seen[tmpl.Name] {
			t.Errorf("duplicate template name: %s", tmpl.Name)
		}
		seen[tmpl.Name] = true
	}
}

func TestDeploymentTemplatePrepopulatesRequiredLabelAndNotOtherEditableFields(t *testing.T) {
	tmpl := deploymentTemplate()

	var parsed map[string]interface{}
	if err := yaml.Unmarshal([]byte(tmpl.YAML), &parsed); err != nil {
		t.Fatalf("deployment template YAML is invalid: %v", err)
	}

	metadata, ok := parsed["metadata"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing metadata object")
	}
	if value, exists := metadata["name"]; exists && value != nil && value != "" {
		t.Fatalf("expected metadata.name to be blank, got %#v", value)
	}
	labels, ok := metadata["labels"].(map[string]interface{})
	if !ok {
		t.Fatal("expected metadata.labels object to exist")
	}
	if value, exists := labels["app.kubernetes.io/name"]; !exists || (value != nil && value != "") {
		t.Fatalf("expected app.kubernetes.io/name label value to be blank, got %#v", value)
	}

	spec, ok := parsed["spec"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec object")
	}
	selector, ok := spec["selector"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.selector object")
	}
	matchLabels, ok := selector["matchLabels"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.selector.matchLabels object")
	}
	if value, exists := matchLabels["app.kubernetes.io/name"]; !exists || (value != nil && value != "") {
		t.Fatalf("expected selector app.kubernetes.io/name value to be blank, got %#v", value)
	}

	templateSpec, ok := spec["template"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.template object")
	}
	templateMetadata, ok := templateSpec["metadata"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.template.metadata object")
	}
	templateLabels, ok := templateMetadata["labels"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.template.metadata.labels object")
	}
	if value, exists := templateLabels["app.kubernetes.io/name"]; !exists || (value != nil && value != "") {
		t.Fatalf("expected template label app.kubernetes.io/name value to be blank, got %#v", value)
	}

	podSpec, ok := templateSpec["spec"].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template missing spec.template.spec object")
	}
	containers, ok := podSpec["containers"].([]interface{})
	if !ok || len(containers) == 0 {
		t.Fatal("deployment template missing containers list")
	}
	firstContainer, ok := containers[0].(map[string]interface{})
	if !ok {
		t.Fatal("deployment template has invalid first container structure")
	}
	if value, exists := firstContainer["name"]; exists && value != nil && value != "" {
		t.Fatalf("expected first container name to be blank, got %#v", value)
	}
	if _, exists := firstContainer["image"]; exists {
		t.Fatal("expected first container image to be omitted")
	}
	if _, exists := firstContainer["ports"]; exists {
		t.Fatal("expected first container ports to be omitted")
	}
	if _, exists := firstContainer["resources"]; exists {
		t.Fatal("expected first container resources to be omitted")
	}
}
