package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/internal/panelwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// FavoritesCommands is the frontend command surface owned by FavoritesService.
type FavoritesCommands interface {
	AddFavorite(Favorite) (Favorite, error)
	DeleteFavorite(string) error
	GetFavorites() ([]Favorite, error)
	SetFavoriteOrder([]string) error
	UpdateFavorite(Favorite) error
}

// UIStateCommands is the frontend command surface owned by UIStateStore.
type UIStateCommands interface {
	ClearGridTablePersistence() (int, error)
	DeleteGridTablePersistence(string) error
	DeleteGridTablePersistenceEntries([]string) error
	GetClusterTabOrder() ([]string, error)
	GetGridTablePersistence() (map[string]json.RawMessage, error)
	SetClusterTabOrder([]string) error
	SetGridTablePersistence(string, json.RawMessage) error
}

// PreferencesCommands is the frontend command surface owned by PreferencesService.
type PreferencesCommands interface {
	ApplyTheme(string) error
	DeleteTheme(string) error
	GetAppSettings() (*AppSettings, error)
	GetAppSettingsSchema() (*AppSettingsSchema, error)
	GetKubeconfigSearchPaths() ([]string, error)
	GetThemes() ([]Theme, error)
	GetZoomLevel() int
	MatchThemeForCluster(string) (*Theme, error)
	ReorderThemes([]string) error
	SaveTheme(Theme) error
	SetZoomLevel(int) error
	UpdateAppPreferences(UpdateAppPreferencesRequest) (*UpdateAppPreferencesResponse, error)
	ValidateThemeClusterPattern(string) ThemeClusterPatternValidationResult
}

// DataManagementCommands is the frontend command surface owned by DataManagementCoordinator.
type DataManagementCommands interface {
	ClearAppState() error
	ExportFavorites() (DataManagementResult, error)
	ExportSettings() (DataManagementResult, error)
	ImportFavorites() (DataManagementResult, error)
	ImportSettings() (DataManagementResult, error)
}

// ClusterAttentionCommands is the frontend command surface owned by ClusterAttentionService.
type ClusterAttentionCommands interface {
	IgnoreClusterAttentionFindingType(string, string) (*snapshot.AttentionIgnoreRules, error)
	IgnoreClusterAttentionObjectFinding(string, resourcemodel.ResourceRef, string) (*snapshot.AttentionIgnoreRules, error)
	IgnoreGlobalAttentionFindingType(string, string) (*snapshot.AttentionIgnoreRules, error)
	RestoreClusterAttentionFindingType(string, string) (*snapshot.AttentionIgnoreRules, error)
	RestoreClusterAttentionObjectFinding(string, resourcemodel.ResourceRef, string) (*snapshot.AttentionIgnoreRules, error)
	RestoreGlobalAttentionFindingType(string, string) (*snapshot.AttentionIgnoreRules, error)
}

// WorkspaceCommands is the frontend command surface owned by WorkspaceCoordinator.
type WorkspaceCommands interface {
	ApplyClusterWorkspace(ClusterWorkspaceCommand) ClusterWorkspaceResult
	GetClusterAllowedNamespaces(string) ([]string, error)
	GetClusterWorkspaceStateForWindow(string) ClusterWorkspaceState
	GetSelectionDiagnostics() (*SelectionDiagnostics, error)
	SetClusterAllowedNamespaces(string, []string) ([]string, error)
	SetKubeconfigSearchPaths([]string) error
}

// ClusterRuntimeCommands is the frontend command surface owned by ClusterRuntimeManager.
type ClusterRuntimeCommands interface {
	GetKubeconfigs() (KubeconfigDiscoveryResult, error)
	GetKubernetesAPIClientDiagnostics() ([]KubernetesAPIClientDiagnostics, error)
	RetryClusterAuth(string)
}

// ResourceCommands is the frontend command surface owned by ResourceGateway.
type ResourceCommands interface {
	ApplyObjectYaml(string, ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error)
	CheckObjectYamlOwnership(string, ObjectYAMLMutationRequest) (*ObjectYAMLOwnershipCheckResponse, error)
	DiscoverNodeLogs(string, string) NodeLogDiscoveryResponse
	FetchContainerLogs(string, ContainerLogsFetchRequest) ContainerLogsFetchResponse
	FetchNodeLogs(string, string, NodeLogFetchRequest) NodeLogFetchResponse
	FindCatalogObjectByUID(string, string) (*objectcatalog.Summary, error)
	FindCatalogObjectMatch(string, string, string, string, string, string) (*objectcatalog.Summary, error)
	GetContainerLogsScopeContainers(string, string) ([]string, error)
	GetObjectYAMLByGVK(string, string, string, string, string) (string, error)
	GetPodContainers(string, string, string) ([]string, error)
	GetRevisionHistory(string, string, string, string, string, string) ([]RevisionEntry, error)
	GetTargetPorts(string, string, string, string, string, string) ([]ContainerPortInfo, error)
	HydrateCatalogCustomRows(string, []snapshot.ResourceQueryRow) ([]snapshot.CustomResourceSummary, error)
	IsWorkloadHPAManaged(string, string, string, string, string, string) (bool, error)
	MergeObjectYamlWithLatest(string, ObjectYAMLReloadMergeRequest) (*ObjectYAMLReloadMergeResponse, error)
	QueryPermissions([]capabilities.PermissionQuery) (*capabilities.QueryPermissionsResponse, error)
	RunObjectAction(ObjectActionRequest) (ObjectActionResponse, error)
}

// OperationsCommands is the frontend command surface owned by OperationsCoordinator.
type OperationsCommands interface {
	CancelDrainNodeJob(string, string) error
	CloseShellSession(string) error
	GetShellSessionBacklog(string) (string, error)
	ListPortForwards() []PortForwardSession
	ListRuntimeOperations() []RuntimeOperation
	ListShellSessions() []ShellSessionInfo
	ResizeShellSession(string, int, int) error
	SendShellInput(string, string) error
	StartShellSession(string, ShellSessionRequest) (*ShellSession, error)
	StopPortForward(string) error
}

// UpdateCommands is the frontend command surface owned by UpdateCoordinator.
type UpdateCommands interface {
	CheckForUpdates() (*UpdateInfo, error)
	DownloadApplicationUpdate(string) (*UpdateInfo, error)
	GetAppInfo() (*AppInfo, error)
	RemoveApplicationUpdateSkip() (*UpdateInfo, error)
	RestartAndApplyApplicationUpdate() (*UpdateInfo, error)
	SkipApplicationUpdate(string) (*UpdateInfo, error)
}

// AppLogCommands is the frontend command surface owned by AppLogService.
type AppLogCommands interface {
	ClearAppLogs() error
	GetAppLogs() []LogEntry
	GetAppLogsSince(uint64) []LogEntry
	LogAppLogsFromFrontend(string, string, string) error
	LogAppLogsFromFrontendWithCluster(string, string, string, string, string) error
}

// DesktopShellCommands is the frontend command surface owned by DesktopShell.
type DesktopShellCommands interface {
	ExecuteApplicationMenuCommand(string, ApplicationMenuCommand) error
	OpenKubeconfigSearchPathDialog() (string, error)
	SaveCsvFile(string, string) (CatalogQueryCSVExport, error)
	SetAppLogsPanelVisible(bool)
	SetSidebarVisible(bool)
}

// PanelWindowCommands is the native panel-window protocol owned by DesktopShell.
type PanelWindowCommands interface {
	GetNativeWindowDescriptor(string) (panelwindow.NativeDescriptor, error)
	BeginPanelWindowOpen(string, panelwindow.GroupSnapshot) (panelwindow.WindowDescriptor, error)
	AcknowledgePanelWindowReady(string, string) (panelwindow.WindowDescriptor, error)
	BeginPanelWindowDock(string, string, panelwindow.GroupSnapshot) error
	AcknowledgePanelWindowDock(string, string, string) error
	FailPanelWindowTransfer(string, string, string) error
	FocusPanelWindow(string, string, string) error
	RequestPanelWindowClose(string, string, string) error
	AcknowledgePanelWindowClose(string) error
	AcknowledgeWorkspaceWindowClose(string) error
	RequestPanelObjectOpen(string, panelwindow.ObjectReference, string) error
	AuthorizePanelObjectOpen(string, string, string, panelwindow.ObjectReference, string) error
	UpdatePanelWindowSnapshot(string, panelwindow.GroupSnapshot) error
	RequestPanelTabClose(string, string) error
	AuthorizePanelTabClose(string, string, string) error
	RequestPanelTabTransfer(string, panelwindow.TabTransferRequest) error
	AcceptPanelTabTransfer(string, string) error
	FailPanelTabTransfer(string, string) error
	RequestPanelWindowGuard(string, string, string, string) error
	AcknowledgePanelWindowGuard(string, string, bool) error
	AcknowledgeApplicationQuitPreflight(string, string, bool) error
}

// DesktopServiceLifecycle owns Wails service startup and shutdown.
type DesktopServiceLifecycle interface {
	ServiceStartup(context.Context, application.ServiceOptions) error
	ServiceShutdown() error
}

// DesktopServiceDependencies names every owner-shaped collaborator used by the
// Wails transport boundary. Commands, HTTP, and streams are supplied directly
// by their focused owners; process startup and shutdown belong to
// ApplicationLifecycle.
type DesktopServiceDependencies struct {
	Favorites      FavoritesCommands
	UIState        UIStateCommands
	Preferences    PreferencesCommands
	DataManagement DataManagementCommands
	Attention      ClusterAttentionCommands
	Workspace      WorkspaceCommands
	ClusterRuntime ClusterRuntimeCommands
	Resources      ResourceCommands
	Operations     OperationsCommands
	Updates        UpdateCommands
	Logs           AppLogCommands
	DesktopShell   DesktopShellCommands
	PanelWindows   PanelWindowCommands
	Lifecycle      DesktopServiceLifecycle
	HTTP           http.Handler
}

// DesktopService is the sole Wails-bound backend service. It owns transport
// method names and delegates behavior to focused collaborators.
//
//wails:inject t*:void BindingModelAnchor;
type DesktopService struct {
	favorites      FavoritesCommands
	uiState        UIStateCommands
	preferences    PreferencesCommands
	dataManagement DataManagementCommands
	attention      ClusterAttentionCommands
	workspace      WorkspaceCommands
	clusterRuntime ClusterRuntimeCommands
	resources      ResourceCommands
	operations     OperationsCommands
	updates        UpdateCommands
	logs           AppLogCommands
	desktopShell   DesktopShellCommands
	panelWindows   PanelWindowCommands
	lifecycle      DesktopServiceLifecycle
	http           http.Handler
}

// NewDesktopService constructs the Wails transport from owner-shaped collaborators.
func NewDesktopService(dependencies DesktopServiceDependencies) *DesktopService {
	return &DesktopService{
		favorites:      dependencies.Favorites,
		uiState:        dependencies.UIState,
		preferences:    dependencies.Preferences,
		dataManagement: dependencies.DataManagement,
		attention:      dependencies.Attention,
		workspace:      dependencies.Workspace,
		clusterRuntime: dependencies.ClusterRuntime,
		resources:      dependencies.Resources,
		operations:     dependencies.Operations,
		updates:        dependencies.Updates,
		logs:           dependencies.Logs,
		desktopShell:   dependencies.DesktopShell,
		panelWindows:   dependencies.PanelWindows,
		lifecycle:      dependencies.Lifecycle,
		http:           dependencies.HTTP,
	}
}

func (s *DesktopService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.lifecycle.ServiceStartup(ctx, options)
}

func (s *DesktopService) ServiceShutdown() error {
	return s.lifecycle.ServiceShutdown()
}

func (s *DesktopService) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	s.http.ServeHTTP(writer, request)
}

func (s *DesktopService) AddFavorite(favorite Favorite) (Favorite, error) {
	return s.favorites.AddFavorite(favorite)
}

func (s *DesktopService) DeleteFavorite(id string) error {
	return s.favorites.DeleteFavorite(id)
}

func (s *DesktopService) GetFavorites() ([]Favorite, error) {
	return s.favorites.GetFavorites()
}

func (s *DesktopService) SetFavoriteOrder(ids []string) error {
	return s.favorites.SetFavoriteOrder(ids)
}

func (s *DesktopService) UpdateFavorite(favorite Favorite) error {
	return s.favorites.UpdateFavorite(favorite)
}

func (s *DesktopService) ClearGridTablePersistence() (int, error) {
	return s.uiState.ClearGridTablePersistence()
}

func (s *DesktopService) DeleteGridTablePersistence(key string) error {
	return s.uiState.DeleteGridTablePersistence(key)
}

func (s *DesktopService) DeleteGridTablePersistenceEntries(keys []string) error {
	return s.uiState.DeleteGridTablePersistenceEntries(keys)
}

func (s *DesktopService) GetClusterTabOrder() ([]string, error) {
	return s.uiState.GetClusterTabOrder()
}

func (s *DesktopService) GetGridTablePersistence() (map[string]json.RawMessage, error) {
	return s.uiState.GetGridTablePersistence()
}

func (s *DesktopService) SetClusterTabOrder(order []string) error {
	return s.uiState.SetClusterTabOrder(order)
}

func (s *DesktopService) SetGridTablePersistence(key string, payload json.RawMessage) error {
	return s.uiState.SetGridTablePersistence(key, payload)
}

func (s *DesktopService) ApplyTheme(id string) error {
	return s.preferences.ApplyTheme(id)
}

func (s *DesktopService) DeleteTheme(id string) error {
	return s.preferences.DeleteTheme(id)
}

func (s *DesktopService) GetAppSettings() (*AppSettings, error) {
	return s.preferences.GetAppSettings()
}

func (s *DesktopService) GetAppSettingsSchema() (*AppSettingsSchema, error) {
	return s.preferences.GetAppSettingsSchema()
}

func (s *DesktopService) GetKubeconfigSearchPaths() ([]string, error) {
	return s.preferences.GetKubeconfigSearchPaths()
}

func (s *DesktopService) GetThemes() ([]Theme, error) {
	return s.preferences.GetThemes()
}

func (s *DesktopService) GetZoomLevel() int {
	return s.preferences.GetZoomLevel()
}

func (s *DesktopService) MatchThemeForCluster(contextName string) (*Theme, error) {
	return s.preferences.MatchThemeForCluster(contextName)
}

func (s *DesktopService) ReorderThemes(ids []string) error {
	return s.preferences.ReorderThemes(ids)
}

func (s *DesktopService) SaveTheme(theme Theme) error {
	return s.preferences.SaveTheme(theme)
}

func (s *DesktopService) SetZoomLevel(level int) error {
	return s.preferences.SetZoomLevel(level)
}

func (s *DesktopService) UpdateAppPreferences(request UpdateAppPreferencesRequest) (*UpdateAppPreferencesResponse, error) {
	return s.preferences.UpdateAppPreferences(request)
}

func (s *DesktopService) ValidateThemeClusterPattern(pattern string) ThemeClusterPatternValidationResult {
	return s.preferences.ValidateThemeClusterPattern(pattern)
}

func (s *DesktopService) ClearAppState() error {
	return s.dataManagement.ClearAppState()
}

func (s *DesktopService) ExportFavorites() (DataManagementResult, error) {
	return s.dataManagement.ExportFavorites()
}

func (s *DesktopService) ExportSettings() (DataManagementResult, error) {
	return s.dataManagement.ExportSettings()
}

func (s *DesktopService) ImportFavorites() (DataManagementResult, error) {
	return s.dataManagement.ImportFavorites()
}

func (s *DesktopService) ImportSettings() (DataManagementResult, error) {
	return s.dataManagement.ImportSettings()
}

func (s *DesktopService) IgnoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.IgnoreClusterAttentionFindingType(clusterID, findingType)
}

func (s *DesktopService) IgnoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.IgnoreClusterAttentionObjectFinding(clusterID, ref, findingType)
}

func (s *DesktopService) IgnoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.IgnoreGlobalAttentionFindingType(clusterID, findingType)
}

func (s *DesktopService) RestoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.RestoreClusterAttentionFindingType(clusterID, findingType)
}

func (s *DesktopService) RestoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.RestoreClusterAttentionObjectFinding(clusterID, ref, findingType)
}

func (s *DesktopService) RestoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	return s.attention.RestoreGlobalAttentionFindingType(clusterID, findingType)
}

func (s *DesktopService) ApplyClusterWorkspace(command ClusterWorkspaceCommand) ClusterWorkspaceResult {
	return s.workspace.ApplyClusterWorkspace(command)
}

func (s *DesktopService) GetClusterAllowedNamespaces(clusterID string) ([]string, error) {
	return s.workspace.GetClusterAllowedNamespaces(clusterID)
}

func (s *DesktopService) GetClusterWorkspaceStateForWindow(windowID string) ClusterWorkspaceState {
	return s.workspace.GetClusterWorkspaceStateForWindow(windowID)
}

func (s *DesktopService) GetSelectionDiagnostics() (*SelectionDiagnostics, error) {
	return s.workspace.GetSelectionDiagnostics()
}

func (s *DesktopService) SetClusterAllowedNamespaces(clusterID string, namespaces []string) ([]string, error) {
	return s.workspace.SetClusterAllowedNamespaces(clusterID, namespaces)
}

func (s *DesktopService) SetKubeconfigSearchPaths(paths []string) error {
	return s.workspace.SetKubeconfigSearchPaths(paths)
}

func (s *DesktopService) GetKubeconfigs() (KubeconfigDiscoveryResult, error) {
	return s.clusterRuntime.GetKubeconfigs()
}

func (s *DesktopService) GetKubernetesAPIClientDiagnostics() ([]KubernetesAPIClientDiagnostics, error) {
	return s.clusterRuntime.GetKubernetesAPIClientDiagnostics()
}

func (s *DesktopService) RetryClusterAuth(clusterID string) {
	s.clusterRuntime.RetryClusterAuth(clusterID)
}

func (s *DesktopService) ApplyObjectYaml(clusterID string, request ObjectYAMLMutationRequest) (*ObjectYAMLMutationResponse, error) {
	return s.resources.ApplyObjectYaml(clusterID, request)
}

func (s *DesktopService) CheckObjectYamlOwnership(clusterID string, request ObjectYAMLMutationRequest) (*ObjectYAMLOwnershipCheckResponse, error) {
	return s.resources.CheckObjectYamlOwnership(clusterID, request)
}

func (s *DesktopService) DiscoverNodeLogs(clusterID, nodeName string) NodeLogDiscoveryResponse {
	return s.resources.DiscoverNodeLogs(clusterID, nodeName)
}

func (s *DesktopService) FetchContainerLogs(clusterID string, request ContainerLogsFetchRequest) ContainerLogsFetchResponse {
	return s.resources.FetchContainerLogs(clusterID, request)
}

func (s *DesktopService) FetchNodeLogs(clusterID, nodeName string, request NodeLogFetchRequest) NodeLogFetchResponse {
	return s.resources.FetchNodeLogs(clusterID, nodeName, request)
}

func (s *DesktopService) FindCatalogObjectByUID(clusterID, uid string) (*objectcatalog.Summary, error) {
	return s.resources.FindCatalogObjectByUID(clusterID, uid)
}

func (s *DesktopService) FindCatalogObjectMatch(clusterID, namespace, group, version, kind, name string) (*objectcatalog.Summary, error) {
	return s.resources.FindCatalogObjectMatch(clusterID, namespace, group, version, kind, name)
}

func (s *DesktopService) GetContainerLogsScopeContainers(clusterID, scope string) ([]string, error) {
	return s.resources.GetContainerLogsScopeContainers(clusterID, scope)
}

func (s *DesktopService) GetObjectYAMLByGVK(clusterID, apiVersion, kind, namespace, name string) (string, error) {
	return s.resources.GetObjectYAMLByGVK(clusterID, apiVersion, kind, namespace, name)
}

func (s *DesktopService) GetPodContainers(clusterID, namespace, podName string) ([]string, error) {
	return s.resources.GetPodContainers(clusterID, namespace, podName)
}

func (s *DesktopService) GetRevisionHistory(clusterID, namespace, group, version, workloadKind, name string) ([]RevisionEntry, error) {
	return s.resources.GetRevisionHistory(clusterID, namespace, group, version, workloadKind, name)
}

func (s *DesktopService) GetTargetPorts(clusterID, namespace, targetKind, targetGroup, targetVersion, targetName string) ([]ContainerPortInfo, error) {
	return s.resources.GetTargetPorts(clusterID, namespace, targetKind, targetGroup, targetVersion, targetName)
}

func (s *DesktopService) HydrateCatalogCustomRows(clusterID string, rows []snapshot.ResourceQueryRow) ([]snapshot.CustomResourceSummary, error) {
	return s.resources.HydrateCatalogCustomRows(clusterID, rows)
}

func (s *DesktopService) IsWorkloadHPAManaged(clusterID, namespace, group, version, kind, name string) (bool, error) {
	return s.resources.IsWorkloadHPAManaged(clusterID, namespace, group, version, kind, name)
}

func (s *DesktopService) MergeObjectYamlWithLatest(clusterID string, request ObjectYAMLReloadMergeRequest) (*ObjectYAMLReloadMergeResponse, error) {
	return s.resources.MergeObjectYamlWithLatest(clusterID, request)
}

func (s *DesktopService) QueryPermissions(queries []capabilities.PermissionQuery) (*capabilities.QueryPermissionsResponse, error) {
	return s.resources.QueryPermissions(queries)
}

func (s *DesktopService) RunObjectAction(request ObjectActionRequest) (ObjectActionResponse, error) {
	return s.resources.RunObjectAction(request)
}

func (s *DesktopService) CancelDrainNodeJob(clusterID, jobID string) error {
	return s.operations.CancelDrainNodeJob(clusterID, jobID)
}

func (s *DesktopService) CloseShellSession(sessionID string) error {
	return s.operations.CloseShellSession(sessionID)
}

func (s *DesktopService) GetShellSessionBacklog(sessionID string) (string, error) {
	return s.operations.GetShellSessionBacklog(sessionID)
}

func (s *DesktopService) ListPortForwards() []PortForwardSession {
	return s.operations.ListPortForwards()
}

func (s *DesktopService) ListRuntimeOperations() []RuntimeOperation {
	return s.operations.ListRuntimeOperations()
}

func (s *DesktopService) ListShellSessions() []ShellSessionInfo {
	return s.operations.ListShellSessions()
}

func (s *DesktopService) ResizeShellSession(sessionID string, columns, rows int) error {
	return s.operations.ResizeShellSession(sessionID, columns, rows)
}

func (s *DesktopService) SendShellInput(sessionID, data string) error {
	return s.operations.SendShellInput(sessionID, data)
}

func (s *DesktopService) StartShellSession(clusterID string, request ShellSessionRequest) (*ShellSession, error) {
	return s.operations.StartShellSession(clusterID, request)
}

func (s *DesktopService) StopPortForward(sessionID string) error {
	return s.operations.StopPortForward(sessionID)
}

func (s *DesktopService) CheckForUpdates() (*UpdateInfo, error) {
	return s.updates.CheckForUpdates()
}

func (s *DesktopService) DownloadApplicationUpdate(version string) (*UpdateInfo, error) {
	return s.updates.DownloadApplicationUpdate(version)
}

func (s *DesktopService) GetAppInfo() (*AppInfo, error) {
	return s.updates.GetAppInfo()
}

func (s *DesktopService) RemoveApplicationUpdateSkip() (*UpdateInfo, error) {
	return s.updates.RemoveApplicationUpdateSkip()
}

func (s *DesktopService) RestartAndApplyApplicationUpdate() (*UpdateInfo, error) {
	return s.updates.RestartAndApplyApplicationUpdate()
}

func (s *DesktopService) SkipApplicationUpdate(version string) (*UpdateInfo, error) {
	return s.updates.SkipApplicationUpdate(version)
}

func (s *DesktopService) ClearAppLogs() error {
	return s.logs.ClearAppLogs()
}

func (s *DesktopService) GetAppLogs() []LogEntry {
	return s.logs.GetAppLogs()
}

func (s *DesktopService) GetAppLogsSince(sequence uint64) []LogEntry {
	return s.logs.GetAppLogsSince(sequence)
}

func (s *DesktopService) LogAppLogsFromFrontend(level, message, source string) error {
	return s.logs.LogAppLogsFromFrontend(level, message, source)
}

func (s *DesktopService) LogAppLogsFromFrontendWithCluster(level, message, source, clusterID, clusterName string) error {
	return s.logs.LogAppLogsFromFrontendWithCluster(level, message, source, clusterID, clusterName)
}

func (s *DesktopService) OpenKubeconfigSearchPathDialog() (string, error) {
	return s.desktopShell.OpenKubeconfigSearchPathDialog()
}

func (s *DesktopService) ExecuteApplicationMenuCommand(
	ctx context.Context,
	command ApplicationMenuCommand,
) error {
	windowName := ""
	if ctx != nil {
		if caller, ok := ctx.Value(application.WindowKey).(interface{ Name() string }); ok {
			windowName = caller.Name()
		}
	}
	if windowName == "" {
		return fmt.Errorf("application menu command requires a Wails sender")
	}
	return s.desktopShell.ExecuteApplicationMenuCommand(windowName, command)
}

func (s *DesktopService) SaveCsvFile(defaultFilename, content string) (CatalogQueryCSVExport, error) {
	return s.desktopShell.SaveCsvFile(defaultFilename, content)
}

func (s *DesktopService) SetAppLogsPanelVisible(visible bool) {
	s.desktopShell.SetAppLogsPanelVisible(visible)
}

func (s *DesktopService) SetSidebarVisible(visible bool) {
	s.desktopShell.SetSidebarVisible(visible)
}

func validatePanelCommandCaller(ctx context.Context, claimedWindowName string) error {
	if ctx == nil {
		return nil
	}
	caller, ok := ctx.Value(application.WindowKey).(interface{ Name() string })
	if !ok || caller.Name() == "" {
		// Direct Go callers and non-window test transports do not carry a Wails
		// sender. Native webview calls always do, and are authenticated below.
		return nil
	}
	if caller.Name() != claimedWindowName {
		return fmt.Errorf(
			"claimed panel command caller %q does not match Wails sender %q",
			claimedWindowName,
			caller.Name(),
		)
	}
	return nil
}

func (s *DesktopService) GetNativeWindowDescriptor(
	ctx context.Context,
	windowName string,
) (panelwindow.NativeDescriptor, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return panelwindow.NativeDescriptor{}, err
	}
	return s.panelWindows.GetNativeWindowDescriptor(windowName)
}

func (s *DesktopService) BeginPanelWindowOpen(
	ctx context.Context,
	windowName string,
	snapshot panelwindow.GroupSnapshot,
) (panelwindow.WindowDescriptor, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return s.panelWindows.BeginPanelWindowOpen(windowName, snapshot)
}

func (s *DesktopService) AcknowledgePanelWindowReady(
	ctx context.Context,
	windowName string,
	transferID string,
) (panelwindow.WindowDescriptor, error) {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return panelwindow.WindowDescriptor{}, err
	}
	return s.panelWindows.AcknowledgePanelWindowReady(windowName, transferID)
}

func (s *DesktopService) BeginPanelWindowDock(ctx context.Context, windowName, targetPosition string, snapshot panelwindow.GroupSnapshot) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.BeginPanelWindowDock(windowName, targetPosition, snapshot)
}

func (s *DesktopService) AcknowledgePanelWindowDock(ctx context.Context, ownerWindowName, windowName, transferID string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgePanelWindowDock(ownerWindowName, windowName, transferID)
}

func (s *DesktopService) FailPanelWindowTransfer(ctx context.Context, callerWindowName, windowName, transferID string) error {
	if err := validatePanelCommandCaller(ctx, callerWindowName); err != nil {
		return err
	}
	return s.panelWindows.FailPanelWindowTransfer(callerWindowName, windowName, transferID)
}

func (s *DesktopService) FocusPanelWindow(ctx context.Context, ownerWindowName, windowName, panelID string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.FocusPanelWindow(ownerWindowName, windowName, panelID)
}

func (s *DesktopService) RequestPanelWindowClose(ctx context.Context, callerWindowName, windowName, reason string) error {
	if err := validatePanelCommandCaller(ctx, callerWindowName); err != nil {
		return err
	}
	return s.panelWindows.RequestPanelWindowClose(callerWindowName, windowName, reason)
}

func (s *DesktopService) AcknowledgePanelWindowClose(ctx context.Context, windowName string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgePanelWindowClose(windowName)
}

func (s *DesktopService) AcknowledgeWorkspaceWindowClose(ctx context.Context, ownerWindowName string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgeWorkspaceWindowClose(ownerWindowName)
}

func (s *DesktopService) RequestPanelObjectOpen(ctx context.Context, windowName string, ref panelwindow.ObjectReference, activeView string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.RequestPanelObjectOpen(windowName, ref, activeView)
}

func (s *DesktopService) AuthorizePanelObjectOpen(ctx context.Context, ownerWindowName, windowName, panelID string, ref panelwindow.ObjectReference, activeView string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AuthorizePanelObjectOpen(ownerWindowName, windowName, panelID, ref, activeView)
}

func (s *DesktopService) UpdatePanelWindowSnapshot(ctx context.Context, windowName string, snapshot panelwindow.GroupSnapshot) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.UpdatePanelWindowSnapshot(windowName, snapshot)
}

func (s *DesktopService) RequestPanelTabClose(ctx context.Context, windowName, panelID string) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.RequestPanelTabClose(windowName, panelID)
}

func (s *DesktopService) AuthorizePanelTabClose(ctx context.Context, ownerWindowName, windowName, panelID string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AuthorizePanelTabClose(ownerWindowName, windowName, panelID)
}

func (s *DesktopService) RequestPanelTabTransfer(
	ctx context.Context,
	callerWindowName string,
	request panelwindow.TabTransferRequest,
) error {
	if err := validatePanelCommandCaller(ctx, callerWindowName); err != nil {
		return err
	}
	return s.panelWindows.RequestPanelTabTransfer(callerWindowName, request)
}

func (s *DesktopService) AcceptPanelTabTransfer(
	ctx context.Context,
	ownerWindowName, transferID string,
) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AcceptPanelTabTransfer(ownerWindowName, transferID)
}

func (s *DesktopService) FailPanelTabTransfer(
	ctx context.Context,
	callerWindowName, transferID string,
) error {
	if err := validatePanelCommandCaller(ctx, callerWindowName); err != nil {
		return err
	}
	return s.panelWindows.FailPanelTabTransfer(callerWindowName, transferID)
}

func (s *DesktopService) RequestPanelWindowGuard(ctx context.Context, ownerWindowName, windowName, requestID, reason string) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.RequestPanelWindowGuard(ownerWindowName, windowName, requestID, reason)
}

func (s *DesktopService) AcknowledgePanelWindowGuard(ctx context.Context, windowName, requestID string, allowed bool) error {
	if err := validatePanelCommandCaller(ctx, windowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgePanelWindowGuard(windowName, requestID, allowed)
}

func (s *DesktopService) AcknowledgeApplicationQuitPreflight(ctx context.Context, ownerWindowName, transactionID string, allowed bool) error {
	if err := validatePanelCommandCaller(ctx, ownerWindowName); err != nil {
		return err
	}
	return s.panelWindows.AcknowledgeApplicationQuitPreflight(ownerWindowName, transactionID, allowed)
}
