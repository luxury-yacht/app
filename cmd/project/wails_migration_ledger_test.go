package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type wailsMigrationLedger struct {
	SchemaVersion              int                          `json:"schemaVersion"`
	Phase1Checkpoint           wailsPhase1Checkpoint        `json:"phase1Checkpoint"`
	Phase2Checkpoint           wailsPhase2Checkpoint        `json:"phase2Checkpoint"`
	Phase3Checkpoint           wailsPhase3Checkpoint        `json:"phase3Checkpoint"`
	AppFieldGroups             []wailsAppFieldLedgerGroup   `json:"appFieldGroups"`
	CommandGroups              []wailsCommandLedgerGroup    `json:"commandGroups"`
	AppBackpointerGroups       []wailsSignatureLedgerGroup  `json:"appBackpointerGroups"`
	AppParameterFunctionGroups []wailsSignatureLedgerGroup  `json:"appParameterFunctionGroups"`
	DirectAppTestGroups        []wailsTestFileLedgerGroup   `json:"directAppTestGroups"`
	TestOnlyAppMethodGroups    []wailsSignatureLedgerGroup  `json:"testOnlyAppMethodGroups"`
	SettingsEffectRoutes       []wailsSettingsEffectRoute   `json:"settingsEffectRoutes"`
	SettingsLoadCallers        []wailsSettingsLoadCaller    `json:"settingsLoadCallers"`
	DirectSettingsLoadTests    []wailsSettingsLoadTestGroup `json:"directSettingsLoadTestGroups"`
	PackageGlobalGroups        []wailsPackageGlobalGroup    `json:"packageGlobalGroups"`
	ReadinessGates             []wailsTestContract          `json:"readinessGates"`
	RaceBaselines              []wailsTestContract          `json:"raceBaselines"`
	CrossOwnerWorkflows        []wailsWorkflowContract      `json:"crossOwnerWorkflows"`
	ClusterRuntimeConsumers    []wailsConsumerContract      `json:"clusterRuntimeConsumers"`
	ResetArtifacts             []wailsArtifactContract      `json:"resetArtifacts"`
	NonCommandEntryPointGroups []wailsEntryPointGroup       `json:"nonCommandEntryPointGroups"`
}

type wailsPhase1Checkpoint struct {
	RegisteredService              string `json:"registeredService"`
	OwnerCommandInterfaces         int    `json:"ownerCommandInterfaces"`
	RemainingAppParameterFunctions int    `json:"remainingAppParameterFunctions"`
	RemainingDirectAppTests        int    `json:"remainingDirectAppTests"`
	RemainingTestOnlyAppMethods    int    `json:"remainingTestOnlyAppMethods"`
	WailsIgnoreDirectives          int    `json:"wailsIgnoreDirectives"`
}

type wailsPhase2Checkpoint struct {
	OperationsCommands             int `json:"operationsCommands"`
	RemainingAppParameterFunctions int `json:"remainingAppParameterFunctions"`
	RemainingDirectAppTests        int `json:"remainingDirectAppTests"`
	RemainingTestOnlyAppMethods    int `json:"remainingTestOnlyAppMethods"`
	OperationAppBackpointers       int `json:"operationAppBackpointers"`
	OperationPackageGlobals        int `json:"operationPackageGlobals"`
}

type wailsPhase3Checkpoint struct {
	AppFields                         int `json:"appFields"`
	RemainingAppParameterFunctions    int `json:"remainingAppParameterFunctions"`
	RemainingDirectAppTests           int `json:"remainingDirectAppTests"`
	RemainingTestOnlyAppMethods       int `json:"remainingTestOnlyAppMethods"`
	LeafOwnerAppBackpointers          int `json:"leafOwnerAppBackpointers"`
	PackageGlobalContainerLogPolicies int `json:"packageGlobalContainerLogPolicies"`
}

type wailsAppFieldLedgerGroup struct {
	ID       string   `json:"id"`
	Fields   []string `json:"fields"`
	Readers  []string `json:"readers"`
	Writers  []string `json:"writers"`
	Mutex    string   `json:"mutex"`
	Startup  string   `json:"startup"`
	Shutdown string   `json:"shutdown"`
	Tests    []string `json:"tests"`
	Owner    string   `json:"owner"`
	Phase    string   `json:"phase"`
}

type wailsCommandLedgerGroup struct {
	ID             string   `json:"id"`
	Commands       []string `json:"commands"`
	FrontendBroker string   `json:"frontendBroker"`
	Consumers      []string `json:"consumers"`
	Identity       string   `json:"identity"`
	ErrorContract  string   `json:"errorContract"`
	Owner          string   `json:"owner"`
	Phase          string   `json:"phase"`
}

type wailsSignatureLedgerGroup struct {
	ID          string   `json:"id"`
	Entries     []string `json:"entries"`
	Replacement string   `json:"replacement"`
	Phase       string   `json:"phase"`
}

type wailsTestFileLedgerGroup struct {
	ID             string   `json:"id"`
	Files          []string `json:"files"`
	Classification string   `json:"classification"`
	Owner          string   `json:"owner"`
	Phase          string   `json:"phase"`
}

type wailsSettingsEffectRoute struct {
	Route      string   `json:"route"`
	Baseline   string   `json:"baseline"`
	Producers  []string `json:"producers"`
	Owner      string   `json:"owner"`
	Sink       string   `json:"sink"`
	Target     string   `json:"target"`
	Startup    string   `json:"startup"`
	Update     string   `json:"update"`
	Validation []string `json:"validation"`
}

type wailsSettingsLoadCaller struct {
	Entry         string `json:"entry"`
	CurrentLock   string `json:"currentLock"`
	FailurePolicy string `json:"failurePolicy"`
	Replacement   string `json:"replacement"`
	Phase         string `json:"phase"`
}

type wailsSettingsLoadTestGroup struct {
	ID             string   `json:"id"`
	Entries        []string `json:"entries"`
	Classification string   `json:"classification"`
	Replacement    string   `json:"replacement"`
	Phase          string   `json:"phase"`
}

type wailsPackageGlobalGroup struct {
	ID       string   `json:"id"`
	Entries  []string `json:"entries"`
	Mutation string   `json:"mutation"`
	Owner    string   `json:"owner"`
	Phase    string   `json:"phase"`
}

type wailsTestContract struct {
	ID       string   `json:"id"`
	Tests    []string `json:"tests"`
	Contract string   `json:"contract"`
	Owner    string   `json:"owner"`
	Phase    string   `json:"phase"`
}

type wailsWorkflowContract struct {
	ID             string   `json:"id"`
	Producers      []string `json:"producers"`
	CurrentContext string   `json:"currentContext"`
	Payload        string   `json:"payload"`
	Consumer       string   `json:"consumer"`
	Replacement    string   `json:"replacement"`
	Backpressure   string   `json:"backpressure"`
	Cancellation   string   `json:"cancellation"`
	Owner          string   `json:"owner"`
	Phase          string   `json:"phase"`
	Tests          []string `json:"tests"`
}

type wailsConsumerContract struct {
	ID               string `json:"id"`
	CurrentReach     string `json:"currentReach"`
	Interface        string `json:"interface"`
	Implementation   string `json:"implementation"`
	ReplacementPhase string `json:"replacementPhase"`
	Owner            string `json:"owner"`
}

type wailsArtifactContract struct {
	ID              string   `json:"id"`
	Artifacts       []string `json:"artifacts"`
	CurrentResolver string   `json:"currentResolver"`
	Resolution      string   `json:"resolution"`
	LiveReset       string   `json:"liveReset"`
	OfflineReset    string   `json:"offlineReset"`
	Owner           string   `json:"owner"`
	Phase           string   `json:"phase"`
	Tests           []string `json:"tests"`
}

type wailsEntryPointGroup struct {
	ID          string   `json:"id"`
	Entries     []string `json:"entries"`
	Caller      string   `json:"caller"`
	Replacement string   `json:"replacement"`
	Owner       string   `json:"owner"`
	Phase       string   `json:"phase"`
}

func TestWailsMigrationLedgerCoversAppFieldsAndCommandsExactlyOnce(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	require.Equal(t, 1, ledger.SchemaVersion)

	ledgerFields := flattenUniqueLedgerNames(t, "App field", ledger.AppFieldGroups, func(group wailsAppFieldLedgerGroup) (string, []string) {
		require.NotEmpty(t, group.Readers, "%s readers", group.ID)
		require.NotEmpty(t, group.Writers, "%s writers", group.ID)
		require.NotEmpty(t, group.Mutex, "%s mutex", group.ID)
		require.NotEmpty(t, group.Startup, "%s startup", group.ID)
		require.NotEmpty(t, group.Shutdown, "%s shutdown", group.ID)
		require.NotEmpty(t, group.Tests, "%s tests", group.ID)
		require.NotEmpty(t, group.Owner, "%s owner", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Fields
	})
	require.Equal(t, currentAppFieldNames(t), ledgerFields)

	ledgerCommands := flattenUniqueLedgerNames(t, "Wails command", ledger.CommandGroups, func(group wailsCommandLedgerGroup) (string, []string) {
		require.NotEmpty(t, group.FrontendBroker, "%s frontend broker", group.ID)
		require.NotEmpty(t, group.Consumers, "%s consumers", group.ID)
		require.NotEmpty(t, group.Identity, "%s identity", group.ID)
		require.NotEmpty(t, group.ErrorContract, "%s error contract", group.ID)
		require.NotEmpty(t, group.Owner, "%s owner", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Commands
	})
	require.Equal(t, currentGeneratedWailsCommands(t), ledgerCommands)
}

func TestDesktopServiceCollaboratorsMatchCommandOwnershipLedger(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	interfaceByOwner := map[string]string{
		"FavoritesService":          "FavoritesCommands",
		"UIStateStore":              "UIStateCommands",
		"PreferencesService":        "PreferencesCommands",
		"DataManagementCoordinator": "DataManagementCommands",
		"ClusterAttentionService":   "ClusterAttentionCommands",
		"WorkspaceCoordinator":      "WorkspaceCommands",
		"ClusterRuntimeManager":     "ClusterRuntimeCommands",
		"ResourceGateway":           "ResourceCommands",
		"OperationsCoordinator":     "OperationsCommands",
		"UpdateCoordinator":         "UpdateCommands",
		"AppLogService":             "AppLogCommands",
		"DesktopShell":              "DesktopShellCommands",
	}
	fieldByOwner := map[string]string{
		"FavoritesService":          "favorites",
		"UIStateStore":              "uiState",
		"PreferencesService":        "preferences",
		"DataManagementCoordinator": "dataManagement",
		"ClusterAttentionService":   "attention",
		"WorkspaceCoordinator":      "workspace",
		"ClusterRuntimeManager":     "clusterRuntime",
		"ResourceGateway":           "resources",
		"OperationsCoordinator":     "operations",
		"UpdateCoordinator":         "updates",
		"AppLogService":             "logs",
		"DesktopShell":              "desktopShell",
	}
	interfaceMethods, delegations := currentDesktopServiceContract(t)
	require.Len(t, interfaceMethods, len(interfaceByOwner)+1, "command interfaces plus lifecycle")

	allCommands := make([]string, 0)
	for _, group := range ledger.CommandGroups {
		interfaceName, ok := interfaceByOwner[group.Owner]
		require.True(t, ok, "command owner %q has no DesktopService interface", group.Owner)
		expected := slices.Clone(group.Commands)
		slices.Sort(expected)
		require.Equal(t, expected, interfaceMethods[interfaceName], group.Owner)
		for _, command := range group.Commands {
			require.Equal(t, fieldByOwner[group.Owner]+"."+command, delegations[command], command)
		}
		allCommands = append(allCommands, group.Commands...)
	}
	slices.Sort(allCommands)
	actualCommands := make([]string, 0, len(delegations))
	for command := range delegations {
		actualCommands = append(actualCommands, command)
	}
	slices.Sort(actualCommands)
	require.Equal(t, allCommands, actualCommands)
}

func TestWailsMigrationLedgerRecordsPhase1RemainingCoupling(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	checkpoint := ledger.Phase1Checkpoint
	serviceType := registeredWailsServiceType(t, readTestFile(t, repositoryPath("main.go")))
	require.Equal(t, serviceType, checkpoint.RegisteredService)
	require.Equal(t, 12, checkpoint.OwnerCommandInterfaces)
	require.Equal(t, 14, checkpoint.RemainingAppParameterFunctions)
	require.Equal(t, 59, checkpoint.RemainingDirectAppTests)
	require.Equal(t, 16, checkpoint.RemainingTestOnlyAppMethods)
	require.Equal(t, currentBackendWailsIgnoreDirectiveCount(t), checkpoint.WailsIgnoreDirectives)
}

func TestWailsMigrationLedgerRecordsPhase2OperationsExtraction(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	checkpoint := ledger.Phase2Checkpoint
	require.Equal(t, 10, checkpoint.OperationsCommands)
	require.Equal(t, 14, checkpoint.RemainingAppParameterFunctions)
	require.Equal(t, 59, checkpoint.RemainingDirectAppTests)
	require.Equal(t, 16, checkpoint.RemainingTestOnlyAppMethods)
	require.Zero(t, checkpoint.OperationAppBackpointers)
	require.Equal(t, 1, checkpoint.OperationPackageGlobals)
}

func TestWailsMigrationLedgerRecordsPhase3LeafExtraction(t *testing.T) {
	checkpoint := readWailsMigrationLedger(t).Phase3Checkpoint
	require.Equal(t, len(currentAppFieldNames(t)), checkpoint.AppFields)
	require.Equal(t, len(currentAppParameterFunctions(t)), checkpoint.RemainingAppParameterFunctions)
	require.Equal(t, len(currentDirectAppTestFiles(t)), checkpoint.RemainingDirectAppTests)
	require.Equal(t, len(currentTestOnlyAppMethods(t)), checkpoint.RemainingTestOnlyAppMethods)
	require.Zero(t, checkpoint.LeafOwnerAppBackpointers)
	require.Zero(t, checkpoint.PackageGlobalContainerLogPolicies)
}

func TestWailsMigrationLedgerCoversConcreteAppCouplingExactlyOnce(t *testing.T) {
	ledger := readWailsMigrationLedger(t)

	backpointers := flattenUniqueLedgerNames(t, "App back-pointer", ledger.AppBackpointerGroups, func(group wailsSignatureLedgerGroup) (string, []string) {
		require.NotEmpty(t, group.Replacement, "%s replacement", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Entries
	})
	require.Equal(t, currentAppBackpointers(t), backpointers)

	functions := flattenUniqueLedgerNames(t, "App-parameter function", ledger.AppParameterFunctionGroups, func(group wailsSignatureLedgerGroup) (string, []string) {
		require.NotEmpty(t, group.Replacement, "%s replacement", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Entries
	})
	require.Equal(t, currentAppParameterFunctions(t), functions)
}

func TestWailsMigrationLedgerCoversAppTestSupportExactlyOnce(t *testing.T) {
	ledger := readWailsMigrationLedger(t)

	testFiles := flattenUniqueLedgerNames(t, "direct-App test file", ledger.DirectAppTestGroups, func(group wailsTestFileLedgerGroup) (string, []string) {
		require.Contains(t, []string{"component", "cross-component-workflow", "full-composition-lifecycle"}, group.Classification, "%s classification", group.ID)
		require.NotEmpty(t, group.Owner, "%s owner", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Files
	})
	require.Equal(t, currentDirectAppTestFiles(t), testFiles)

	testMethods := flattenUniqueLedgerNames(t, "test-only App method", ledger.TestOnlyAppMethodGroups, func(group wailsSignatureLedgerGroup) (string, []string) {
		require.NotEmpty(t, group.Replacement, "%s replacement", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Entries
	})
	require.Equal(t, currentTestOnlyAppMethods(t), testMethods)
}

func TestWailsMigrationLedgerCoversSettingsEffectsAndLazyLoadExactlyOnce(t *testing.T) {
	ledger := readWailsMigrationLedger(t)

	routes := make([]string, 0, len(ledger.SettingsEffectRoutes))
	seenRoutes := make(map[string]struct{}, len(ledger.SettingsEffectRoutes))
	for _, route := range ledger.SettingsEffectRoutes {
		require.NotEmpty(t, route.Route)
		_, duplicate := seenRoutes[route.Route]
		require.False(t, duplicate, "duplicate settings-effect route %q", route.Route)
		seenRoutes[route.Route] = struct{}{}
		require.NotEmpty(t, route.Baseline, "%s baseline", route.Route)
		require.NotEmpty(t, route.Producers, "%s producers", route.Route)
		require.NotEmpty(t, route.Owner, "%s owner", route.Route)
		require.NotEmpty(t, route.Sink, "%s sink", route.Route)
		require.NotEmpty(t, route.Target, "%s target", route.Route)
		require.NotEmpty(t, route.Startup, "%s startup", route.Route)
		require.NotEmpty(t, route.Update, "%s update", route.Route)
		require.NotEmpty(t, route.Validation, "%s validation", route.Route)
		routes = append(routes, route.Route)
	}
	slices.Sort(routes)
	require.Equal(t, currentSettingsEffectRoutes(t), routes)

	callers := make([]string, 0, len(ledger.SettingsLoadCallers))
	seenCallers := make(map[string]struct{}, len(ledger.SettingsLoadCallers))
	for _, caller := range ledger.SettingsLoadCallers {
		require.NotEmpty(t, caller.Entry)
		_, duplicate := seenCallers[caller.Entry]
		require.False(t, duplicate, "duplicate settings-load caller %q", caller.Entry)
		seenCallers[caller.Entry] = struct{}{}
		require.NotEmpty(t, caller.CurrentLock, "%s current lock", caller.Entry)
		require.NotEmpty(t, caller.FailurePolicy, "%s failure policy", caller.Entry)
		require.NotEmpty(t, caller.Replacement, "%s replacement", caller.Entry)
		require.NotEmpty(t, caller.Phase, "%s phase", caller.Entry)
		callers = append(callers, caller.Entry)
	}
	slices.Sort(callers)
	require.Equal(t, currentSettingsLoadCallers(t, false), callers)

	testCalls := flattenUniqueLedgerNames(t, "direct settings-load test call", ledger.DirectSettingsLoadTests, func(group wailsSettingsLoadTestGroup) (string, []string) {
		require.Contains(t, []string{"ensure-loaded-contract", "persistence-codec-repository", "caller-failure-policy"}, group.Classification, "%s classification", group.ID)
		require.NotEmpty(t, group.Replacement, "%s replacement", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Entries
	})
	require.Equal(t, currentSettingsLoadCallers(t, true), testCalls)
}

func TestWailsMigrationLedgerCoversPackageGlobalsExactlyOnce(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	globals := flattenUniqueLedgerNames(t, "package global", ledger.PackageGlobalGroups, func(group wailsPackageGlobalGroup) (string, []string) {
		require.NotEmpty(t, group.Mutation, "%s mutation contract", group.ID)
		require.NotEmpty(t, group.Owner, "%s owner", group.ID)
		require.NotEmpty(t, group.Phase, "%s phase", group.ID)
		return group.ID, group.Entries
	})
	require.Equal(t, currentBackendPackageGlobals(t), globals)
}

func TestWailsMigrationLedgerNamesExecutableReadinessAndRaceContracts(t *testing.T) {
	ledger := readWailsMigrationLedger(t)
	for label, contracts := range map[string][]wailsTestContract{
		"readiness gate": ledger.ReadinessGates,
		"race baseline":  ledger.RaceBaselines,
	} {
		seen := make(map[string]struct{}, len(contracts))
		require.NotEmpty(t, contracts, label)
		for _, contract := range contracts {
			require.NotEmpty(t, contract.ID)
			_, duplicate := seen[contract.ID]
			require.False(t, duplicate, "duplicate %s %q", label, contract.ID)
			seen[contract.ID] = struct{}{}
			require.NotEmpty(t, contract.Tests, "%s %s tests", label, contract.ID)
			require.NotEmpty(t, contract.Contract, "%s %s contract", label, contract.ID)
			require.NotEmpty(t, contract.Owner, "%s %s owner", label, contract.ID)
			require.NotEmpty(t, contract.Phase, "%s %s phase", label, contract.ID)
			for _, testEntry := range contract.Tests {
				requireGoTestExists(t, testEntry)
			}
		}
	}
}

func TestWailsMigrationLedgerClosesCrossOwnerWorkflowAndBoundaryInventories(t *testing.T) {
	ledger := readWailsMigrationLedger(t)

	requireExactContractIDs(t, "cross-owner workflow", []string{
		"auth-state-intent",
		"factory-reset",
		"kubeconfig-search-path-change",
		"kubeconfig-watcher-intent",
		"transport-failure-intent",
	}, slices.Collect(func(yield func(string) bool) {
		for _, workflow := range ledger.CrossOwnerWorkflows {
			require.NotEmpty(t, workflow.Producers, "%s producers", workflow.ID)
			require.NotEmpty(t, workflow.CurrentContext, "%s current context", workflow.ID)
			require.NotEmpty(t, workflow.Payload, "%s payload", workflow.ID)
			require.NotEmpty(t, workflow.Consumer, "%s consumer", workflow.ID)
			require.NotEmpty(t, workflow.Replacement, "%s replacement", workflow.ID)
			require.NotEmpty(t, workflow.Backpressure, "%s backpressure", workflow.ID)
			require.NotEmpty(t, workflow.Cancellation, "%s cancellation", workflow.ID)
			require.NotEmpty(t, workflow.Owner, "%s owner", workflow.ID)
			require.NotEmpty(t, workflow.Phase, "%s phase", workflow.ID)
			for _, testEntry := range workflow.Tests {
				requireGoTestExists(t, testEntry)
			}
			if !yield(workflow.ID) {
				return
			}
		}
	}))

	requireExactContractIDs(t, "cluster-runtime consumer", []string{
		"application-lifecycle",
		"cluster-workspace-projection",
		"desktop-service",
		"operations-coordinator",
		"refresh-coordinator",
		"resource-gateway",
		"workspace-coordinator",
	}, slices.Collect(func(yield func(string) bool) {
		for _, consumer := range ledger.ClusterRuntimeConsumers {
			require.NotEmpty(t, consumer.CurrentReach, "%s current reach", consumer.ID)
			require.NotEmpty(t, consumer.Interface, "%s interface", consumer.ID)
			require.NotEmpty(t, consumer.Implementation, "%s implementation", consumer.ID)
			require.NotEmpty(t, consumer.ReplacementPhase, "%s replacement phase", consumer.ID)
			require.NotEmpty(t, consumer.Owner, "%s owner", consumer.ID)
			if !yield(consumer.ID) {
				return
			}
		}
	}))

	requireExactContractIDs(t, "reset artifact", []string{
		"application-update-state",
		"favorites-state",
		"preferences-state",
		"refresh-cache-state",
		"ui-persistence-state",
		"updater-dynamic-artifacts",
	}, slices.Collect(func(yield func(string) bool) {
		for _, artifact := range ledger.ResetArtifacts {
			require.NotEmpty(t, artifact.Artifacts, "%s artifacts", artifact.ID)
			require.NotEmpty(t, artifact.CurrentResolver, "%s current resolver", artifact.ID)
			require.NotEmpty(t, artifact.Resolution, "%s resolution", artifact.ID)
			require.NotEmpty(t, artifact.LiveReset, "%s live reset", artifact.ID)
			require.NotEmpty(t, artifact.OfflineReset, "%s offline reset", artifact.ID)
			require.NotEmpty(t, artifact.Owner, "%s owner", artifact.ID)
			require.NotEmpty(t, artifact.Phase, "%s phase", artifact.ID)
			for _, testEntry := range artifact.Tests {
				requireGoTestExists(t, testEntry)
			}
			if !yield(artifact.ID) {
				return
			}
		}
	}))

	requireExactContractIDs(t, "non-command entry-point group", []string{
		"generator-model-anchor",
		"main-composition",
		"menu-and-window-callbacks",
		"peer-window-lifecycle",
		"test-support",
		"wails-service-lifecycle-and-transport",
	}, slices.Collect(func(yield func(string) bool) {
		for _, group := range ledger.NonCommandEntryPointGroups {
			require.NotEmpty(t, group.Entries, "%s entries", group.ID)
			require.NotEmpty(t, group.Caller, "%s caller", group.ID)
			require.NotEmpty(t, group.Replacement, "%s replacement", group.ID)
			require.NotEmpty(t, group.Owner, "%s owner", group.ID)
			require.NotEmpty(t, group.Phase, "%s phase", group.ID)
			if !yield(group.ID) {
				return
			}
		}
	}))
}

func requireExactContractIDs(t *testing.T, label string, expected, actual []string) {
	t.Helper()
	slices.Sort(expected)
	slices.Sort(actual)
	require.Equal(t, expected, actual, label)
}

func readWailsMigrationLedger(t *testing.T) wailsMigrationLedger {
	t.Helper()
	contents := readTestFile(t, repositoryPath("docs", "plans", "wails-service-boundary-and-app-decomposition-ledger.json"))
	var ledger wailsMigrationLedger
	require.NoError(t, json.Unmarshal([]byte(contents), &ledger))
	return ledger
}

func flattenUniqueLedgerNames[T any](
	t *testing.T,
	label string,
	groups []T,
	groupValues func(T) (string, []string),
) []string {
	t.Helper()
	seenGroups := make(map[string]struct{}, len(groups))
	seenNames := make(map[string]string)
	result := make([]string, 0)
	for _, group := range groups {
		groupID, names := groupValues(group)
		require.NotEmpty(t, groupID)
		_, duplicateGroup := seenGroups[groupID]
		require.False(t, duplicateGroup, "duplicate ledger group %q", groupID)
		seenGroups[groupID] = struct{}{}
		require.NotEmpty(t, names, "%s group %q", label, groupID)
		for _, name := range names {
			if previousGroup, exists := seenNames[name]; exists {
				t.Fatalf("%s %q appears in both %q and %q", label, name, previousGroup, groupID)
			}
			seenNames[name] = groupID
			result = append(result, name)
		}
	}
	slices.Sort(result)
	return result
}

func currentAppFieldNames(t *testing.T) []string {
	t.Helper()
	path := repositoryPath("backend", "app.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	require.NoError(t, err)

	result := make([]string, 0)
	for _, declaration := range parsed.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.TYPE {
			continue
		}
		for _, specification := range general.Specs {
			typeSpec, ok := specification.(*ast.TypeSpec)
			if !ok || typeSpec.Name.Name != "App" {
				continue
			}
			appStruct, ok := typeSpec.Type.(*ast.StructType)
			require.True(t, ok)
			for _, field := range appStruct.Fields.List {
				for _, name := range field.Names {
					result = append(result, name.Name)
				}
			}
		}
	}
	require.NotEmpty(t, result)
	slices.Sort(result)
	return result
}

func currentGeneratedWailsCommands(t *testing.T) []string {
	t.Helper()
	serviceType := registeredWailsServiceType(t, readTestFile(t, repositoryPath("main.go")))
	_, source := generatedWailsServiceModule(t, serviceType)
	commands := exportedFunctions(source)
	slices.Sort(commands)
	return commands
}

func currentAppBackpointers(t *testing.T) []string {
	t.Helper()
	result := make([]string, 0)
	forEachProductionBackendFile(t, func(path string, parsed *ast.File) {
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.TYPE {
				continue
			}
			for _, specification := range general.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok {
					continue
				}
				structure, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				for _, field := range structure.Fields.List {
					if !isBackendAppPointer(field.Type) {
						continue
					}
					for _, name := range field.Names {
						result = append(result, filepath.Base(path)+":"+typeSpec.Name.Name+"."+name.Name)
					}
				}
			}
		}
	})
	slices.Sort(result)
	return result
}

func currentAppParameterFunctions(t *testing.T) []string {
	t.Helper()
	result := make([]string, 0)
	forEachProductionBackendFile(t, func(path string, parsed *ast.File) {
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Recv != nil || function.Type.Params == nil {
				continue
			}
			for _, parameter := range function.Type.Params.List {
				if !isBackendAppPointer(parameter.Type) {
					continue
				}
				for _, name := range parameter.Names {
					result = append(result, filepath.Base(path)+":"+function.Name.Name+":"+name.Name)
				}
			}
		}
	})
	slices.Sort(result)
	return result
}

func currentDirectAppTestFiles(t *testing.T) []string {
	t.Helper()
	paths, err := filepath.Glob(repositoryPath("backend", "*_test.go"))
	require.NoError(t, err)
	result := make([]string, 0)
	for _, path := range paths {
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, err)
		usesApp := false
		ast.Inspect(parsed, func(node ast.Node) bool {
			switch expression := node.(type) {
			case *ast.CallExpr:
				identifier, ok := expression.Fun.(*ast.Ident)
				usesApp = usesApp || (ok && (identifier.Name == "NewApp" || identifier.Name == "newTestAppWithDefaults"))
			case *ast.CompositeLit:
				identifier, ok := expression.Type.(*ast.Ident)
				usesApp = usesApp || (ok && identifier.Name == "App")
			}
			return !usesApp
		})
		if usesApp {
			result = append(result, filepath.Base(path))
		}
	}
	slices.Sort(result)
	return result
}

func currentTestOnlyAppMethods(t *testing.T) []string {
	t.Helper()
	path := repositoryPath("backend", "test_entrypoints_test.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	require.NoError(t, err)
	result := make([]string, 0)
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Recv == nil || len(function.Recv.List) != 1 || !isBackendAppPointer(function.Recv.List[0].Type) {
			continue
		}
		result = append(result, filepath.Base(path)+":App."+function.Name.Name)
	}
	slices.Sort(result)
	return result
}

func currentSettingsEffectRoutes(t *testing.T) []string {
	t.Helper()
	path := repositoryPath("backend", "app_settings.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	require.NoError(t, err)
	result := make([]string, 0, 6)
	for _, declaration := range parsed.Decls {
		switch declaration := declaration.(type) {
		case *ast.GenDecl:
			for _, specification := range declaration.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != "settingsSideEffects" {
					continue
				}
				structure, ok := typeSpec.Type.(*ast.StructType)
				require.True(t, ok)
				for _, field := range structure.Fields.List {
					for _, name := range field.Names {
						result = append(result, name.Name)
					}
				}
			}
		case *ast.FuncDecl:
			if declaration.Name.Name == "permissionSSRRFetchConcurrency" {
				result = append(result, declaration.Name.Name)
			}
		}
	}
	slices.Sort(result)
	require.Len(t, result, 6)
	return result
}

func currentSettingsLoadCallers(t *testing.T, tests bool) []string {
	t.Helper()
	pattern := "*.go"
	if tests {
		pattern = "*_test.go"
	}
	paths, err := filepath.Glob(repositoryPath("backend", pattern))
	require.NoError(t, err)
	result := make([]string, 0)
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") != tests {
			continue
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		require.NoError(t, err)
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			callCount := 0
			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if ok && selector.Sel.Name == "loadAppSettings" {
					callCount++
				}
				return true
			})
			for callIndex := 1; callIndex <= callCount; callIndex++ {
				entry := filepath.Base(path) + ":" + appFunctionName(function)
				if tests {
					entry += fmt.Sprintf("#%d", callIndex)
				}
				result = append(result, entry)
			}
		}
	}
	slices.Sort(result)
	return result
}

func appFunctionName(function *ast.FuncDecl) string {
	if function.Recv != nil && len(function.Recv.List) == 1 && isBackendAppPointer(function.Recv.List[0].Type) {
		return "App." + function.Name.Name
	}
	return function.Name.Name
}

func currentBackendPackageGlobals(t *testing.T) []string {
	t.Helper()
	result := make([]string, 0)
	forEachProductionBackendFile(t, func(path string, parsed *ast.File) {
		for _, declaration := range parsed.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.VAR {
				continue
			}
			for _, specification := range general.Specs {
				value, ok := specification.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for _, name := range value.Names {
					result = append(result, filepath.Base(path)+":"+name.Name)
				}
			}
		}
	})

	containerLogsPath := repositoryPath("backend", "internal", "containerlogs", "targets.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), containerLogsPath, nil, 0)
	require.NoError(t, err)
	for _, declaration := range parsed.Decls {
		general, ok := declaration.(*ast.GenDecl)
		if !ok || general.Tok != token.VAR {
			continue
		}
		for _, specification := range general.Specs {
			value, ok := specification.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for _, name := range value.Names {
				result = append(result, "internal/containerlogs/targets.go:"+name.Name)
			}
		}
	}
	slices.Sort(result)
	return result
}

func currentDesktopServiceContract(t *testing.T) (map[string][]string, map[string]string) {
	t.Helper()
	path := repositoryPath("backend", "desktop_service.go")
	parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	require.NoError(t, err)

	interfaces := make(map[string][]string)
	delegations := make(map[string]string)
	frameworkMethods := map[string]struct{}{
		"ServiceStartup":  {},
		"ServiceShutdown": {},
		"ServeHTTP":       {},
	}
	for _, declaration := range parsed.Decls {
		switch declaration := declaration.(type) {
		case *ast.GenDecl:
			if declaration.Tok != token.TYPE {
				continue
			}
			for _, specification := range declaration.Specs {
				typeSpec, ok := specification.(*ast.TypeSpec)
				if !ok {
					continue
				}
				contract, ok := typeSpec.Type.(*ast.InterfaceType)
				if !ok {
					continue
				}
				methods := make([]string, 0, len(contract.Methods.List))
				for _, method := range contract.Methods.List {
					for _, name := range method.Names {
						methods = append(methods, name.Name)
					}
				}
				slices.Sort(methods)
				interfaces[typeSpec.Name.Name] = methods
			}
		case *ast.FuncDecl:
			if declaration.Recv == nil || len(declaration.Recv.List) != 1 || !isPointerToNamedType(declaration.Recv.List[0].Type, "DesktopService") {
				continue
			}
			if _, framework := frameworkMethods[declaration.Name.Name]; framework {
				continue
			}
			delegation := ""
			ast.Inspect(declaration.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				method, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				owner, ok := method.X.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				receiver, ok := owner.X.(*ast.Ident)
				if !ok || receiver.Name != "s" {
					return true
				}
				delegation = owner.Sel.Name + "." + method.Sel.Name
				return false
			})
			require.NotEmpty(t, delegation, declaration.Name.Name)
			delegations[declaration.Name.Name] = delegation
		}
	}
	return interfaces, delegations
}

func currentBackendWailsIgnoreDirectiveCount(t *testing.T) int {
	t.Helper()
	count := 0
	err := filepath.Walk(repositoryPath("backend"), func(path string, info os.FileInfo, walkErr error) error {
		require.NoError(t, walkErr)
		if info.IsDir() || filepath.Ext(path) != ".go" {
			return nil
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ParseComments)
		require.NoError(t, err)
		for _, group := range parsed.Comments {
			for _, comment := range group.List {
				if strings.TrimSpace(comment.Text) == "//wails:"+"ignore" {
					count++
				}
			}
		}
		return nil
	})
	require.NoError(t, err)
	return count
}

func isPointerToNamedType(expression ast.Expr, name string) bool {
	pointer, ok := expression.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == name
}

func requireGoTestExists(t *testing.T, entry string) {
	t.Helper()
	path, name, ok := strings.Cut(entry, ":")
	require.True(t, ok, "test entry %q must be path:TestName", entry)
	require.NotEmpty(t, path)
	require.NotEmpty(t, name)
	parsed, err := parser.ParseFile(token.NewFileSet(), repositoryPath(strings.Split(path, "/")...), nil, 0)
	require.NoError(t, err, entry)
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if ok && function.Name.Name == name {
			return
		}
	}
	t.Fatalf("test entry %q does not name a Go test function", entry)
}

func isBackendAppPointer(expression ast.Expr) bool {
	pointer, ok := expression.(*ast.StarExpr)
	if !ok {
		return false
	}
	identifier, ok := pointer.X.(*ast.Ident)
	return ok && identifier.Name == "App"
}

func forEachProductionBackendFile(t *testing.T, visit func(string, *ast.File)) {
	t.Helper()
	paths, err := filepath.Glob(repositoryPath("backend", "*.go"))
	require.NoError(t, err)
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		contents, err := os.ReadFile(path)
		require.NoError(t, err)
		parsed, err := parser.ParseFile(token.NewFileSet(), path, contents, 0)
		require.NoError(t, err)
		visit(path, parsed)
	}
}
