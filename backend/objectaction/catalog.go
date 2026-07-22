// Package objectaction owns the action catalog shared by backend dispatch and
// the generated frontend action contract.
package objectaction

type ID string
type BackendAction = string
type PayloadField string

const (
	ViewDetails           ID            = "view-details"
	ViewMap               ID            = "view-map"
	GoToTable             ID            = "go-to-table"
	Diff                  ID            = "diff"
	ViewInvolved          ID            = "view-involved-object"
	TriggerNow            ID            = "trigger-now"
	Suspend               ID            = "suspend"
	Resume                ID            = "resume"
	Restart               ID            = "restart"
	Rollback              ID            = "rollback"
	Scale                 ID            = "scale"
	ScaleToZero           ID            = "scale-to-zero"
	ResumeFromZero        ID            = "resume-from-zero"
	PortForward           ID            = "port-forward"
	Cordon                ID            = "cordon"
	Uncordon              ID            = "uncordon"
	Drain                 ID            = "drain"
	Delete                ID            = "delete"
	BackendDelete         BackendAction = "delete"
	BackendForceDelete    BackendAction = "forceDelete"
	BackendRestart        BackendAction = "restart"
	BackendScale          BackendAction = "scale"
	BackendTrigger        BackendAction = "trigger"
	BackendSuspend        BackendAction = "suspend"
	BackendCordon         BackendAction = "cordon"
	BackendUncordon       BackendAction = "uncordon"
	BackendDrain          BackendAction = "drain"
	BackendStartDrain     BackendAction = "startDrain"
	BackendPortForward    BackendAction = "startPortForward"
	BackendDebugContainer BackendAction = "createDebugContainer"
	BackendRollback       BackendAction = "rollback"
)

type PermissionTemplate struct {
	ID           string
	Slot         string
	Verb         string
	Group        *string
	Version      string
	ResourceKind string
	Subresource  string
	Namespace    bool
	Name         bool
}

type Definition struct {
	Key                string
	ID                 ID
	Label              string
	BackendAction      BackendAction
	PayloadFields      []PayloadField
	Permission         *PermissionTemplate
	FrontendPermission string
	BackendPermission  string
	DeniedReason       string
}

type BackendActionDefinition struct {
	Key    string
	Action BackendAction
}

func stringPointer(value string) *string { return &value }

func sourcePermission(id, slot, verb string) *PermissionTemplate {
	return &PermissionTemplate{ID: id, Slot: slot, Verb: verb, Namespace: true, Name: true}
}

func fixedPermission(id, slot, verb, group, version, kind, subresource string, namespace, name bool) *PermissionTemplate {
	return &PermissionTemplate{
		ID: id, Slot: slot, Verb: verb, Group: stringPointer(group), Version: version,
		ResourceKind: kind, Subresource: subresource, Namespace: namespace, Name: name,
	}
}

var Definitions = []Definition{
	{Key: "viewDetails", ID: ViewDetails, Label: "Open Details"},
	{Key: "viewMap", ID: ViewMap, Label: "Open Map"},
	{Key: "goToTable", ID: GoToTable, Label: "Go to Table View"},
	{Key: "diff", ID: Diff, Label: "Diff"},
	{Key: "viewInvolvedObject", ID: ViewInvolved, Label: "View Object"},
	{Key: "triggerNow", ID: TriggerNow, Label: "Trigger Now", BackendAction: BackendTrigger, Permission: fixedPermission("trigger", "trigger", "create", "batch", "v1", "Job", "", true, false), FrontendPermission: "batch/v1 Job create", BackendPermission: "resourcePermissionCheck(job, create)", DeniedReason: "trigger permission state"},
	{Key: "suspend", ID: Suspend, Label: "Suspend", BackendAction: BackendSuspend, PayloadFields: []PayloadField{"suspend"}, Permission: fixedPermission("suspend", "suspend", "patch", "batch", "v1", "CronJob", "", true, true), FrontendPermission: "batch/v1 CronJob patch", BackendPermission: "resourcePermissionCheck(cronjob, patch)", DeniedReason: "suspend permission state"},
	{Key: "resume", ID: Resume, Label: "Resume", BackendAction: BackendSuspend, PayloadFields: []PayloadField{"suspend"}, Permission: fixedPermission("suspend", "suspend", "patch", "batch", "v1", "CronJob", "", true, true), FrontendPermission: "batch/v1 CronJob patch", BackendPermission: "resourcePermissionCheck(cronjob, patch)", DeniedReason: "suspend permission state"},
	{Key: "restart", ID: Restart, Label: "Restart", BackendAction: BackendRestart, Permission: sourcePermission("restart", "restart", "patch"), FrontendPermission: "target workload patch", BackendPermission: "resourcePermissionCheck(target-workload, patch)", DeniedReason: "restart permission state"},
	{Key: "rollback", ID: Rollback, Label: "Rollback", BackendAction: BackendRollback, PayloadFields: []PayloadField{"revision"}, Permission: sourcePermission("rollback", "rollback", "update"), FrontendPermission: "target workload update", BackendPermission: "resourcePermissionCheck(target-workload, update)", DeniedReason: "rollback permission state"},
	{Key: "scale", ID: Scale, Label: "Scale", BackendAction: BackendScale, PayloadFields: []PayloadField{"replicas"}, Permission: &PermissionTemplate{ID: "scale", Slot: "scale", Verb: "update", Subresource: "scale", Namespace: true, Name: true}, FrontendPermission: "target workload scale update", BackendPermission: "resourcePermissionCheck(target-workload-scale, update)", DeniedReason: "scale permission state"},
	{Key: "scaleToZero", ID: ScaleToZero, Label: "Scale to 0", BackendAction: BackendScale, PayloadFields: []PayloadField{"replicas"}, Permission: &PermissionTemplate{ID: "scale", Slot: "scale", Verb: "update", Subresource: "scale", Namespace: true, Name: true}, FrontendPermission: "target workload scale update", BackendPermission: "resourcePermissionCheck(target-workload-scale, update)", DeniedReason: "scale permission state"},
	{Key: "resumeFromZero", ID: ResumeFromZero, Label: "Resume from 0", BackendAction: BackendScale, PayloadFields: []PayloadField{"replicas"}, Permission: &PermissionTemplate{ID: "scale", Slot: "scale", Verb: "update", Subresource: "scale", Namespace: true, Name: true}, FrontendPermission: "target workload scale update", BackendPermission: "resourcePermissionCheck(target-workload-scale, update)", DeniedReason: "scale permission state"},
	{Key: "portForward", ID: PortForward, Label: "Port Forward", BackendAction: BackendPortForward, PayloadFields: []PayloadField{"portForward"}, Permission: fixedPermission("port-forward", "portForward", "create", "", "v1", "Pod", "portforward", true, false), FrontendPermission: "core/v1 Pod portforward create", BackendPermission: "resourcePermissionCheck(pod-portforward, create)", DeniedReason: "port-forward permission state"},
	{Key: "cordon", ID: Cordon, Label: "Cordon", BackendAction: BackendCordon, Permission: fixedPermission("node-patch", "cordon", "patch", "", "v1", "Node", "", false, false), FrontendPermission: "core/v1 Node get and patch", BackendPermission: "resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)", DeniedReason: "cordon permission state"},
	{Key: "uncordon", ID: Uncordon, Label: "Uncordon", BackendAction: BackendUncordon, Permission: fixedPermission("node-patch", "cordon", "patch", "", "v1", "Node", "", false, false), FrontendPermission: "core/v1 Node get and patch", BackendPermission: "resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch)", DeniedReason: "cordon permission state"},
	{Key: "drain", ID: Drain, Label: "Drain", BackendAction: BackendStartDrain, PayloadFields: []PayloadField{"drainOptions"}, Permission: fixedPermission("node-patch", "drain", "patch", "", "v1", "Node", "", false, false), FrontendPermission: "core/v1 Node get+patch and Pod eviction create or Pod delete", BackendPermission: "resourcePermissionCheck(node, get) and resourcePermissionCheck(node, patch) and resourcePermissionCheck(pod-eviction, create optional) and resourcePermissionCheck(pod-delete, delete optional)", DeniedReason: "drain permission state"},
	{Key: "delete", ID: Delete, Label: "Delete", BackendAction: BackendDelete, Permission: sourcePermission("delete", "delete", "delete"), FrontendPermission: "target object delete", BackendPermission: "resourcePermissionCheck(target, delete)", DeniedReason: "delete permission state"},
}

var FrontendBackendActions = []BackendActionDefinition{
	{Key: "delete", Action: BackendDelete},
	{Key: "restart", Action: BackendRestart},
	{Key: "scale", Action: BackendScale},
	{Key: "trigger", Action: BackendTrigger},
	{Key: "suspend", Action: BackendSuspend},
	{Key: "cordon", Action: BackendCordon},
	{Key: "uncordon", Action: BackendUncordon},
	{Key: "startDrain", Action: BackendStartDrain},
	{Key: "startPortForward", Action: BackendPortForward},
	{Key: "createDebugContainer", Action: BackendDebugContainer},
	{Key: "rollback", Action: BackendRollback},
}

var BackendOnlyActions = []BackendActionDefinition{
	{Key: "forceDelete", Action: BackendForceDelete},
	{Key: "drain", Action: BackendDrain},
}

var NodePermissions = []PermissionTemplate{
	*fixedPermission("node-get", "cordon", "get", "", "v1", "Node", "", false, false),
	*fixedPermission("node-patch", "cordon", "patch", "", "v1", "Node", "", false, false),
	*fixedPermission("pod-eviction-create", "drain", "create", "", "v1", "Pod", "eviction", false, false),
	*fixedPermission("pod-delete", "drain", "delete", "", "v1", "Pod", "", false, false),
}
