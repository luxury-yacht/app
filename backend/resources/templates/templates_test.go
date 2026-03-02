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
