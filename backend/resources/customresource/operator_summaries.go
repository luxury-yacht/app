package customresource

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resources/certmanager"
	"github.com/luxury-yacht/app/backend/resources/externalsecrets"
	"github.com/luxury-yacht/app/backend/resources/prometheus"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"strconv"
	"strings"
)

func certManagerSummary(clusterID string, object *unstructured.Unstructured) *streamrows.CertManagerSummary {
	facts := certmanager.BuildFacts(clusterID, object)
	if facts == nil {
		return nil
	}
	result := &streamrows.CertManagerSummary{Issuer: facts.Issuer, Secret: facts.Secret}
	if facts.Certificate != nil {
		result.NotAfter = facts.Certificate.NotAfter
	}
	if facts.Authority != nil {
		result.IssuerType, result.Server = facts.Authority.Type, facts.Authority.Server
	}
	return result
}

func externalSecretsSummary(clusterID string, object *unstructured.Unstructured) *streamrows.ExternalSecretsSummary {
	facts := externalsecrets.BuildFacts(clusterID, object)
	if facts == nil {
		return nil
	}
	result := &streamrows.ExternalSecretsSummary{}
	secret := facts.ExternalSecret
	if facts.ClusterExternalSecret != nil {
		secret = facts.ClusterExternalSecret.Template
	}
	if secret != nil {
		result.StoreName = secret.StoreName
		result.Store, result.Target = secret.Store, secret.Target
		result.TargetName, result.RefreshInterval = secret.TargetName, secret.RefreshInterval
	}
	if facts.Store != nil {
		result.Provider = strings.Join(facts.Store.Providers, ", ")
		if facts.Store.RefreshInterval != nil {
			result.RefreshInterval = strconv.FormatInt(*facts.Store.RefreshInterval, 10) + "s"
		}
	}
	return result
}

func prometheusSummary(clusterID string, object *unstructured.Unstructured) *streamrows.PrometheusSummary {
	facts := prometheus.BuildFacts(clusterID, object)
	if facts == nil {
		return nil
	}
	result := &streamrows.PrometheusSummary{}
	if facts.Monitor != nil {
		count := len(facts.Monitor.Endpoints)
		result.Endpoints = &count
	}
	if object.GetKind() == "PrometheusRule" {
		count := 0
		for _, group := range facts.RuleGroups {
			count += len(group.Rules)
		}
		result.Rules = &count
	}
	if facts.Instance != nil {
		result.Version, result.Replicas, result.AvailableReplicas = facts.Instance.Version, facts.Instance.Replicas, facts.Instance.AvailableReplicas
	}
	return result
}
