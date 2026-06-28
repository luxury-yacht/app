package backend

import (
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/events"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/luxury-yacht/app/backend/resources/types"
)

// Per-kind detail DTOs are no longer re-exported here. The generated
// App.Get<Kind> wrappers (resource_details_generated.go) reference each kind's DTO by
// its own package (e.g. deployment.DeploymentDetails), and Wails reaches every
// nested sub-type through those parent structs — so no package-backend alias is
// needed for any kind DTO or its sub-types. What remains is app-level and shared
// types (settings, logs, shell, cluster-tab infos, common ref/condition/route
// sub-types in resources/types) plus the three DTOs whose App.Get binding is
// hand-written and therefore still named in package backend (HelmReleaseDetails,
// PodDetailInfo, CustomResourceDefinitionDetails).
type (
	KubeconfigInfo                      = types.KubeconfigInfo
	WindowSettings                      = types.WindowSettings
	AppSettings                         = types.AppSettings
	AppPreferenceSchema                 = types.AppPreferenceSchema
	AppSettingsSchema                   = types.AppSettingsSchema
	AppPreferenceChange                 = types.AppPreferenceChange
	UpdateAppPreferencesRequest         = types.UpdateAppPreferencesRequest
	UpdateAppPreferencesResponse        = types.UpdateAppPreferencesResponse
	AppearanceModeInfo                  = types.AppearanceModeInfo
	Theme                               = types.Theme
	ThemeClusterPatternValidationResult = types.ThemeClusterPatternValidationResult
	ContainerLogsEntry                  = types.ContainerLogsEntry
	ContainerLogsFetchRequest           = types.ContainerLogsFetchRequest
	ContainerLogsFetchResponse          = types.ContainerLogsFetchResponse
	NodeLogSource                       = types.NodeLogSource
	NodeLogDiscoveryResponse            = types.NodeLogDiscoveryResponse
	NodeLogFetchRequest                 = types.NodeLogFetchRequest
	NodeLogFetchResponse                = types.NodeLogFetchResponse
	ShellSessionRequest                 = types.ShellSessionRequest
	ShellSession                        = types.ShellSession
	ShellSessionInfo                    = types.ShellSessionInfo
	DebugContainerRequest               = types.DebugContainerRequest
	DebugContainerResponse              = types.DebugContainerResponse
	ShellOutputEvent                    = types.ShellOutputEvent
	ShellStatusEvent                    = types.ShellStatusEvent
	ClsNodeInfo                         = types.ClsNodeInfo
	ClsRBACInfo                         = types.ClsRBACInfo
	ClsStorageInfo                      = types.ClsStorageInfo
	ClsConfigInfo                       = types.ClsConfigInfo
	ClsCRDInfo                          = types.ClsCRDInfo
	ClsEventsInfo                       = types.ClsEventsInfo
	Event                               = events.Event
	ClsAdmissionControlInfo             = types.ClsAdmissionControlInfo
	ClsStorageClassInfo                 = types.ClsStorageClassInfo
	ClsIngressClassInfo                 = types.ClsIngressClassInfo
	PodSimpleInfo                       = types.PodSimpleInfo
	NsRBACInfo                          = types.NsRBACInfo
	NsStorageInfo                       = types.NsStorageInfo
	NsConfigInfo                        = types.NsConfigInfo
	NsNetworkInfo                       = types.NsNetworkInfo
	NsAutoscalingInfo                   = types.NsAutoscalingInfo
	NsQuotaInfo                         = types.NsQuotaInfo
	NsHelmInfo                          = types.NsHelmInfo
	HelmReleaseDetails                  = helm.HelmReleaseDetails
	PodDetailInfoContainer              = types.PodDetailInfoContainer
	PodDetailInfo                       = types.PodDetailInfo
	ObjectRef                           = types.ObjectRef
	DisplayRef                          = types.DisplayRef
	RefOrDisplay                        = types.RefOrDisplay
	ConditionState                      = types.ConditionState
	ConditionsSummary                   = types.ConditionsSummary
	GatewayListenerDetails              = types.GatewayListenerDetails
	RouteDetails                        = types.RouteDetails
	RouteRuleDetails                    = types.RouteRuleDetails
	ReferenceGrantFromInfo              = types.ReferenceGrantFromInfo
	PolicyRule                          = types.PolicyRule
	RoleRef                             = types.RoleRef
	Subject                             = types.Subject
	JobReference                        = types.JobReference
	JobTemplateDetails                  = types.JobTemplateDetails
	CustomResourceDefinitionDetails     = apiextensions.CustomResourceDefinitionDetails
	DrainNodeOptions                    = types.DrainNodeOptions
)
