package backend

import (
	"context"
	"testing"
)

func TestWrapperGuardPathsRequireClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()

	errorCases := []struct {
		name string
		call func() error
	}{
		{"GetPod", func() error { _, err := app.GetPod("ns", "pod", false); return err }},
		{"DeletePod", func() error { return app.DeletePod("ns", "pod") }},
		{"PodContainers", func() error { _, err := app.GetPodContainers("ns", "pod"); return err }},
		{"PodDisruptionBudget", func() error { _, err := app.GetPodDisruptionBudget("ns", "pdb"); return err }},
		{"Service", func() error { _, err := app.GetService("ns", "svc"); return err }},
		{"EndpointSlice", func() error { _, err := app.GetEndpointSlice("ns", "ep"); return err }},
		{"Ingress", func() error { _, err := app.GetIngress("ns", "ing"); return err }},
		{"IngressClass", func() error { _, err := app.GetIngressClass("class"); return err }},
		{"NetworkPolicy", func() error { _, err := app.GetNetworkPolicy("ns", "np"); return err }},
		{"ConfigMap", func() error { _, err := app.GetConfigMap("ns", "cm"); return err }},
		{"Secret", func() error { _, err := app.GetSecret("ns", "sec"); return err }},
		{"LimitRange", func() error { _, err := app.GetLimitRange("ns", "lr"); return err }},
		{"ResourceQuota", func() error { _, err := app.GetResourceQuota("ns", "rq"); return err }},
		{"HelmDetails", func() error { _, err := app.GetHelmReleaseDetails("ns", "rel"); return err }},
		{"HelmManifest", func() error { _, err := app.GetHelmManifest("ns", "rel"); return err }},
		{"HelmValues", func() error { _, err := app.GetHelmValues("ns", "rel"); return err }},
		{"HelmDelete", func() error { return app.DeleteHelmRelease("ns", "rel") }},
		{"Deployment", func() error { _, err := app.GetDeployment("ns", "deploy"); return err }},
		{"StatefulSet", func() error { _, err := app.GetStatefulSet("ns", "sts"); return err }},
		{"DaemonSet", func() error { _, err := app.GetDaemonSet("ns", "ds"); return err }},
		{"Job", func() error { _, err := app.GetJob("ns", "job"); return err }},
		{"CronJob", func() error { _, err := app.GetCronJob("ns", "cj"); return err }},
		{"Namespace", func() error { _, err := app.GetNamespace("ns"); return err }},
		{"ClusterRole", func() error { _, err := app.GetClusterRole("cr"); return err }},
		{"ClusterRoleBinding", func() error { _, err := app.GetClusterRoleBinding("crb"); return err }},
		{"Role", func() error { _, err := app.GetRole("ns", "role"); return err }},
		{"RoleBinding", func() error { _, err := app.GetRoleBinding("ns", "rb"); return err }},
		{"ServiceAccount", func() error { _, err := app.GetServiceAccount("ns", "sa"); return err }},
		{"PersistentVolume", func() error { _, err := app.GetPersistentVolume("pv"); return err }},
		{"PersistentVolumeClaim", func() error { _, err := app.GetPersistentVolumeClaim("ns", "pvc"); return err }},
		{"StorageClass", func() error { _, err := app.GetStorageClass("sc"); return err }},
	}

	for _, tc := range errorCases {
		if err := tc.call(); err == nil {
			t.Fatalf("expected error for %s with nil client", tc.name)
		}
	}

	resp := app.LogFetcher(LogFetchRequest{Namespace: "ns", PodName: "pod"})
	if resp.Error == "" {
		t.Fatalf("expected error for LogFetcher without client")
	}
}
