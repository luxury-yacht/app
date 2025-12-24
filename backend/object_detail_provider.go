package backend

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

type objectDetailProvider struct {
	app *App
}

func (a *App) objectDetailProvider() snapshot.ObjectDetailProvider {
	return &objectDetailProvider{app: a}
}

func (p *objectDetailProvider) FetchObjectYAML(_ context.Context, kind, namespace, name string) (string, error) {
	return p.app.GetObjectYAML(kind, namespace, name)
}

func (p *objectDetailProvider) FetchHelmManifest(_ context.Context, namespace, name string) (string, int, error) {
	manifest, err := p.app.GetHelmManifest(namespace, name)
	if err != nil {
		return "", 0, err
	}
	details, err := p.app.GetHelmReleaseDetails(namespace, name)
	if err != nil || details == nil {
		return manifest, 0, nil
	}
	return manifest, details.Revision, nil
}

func (p *objectDetailProvider) FetchHelmValues(_ context.Context, namespace, name string) (map[string]interface{}, int, error) {
	values, err := p.app.GetHelmValues(namespace, name)
	if err != nil {
		return nil, 0, err
	}
	details, err := p.app.GetHelmReleaseDetails(namespace, name)
	if err != nil || details == nil {
		return values, 0, nil
	}
	return values, details.Revision, nil
}

func (p *objectDetailProvider) FetchObjectDetails(_ context.Context, kind, namespace, name string) (interface{}, string, error) {
	// Delegates to existing App getters so the frontend continues to receive
	// the rich detail structures that were previously exposed via RPC.
	switch strings.ToLower(kind) {
	case "pod":
		detail, err := p.app.GetPod(namespace, name, true)
		return detail, "", err
	case "deployment":
		detail, err := p.app.GetDeployment(namespace, name)
		return detail, "", err
	case "replicaset":
		detail, err := p.app.GetReplicaSet(namespace, name)
		return detail, "", err
	case "daemonset":
		detail, err := p.app.GetDaemonSet(namespace, name)
		return detail, "", err
	case "statefulset":
		detail, err := p.app.GetStatefulSet(namespace, name)
		return detail, "", err
	case "job":
		detail, err := p.app.GetJob(namespace, name)
		return detail, "", err
	case "cronjob":
		detail, err := p.app.GetCronJob(namespace, name)
		return detail, "", err
	case "configmap":
		detail, err := p.app.GetConfigMap(namespace, name)
		return detail, "", err
	case "secret":
		detail, err := p.app.GetSecret(namespace, name)
		return detail, "", err
	case "helmrelease":
		detail, err := p.app.GetHelmReleaseDetails(namespace, name)
		return detail, "", err
	case "service":
		detail, err := p.app.GetService(namespace, name)
		return detail, "", err
	case "ingress":
		detail, err := p.app.GetIngress(namespace, name)
		return detail, "", err
	case "networkpolicy":
		detail, err := p.app.GetNetworkPolicy(namespace, name)
		return detail, "", err
	case "endpointslice":
		detail, err := p.app.GetEndpointSlice(namespace, name)
		return detail, "", err
	case "persistentvolumeclaim":
		detail, err := p.app.GetPersistentVolumeClaim(namespace, name)
		return detail, "", err
	case "persistentvolume":
		detail, err := p.app.GetPersistentVolume(name)
		return detail, "", err
	case "storageclass":
		detail, err := p.app.GetStorageClass(name)
		return detail, "", err
	case "serviceaccount":
		detail, err := p.app.GetServiceAccount(namespace, name)
		return detail, "", err
	case "role":
		detail, err := p.app.GetRole(namespace, name)
		return detail, "", err
	case "rolebinding":
		detail, err := p.app.GetRoleBinding(namespace, name)
		return detail, "", err
	case "clusterrole":
		detail, err := p.app.GetClusterRole(name)
		return detail, "", err
	case "clusterrolebinding":
		detail, err := p.app.GetClusterRoleBinding(name)
		return detail, "", err
	case "resourcequota":
		detail, err := p.app.GetResourceQuota(namespace, name)
		return detail, "", err
	case "limitrange":
		detail, err := p.app.GetLimitRange(namespace, name)
		return detail, "", err
	case "horizontalpodautoscaler":
		detail, err := p.app.GetHorizontalPodAutoscaler(namespace, name)
		return detail, "", err
	case "poddisruptionbudget":
		detail, err := p.app.GetPodDisruptionBudget(namespace, name)
		return detail, "", err
	case "namespace":
		detail, err := p.app.GetNamespace(name)
		return detail, "", err
	case "node":
		detail, err := p.app.GetNode(name)
		return detail, "", err
	case "ingressclass":
		detail, err := p.app.GetIngressClass(name)
		return detail, "", err
	case "customresourcedefinition":
		detail, err := p.app.GetCustomResourceDefinition(name)
		return detail, "", err
	case "mutatingwebhookconfiguration":
		detail, err := p.app.GetMutatingWebhookConfiguration(name)
		return detail, "", err
	case "validatingwebhookconfiguration":
		detail, err := p.app.GetValidatingWebhookConfiguration(name)
		return detail, "", err
	default:
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
}
