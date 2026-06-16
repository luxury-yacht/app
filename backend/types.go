package backend

import (
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/events"
	"github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/limitrange"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/resourcequota"
	"github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/types"
)

type (
	KubeconfigInfo                        = types.KubeconfigInfo
	WindowSettings                        = types.WindowSettings
	AppSettings                           = types.AppSettings
	AppPreferenceSchema                   = types.AppPreferenceSchema
	AppSettingsSchema                     = types.AppSettingsSchema
	AppPreferenceChange                   = types.AppPreferenceChange
	UpdateAppPreferencesRequest           = types.UpdateAppPreferencesRequest
	UpdateAppPreferencesResponse          = types.UpdateAppPreferencesResponse
	AppearanceModeInfo                    = types.AppearanceModeInfo
	Theme                                 = types.Theme
	ThemeClusterPatternValidationResult   = types.ThemeClusterPatternValidationResult
	ContainerLogsEntry                    = types.ContainerLogsEntry
	ContainerLogsFetchRequest             = types.ContainerLogsFetchRequest
	ContainerLogsFetchResponse            = types.ContainerLogsFetchResponse
	NodeLogSource                         = types.NodeLogSource
	NodeLogDiscoveryResponse              = types.NodeLogDiscoveryResponse
	NodeLogFetchRequest                   = types.NodeLogFetchRequest
	NodeLogFetchResponse                  = types.NodeLogFetchResponse
	ShellSessionRequest                   = types.ShellSessionRequest
	ShellSession                          = types.ShellSession
	ShellSessionInfo                      = types.ShellSessionInfo
	DebugContainerRequest                 = types.DebugContainerRequest
	DebugContainerResponse                = types.DebugContainerResponse
	ShellOutputEvent                      = types.ShellOutputEvent
	ShellStatusEvent                      = types.ShellStatusEvent
	ClsNodeInfo                           = types.ClsNodeInfo
	ClsRBACInfo                           = types.ClsRBACInfo
	ClsStorageInfo                        = types.ClsStorageInfo
	ClsConfigInfo                         = types.ClsConfigInfo
	ClsCRDInfo                            = types.ClsCRDInfo
	ClsEventsInfo                         = types.ClsEventsInfo
	Event                                 = events.Event
	ClsAdmissionControlInfo               = types.ClsAdmissionControlInfo
	ClsStorageClassInfo                   = types.ClsStorageClassInfo
	ClsIngressClassInfo                   = types.ClsIngressClassInfo
	PodSimpleInfo                         = types.PodSimpleInfo
	NsRBACInfo                            = types.NsRBACInfo
	NsStorageInfo                         = types.NsStorageInfo
	NsConfigInfo                          = types.NsConfigInfo
	NsNetworkInfo                         = types.NsNetworkInfo
	NsAutoscalingInfo                     = types.NsAutoscalingInfo
	NsQuotaInfo                           = types.NsQuotaInfo
	NsCustomResourceInfo                  = types.NsCustomResourceInfo
	NsHelmInfo                            = types.NsHelmInfo
	HelmReleaseDetails                    = helm.HelmReleaseDetails
	HelmRevision                          = helm.HelmRevision
	HelmResource                          = helm.HelmResource
	PodDetailInfoContainer                = types.PodDetailInfoContainer
	PodDetailInfo                         = types.PodDetailInfo
	ConfigMapDetails                      = configmap.ConfigMapDetails
	SecretDetails                         = secretpkg.SecretDetails
	ServiceDetails                        = service.ServiceDetails
	ServicePortDetails                    = service.ServicePortDetails
	EndpointSliceDetails                  = endpointslice.EndpointSliceDetails
	EndpointSliceAddress                  = endpointslice.EndpointSliceAddress
	EndpointSlicePort                     = endpointslice.EndpointSlicePort
	IngressDetails                        = ingress.IngressDetails
	IngressRuleDetails                    = ingress.IngressRuleDetails
	IngressPathDetails                    = ingress.IngressPathDetails
	IngressBackendDetails                 = ingress.IngressBackendDetails
	IngressTLSDetails                     = ingress.IngressTLSDetails
	ObjectRef                             = types.ObjectRef
	DisplayRef                            = types.DisplayRef
	RefOrDisplay                          = types.RefOrDisplay
	ConditionState                        = types.ConditionState
	ConditionsSummary                     = types.ConditionsSummary
	GatewayClassDetails                   = gatewayclass.GatewayClassDetails
	GatewayDetails                        = gateway.GatewayDetails
	GatewayListenerDetails                = types.GatewayListenerDetails
	RouteDetails                          = types.RouteDetails
	RouteRuleDetails                      = types.RouteRuleDetails
	HTTPRouteDetails                      = types.HTTPRouteDetails
	GRPCRouteDetails                      = types.GRPCRouteDetails
	TLSRouteDetails                       = types.TLSRouteDetails
	ListenerSetDetails                    = listenerset.ListenerSetDetails
	ReferenceGrantDetails                 = referencegrant.ReferenceGrantDetails
	ReferenceGrantFromInfo                = types.ReferenceGrantFromInfo
	BackendTLSPolicyDetails               = backendtlspolicy.BackendTLSPolicyDetails
	IngressClassDetails                   = ingressclass.IngressClassDetails
	IngressClassParameters                = ingressclass.IngressClassParameters
	NetworkPolicyDetails                  = networkpolicy.NetworkPolicyDetails
	NetworkPolicyRule                     = networkpolicy.NetworkPolicyRule
	NetworkPolicyPeer                     = networkpolicy.NetworkPolicyPeer
	IPBlock                               = networkpolicy.IPBlock
	NetworkPolicyPort                     = networkpolicy.NetworkPolicyPort
	RoleDetails                           = role.RoleDetails
	PolicyRule                            = types.PolicyRule
	RoleBindingDetails                    = rolebinding.RoleBindingDetails
	RoleRef                               = types.RoleRef
	Subject                               = types.Subject
	ClusterRoleDetails                    = clusterrole.ClusterRoleDetails
	AggregationRule                       = clusterrole.AggregationRule
	ClusterRoleBindingDetails             = clusterrolebinding.ClusterRoleBindingDetails
	ServiceAccountDetails                 = serviceaccount.ServiceAccountDetails
	PersistentVolumeDetails               = persistentvolume.PersistentVolumeDetails
	ClaimReference                        = persistentvolume.ClaimReference
	VolumeSourceInfo                      = persistentvolume.VolumeSourceInfo
	PersistentVolumeClaimDetails          = persistentvolumeclaim.PersistentVolumeClaimDetails
	DataSourceInfo                        = persistentvolumeclaim.DataSourceInfo
	StorageClassDetails                   = storageclass.StorageClassDetails
	DeploymentDetails                     = deployment.DeploymentDetails
	ReplicaSetDetails                     = replicaset.ReplicaSetDetails
	StatefulSetDetails                    = statefulset.StatefulSetDetails
	VolumeClaimTemplateSummary            = statefulset.VolumeClaimTemplateSummary
	DaemonSetDetails                      = daemonset.DaemonSetDetails
	JobDetails                            = jobres.JobDetails
	CronJobDetails                        = cronjob.CronJobDetails
	JobReference                          = types.JobReference
	JobTemplateDetails                    = types.JobTemplateDetails
	TopologySelector                      = storageclass.TopologySelector
	TopologyLabelRequirement              = storageclass.TopologyLabelRequirement
	LimitRangeDetails                     = limitrange.LimitRangeDetails
	LimitRangeItem                        = limitrange.LimitRangeItem
	ResourceQuotaDetails                  = resourcequota.ResourceQuotaDetails
	ScopeSelector                         = resourcequota.ScopeSelector
	ScopeSelectorRequirement              = resourcequota.ScopeSelectorRequirement
	PodDisruptionBudgetDetails            = poddisruptionbudget.PodDisruptionBudgetDetails
	HorizontalPodAutoscalerDetails        = hpa.HorizontalPodAutoscalerDetails
	ScaleTargetReference                  = hpa.ScaleTargetReference
	MetricSpec                            = hpa.MetricSpec
	MetricStatus                          = hpa.MetricStatus
	ScalingBehavior                       = hpa.ScalingBehavior
	ScalingRules                          = hpa.ScalingRules
	MutatingWebhookConfigurationDetails   = admission.MutatingWebhookConfigurationDetails
	ValidatingWebhookConfigurationDetails = admission.ValidatingWebhookConfigurationDetails
	WebhookDetails                        = admission.WebhookDetails
	WebhookClientConfig                   = admission.WebhookClientConfig
	WebhookService                        = admission.WebhookService
	WebhookRule                           = admission.WebhookRule
	WebhookSelector                       = admission.WebhookSelector
	WebhookSelectorExpression             = admission.WebhookSelectorExpression
	CustomResourceDefinitionDetails       = apiextensions.CustomResourceDefinitionDetails
	CRDVersion                            = apiextensions.CRDVersion
	CRDNames                              = apiextensions.CRDNames
	CRDCondition                          = apiextensions.CRDCondition
	NamespaceDetails                      = namespaces.NamespaceDetails
	NodeDetails                           = nodes.NodeDetails
	NodeCondition                         = nodes.NodeCondition
	NodeTaint                             = nodes.NodeTaint
	DrainNodeOptions                      = types.DrainNodeOptions
)
