package backend

import (
	"testing"

	clientfake "k8s.io/client-go/kubernetes/fake"
)

func TestObjectYamlOperationsRejectInvalidOrDeniedRequestsBeforePatch(t *testing.T) {
	operations := map[string]func(*ResourceGateway, string, ObjectYAMLMutationRequest) error{
		"validate": func(g *ResourceGateway, clusterID string, req ObjectYAMLMutationRequest) error {
			_, err := g.ValidateObjectYaml(clusterID, req)
			return err
		},
		"apply": func(g *ResourceGateway, clusterID string, req ObjectYAMLMutationRequest) error {
			_, err := g.ApplyObjectYaml(clusterID, req)
			return err
		},
		"ownership": func(g *ResourceGateway, clusterID string, req ObjectYAMLMutationRequest) error {
			_, err := g.CheckObjectYamlOwnership(clusterID, req)
			return err
		},
	}
	for name, operation := range operations {
		for _, failure := range []string{"missing-cluster", "invalid-draft", "permission-denied"} {
			t.Run(name+"/"+failure, func(t *testing.T) {
				gateway, dynamicClient, clusterID := setupYAMLTestApp(t)
				req := ownershipRequest(ownershipEditedYAML())
				switch failure {
				case "missing-cluster":
					clusterID = ""
				case "invalid-draft":
					req.YAML = "[invalid: yaml"
				case "permission-denied":
					deps, _, err := gateway.resolveClusterDependencies(clusterID)
					if err != nil {
						t.Fatal(err)
					}
					denySelfSubjectAccessReviews(deps.KubernetesClient.(*clientfake.Clientset), "patch denied")
				}
				if err := operation(gateway, clusterID, req); err == nil {
					t.Fatal("expected request rejection")
				}
				for _, action := range dynamicClient.Actions() {
					if action.GetVerb() == "patch" {
						t.Fatalf("rejected request reached Kubernetes patch: %#v", action)
					}
				}
			})
		}
	}
}
