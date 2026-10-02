package kindtest

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

type scriptFixture struct {
	test  *testing.T
	root  string
	bin   string
	shell string
}

type cliCall struct {
	Command string
	Args    []string
	Input   string
}

func newScriptFixture(test *testing.T) *scriptFixture {
	test.Helper()
	if runtime.GOOS == "windows" {
		test.Skip("Kind development scripts require a Unix shell")
	}
	fixture := &scriptFixture{test: test, root: test.TempDir(), shell: "bash"}
	fixture.bin = filepath.Join(fixture.root, "bin")
	require.NoError(test, os.MkdirAll(fixture.bin, 0o700))
	require.NoError(test, os.MkdirAll(filepath.Join(fixture.root, ".kube"), 0o700))
	executable, err := os.Executable()
	require.NoError(test, err)
	for _, command := range []string{"kind", "kubectl", "helm"} {
		wrapper := fmt.Sprintf("#!/bin/sh\nexec '%s' -test.run=^TestKindCLIHelper$ -- %s \"$@\"\n", strings.ReplaceAll(executable, "'", "'\\''"), command)
		require.NoError(test, os.WriteFile(filepath.Join(fixture.bin, command), []byte(wrapper), 0o700))
	}
	for _, script := range []string{"clusters.sh", "restricted.sh", "workloads.sh", "common.sh"} {
		content, err := os.ReadFile(script)
		require.NoError(test, err)
		content = []byte(strings.ReplaceAll(string(content), "${HOME}", fixture.root))
		require.NoError(test, os.WriteFile(filepath.Join(fixture.root, script), content, 0o600))
	}
	require.NoError(test, os.CopyFS(filepath.Join(fixture.root, "clusters"), os.DirFS("clusters")))
	return fixture
}

func (fixture *scriptFixture) run(script string, args ...string) error {
	fixture.test.Helper()
	command := exec.Command(fixture.shell, append([]string{filepath.Join(fixture.root, script)}, args...)...)
	command.Env = append(os.Environ(), "PATH="+fixture.bin+string(os.PathListSeparator)+os.Getenv("PATH"), "LY_KIND_TEST_ROOT="+fixture.root, "GORACE=atexit_sleep_ms=0")
	output, err := command.CombinedOutput()
	fixture.test.Logf("%s %s: %s", script, strings.Join(args, " "), output)
	return err
}

func (fixture *scriptFixture) write(path, content string) {
	fixture.test.Helper()
	fullPath := filepath.Join(fixture.root, path)
	require.NoError(fixture.test, os.MkdirAll(filepath.Dir(fullPath), 0o700))
	require.NoError(fixture.test, os.WriteFile(fullPath, []byte(content), 0o600))
}

func (fixture *scriptFixture) calls() []cliCall {
	fixture.test.Helper()
	content, err := os.ReadFile(filepath.Join(fixture.root, "calls"))
	if os.IsNotExist(err) {
		return nil
	}
	require.NoError(fixture.test, err)
	var calls []cliCall
	for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
		var call cliCall
		require.NoError(fixture.test, json.Unmarshal([]byte(line), &call))
		calls = append(calls, call)
	}
	return calls
}

func TestClustersPreserveCredentialsThroughRepeatedLifecycle(test *testing.T) {
	fixture := newScriptFixture(test)
	fixture.write(".kube/config", "personal credentials")
	fixture.write(".kube/restricted-cluster", "restricted credentials")
	fixture.write(".kube.luxury-yacht-test/config", "older backup")
	for _, action := range []string{"stop", "start", "start", "stop", "stop"} {
		require.NoError(test, fixture.run("clusters.sh", action))
		for path, expected := range map[string]string{
			".kube/config":                   "personal credentials",
			".kube/restricted-cluster":       "restricted credentials",
			".kube.luxury-yacht-test/config": "older backup",
		} {
			content, err := os.ReadFile(filepath.Join(fixture.root, path))
			require.NoError(test, err)
			require.Equal(test, expected, string(content))
		}
	}
	for _, filename := range []string{"dev-stg-clusters", "prod-clusters"} {
		require.NoFileExists(test, filepath.Join(fixture.root, ".kube", filename))
	}
	for _, call := range fixture.calls() {
		if call.Command == "kind" && slices.Contains(call.Args, "delete") {
			require.Contains(test, call.Args, "--kubeconfig")
		}
	}
}

func TestClusterStartupReconcilesExistingKubeconfigs(test *testing.T) {
	for _, existingConfig := range []bool{false, true} {
		test.Run(strconv.FormatBool(existingConfig), func(test *testing.T) {
			fixture := newScriptFixture(test)
			for _, cluster := range []string{"dev-cluster", "stg-cluster", "prod-cluster"} {
				fixture.write("cluster-"+cluster, "")
			}
			if existingConfig {
				fixture.write(".kube/dev-stg-clusters", "dev-cluster\nstg-cluster\n")
				fixture.write(".kube/prod-clusters", "prod-cluster\n")
			}
			require.NoError(test, fixture.run("clusters.sh", "start"))
			for filename, expected := range map[string][]string{
				"dev-stg-clusters": {"dev-cluster", "stg-cluster"},
				"prod-clusters":    {"prod-cluster"},
			} {
				content, err := os.ReadFile(filepath.Join(fixture.root, ".kube", filename))
				require.NoError(test, err)
				require.ElementsMatch(test, expected, strings.Fields(string(content)))
			}
		})
	}
}

func TestClusterStartupResumesAfterMetricsFailure(test *testing.T) {
	fixture := newScriptFixture(test)
	fixture.write(".kube/config", "personal credentials")
	fixture.write("fail-metrics", "")
	require.Error(test, fixture.run("clusters.sh", "start"))
	require.NoError(test, os.Remove(filepath.Join(fixture.root, "fail-metrics")))
	require.NoError(test, fixture.run("clusters.sh", "start"))
	var patched []string
	for _, call := range fixture.calls() {
		if call.Command == "kubectl" && slices.Contains(call.Args, "patch") {
			patched = append(patched, option(call.Args, "--context"))
		}
	}
	require.ElementsMatch(test, []string{"dev-cluster", "stg-cluster", "prod-cluster"}, patched)
}

func TestClusterDiscoveryFailurePreservesKubeconfigs(test *testing.T) {
	for _, script := range []string{"clusters.sh", "restricted.sh"} {
		test.Run(script, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.write("fail-clusters", "")
			fixture.write(".kube/dev-stg-clusters", "test credentials")
			fixture.write(".kube/restricted-cluster", "restricted credentials")
			for _, action := range []string{"start", "stop"} {
				require.Error(test, fixture.run(script, action))
				require.FileExists(test, filepath.Join(fixture.root, ".kube/dev-stg-clusters"))
				require.FileExists(test, filepath.Join(fixture.root, ".kube/restricted-cluster"))
			}
			for _, call := range fixture.calls() {
				require.Equal(test, "kind", call.Command)
				require.Equal(test, []string{"get", "clusters"}, call.Args)
			}
		})
	}
}

func TestClusterDeletionFailurePreservesCredentials(test *testing.T) {
	for _, scenario := range []struct {
		script     string
		cluster    string
		kubeconfig string
	}{
		{"clusters.sh", "dev-cluster", "dev-stg-clusters"},
		{"restricted.sh", "restricted-cluster", "restricted-cluster-admin"},
	} {
		test.Run(scenario.script, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.write("cluster-"+scenario.cluster, "")
			fixture.write(".kube/"+scenario.kubeconfig, "cluster credentials")
			fixture.write("fail-delete", "")
			require.Error(test, fixture.run(scenario.script, "stop"))
			content, err := os.ReadFile(filepath.Join(fixture.root, ".kube", scenario.kubeconfig))
			require.NoError(test, err)
			require.Equal(test, "cluster credentials", string(content))
			require.FileExists(test, filepath.Join(fixture.root, "cluster-"+scenario.cluster))
		})
	}
}

func TestNamespaceManifestsStayOnTheirSourceCluster(test *testing.T) {
	for _, scenario := range []struct {
		script   string
		args     []string
		contexts []string
	}{
		{"workloads.sh", []string{"install", "all", "--stress-ng"}, []string{"dev-cluster", "stg-cluster", "prod-cluster"}},
		{"restricted.sh", []string{"start"}, []string{"restricted-cluster-admin"}},
	} {
		test.Run(scenario.script, func(test *testing.T) {
			fixture := newScriptFixture(test)
			require.NoError(test, fixture.run(scenario.script, scenario.args...))
			generated := map[string]string{}
			applied := map[string]string{}
			contexts := map[string]bool{}
			for _, call := range fixture.calls() {
				context := option(call.Args, "--context")
				kubeconfig := option(call.Args, "--kubeconfig")
				if call.Command == "kubectl" && slices.Contains(call.Args, "create") && slices.Contains(call.Args, "namespace") {
					require.Contains(test, call.Args, "--dry-run=client")
					require.Contains(test, scenario.contexts, context)
					generated[context+"/"+option(call.Args, "namespace")] = kubeconfig
					contexts[context] = true
				}
				if !strings.Contains(call.Input, "kind: Namespace\n") {
					continue
				}
				var namespace struct{ Metadata struct{ Name string } }
				require.NoError(test, yaml.Unmarshal([]byte(call.Input), &namespace))
				applied[context+"/"+namespace.Metadata.Name] = kubeconfig
			}
			require.Len(test, contexts, len(scenario.contexts))
			require.Equal(test, generated, applied)
		})
	}
}

func TestNamespaceGenerationFailureAbortsSetup(test *testing.T) {
	for _, scenario := range []struct {
		script string
		args   []string
	}{
		{"workloads.sh", []string{"install", "dev"}},
		{"restricted.sh", []string{"start"}},
	} {
		test.Run(scenario.script, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.write("fail-namespace-create", "")
			require.Error(test, fixture.run(scenario.script, scenario.args...))
			for _, call := range fixture.calls() {
				require.NotContains(test, call.Args, "upgrade")
				require.NotContains(test, call.Args, "serviceaccount")
			}
		})
	}
}

func TestWorkloadsStressIsOptInAndScoped(test *testing.T) {
	for _, enabled := range []bool{false, true} {
		test.Run(strconv.FormatBool(enabled), func(test *testing.T) {
			fixture := newScriptFixture(test)
			args := []string{"install", "all"}
			if enabled {
				args = append(args, "--stress-ng")
			}
			require.NoError(test, fixture.run("workloads.sh", args...))
			var stressContexts []string
			for _, call := range fixture.calls() {
				if !strings.Contains(call.Input, "name: stress-ng") {
					continue
				}
				var deployment struct {
					Spec struct {
						Template struct {
							Spec struct {
								Containers []struct{ Args []string }
							}
						}
					}
				}
				require.NoError(test, yaml.Unmarshal([]byte(call.Input), &deployment))
				require.Len(test, deployment.Spec.Template.Spec.Containers, 1)
				workers, err := strconv.Atoi(option(deployment.Spec.Template.Spec.Containers[0].Args, "--cpu"))
				require.NoError(test, err)
				require.Positive(test, workers)
				context := option(call.Args, "--context")
				stressContexts = append(stressContexts, context)
				kubeconfig := "dev-stg-clusters"
				if context == "prod-cluster" {
					kubeconfig = "prod-clusters"
				}
				require.Equal(test, filepath.Join(fixture.root, ".kube", kubeconfig), option(call.Args, "--kubeconfig"))
			}
			if enabled {
				require.ElementsMatch(test, []string{"dev-cluster", "stg-cluster", "prod-cluster"}, stressContexts)
			} else {
				require.Empty(test, stressContexts)
				for _, call := range fixture.calls() {
					require.NotContains(test, call.Args, "stress-test")
				}
			}
		})
	}
}

func TestWorkloadUninstallAlwaysRemovesStress(test *testing.T) {
	fixture := newScriptFixture(test)
	require.NoError(test, fixture.run("workloads.sh", "uninstall", "all"))
	var contexts []string
	for _, call := range fixture.calls() {
		if slices.Contains(call.Args, "stress-ng") && slices.Contains(call.Args, "delete") {
			contexts = append(contexts, option(call.Args, "--context"))
		}
	}
	require.ElementsMatch(test, []string{"dev-cluster", "stg-cluster", "prod-cluster"}, contexts)
}

func TestWorkloadAddonsAreOptInAndScoped(test *testing.T) {
	for _, scenario := range []struct {
		name     string
		flags    []string
		releases []string
	}{
		{name: "defaults"},
		{name: "argocd", flags: []string{"--argocd"}, releases: []string{"argocd"}},
		{name: "external-secrets", flags: []string{"--external-secrets-operator"}, releases: []string{"external-secrets"}},
		{name: "cert-manager", flags: []string{"--cert-manager"}, releases: []string{"cert-manager"}},
		{
			name:     "combined-with-stress",
			flags:    []string{"--cert-manager", "--stress-ng", "--argocd", "--external-secrets-operator", "--argocd"},
			releases: []string{"argocd", "external-secrets", "cert-manager"},
		},
	} {
		test.Run(scenario.name, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.shell = "/bin/bash"
			require.NoError(test, fixture.run("workloads.sh", append([]string{"install", "all"}, scenario.flags...)...))
			for release, chart := range map[string]string{
				"argocd":           "argo/argo-cd",
				"external-secrets": "external-secrets/external-secrets",
				"cert-manager":     "jetstack/cert-manager",
			} {
				var contexts []string
				for _, call := range fixture.calls() {
					if call.Command != "helm" || option(call.Args, "--install") != release {
						continue
					}
					require.Contains(test, call.Args, chart)
					require.Contains(test, call.Args, "upgrade")
					require.Contains(test, call.Args, "--create-namespace")
					require.Equal(test, release, option(call.Args, "--namespace"))
					if release == "cert-manager" {
						require.Equal(test, "crds.enabled=true", option(call.Args, "--set"))
					} else {
						require.NotContains(test, call.Args, "--set")
					}
					context := option(call.Args, "--kube-context")
					contexts = append(contexts, context)
					kubeconfig := "dev-stg-clusters"
					if context == "prod-cluster" {
						kubeconfig = "prod-clusters"
					}
					require.Equal(test, filepath.Join(fixture.root, ".kube", kubeconfig), option(call.Args, "--kubeconfig"))
				}
				if slices.Contains(scenario.releases, release) {
					require.ElementsMatch(test, []string{"dev-cluster", "stg-cluster", "prod-cluster"}, contexts)
				} else {
					require.Empty(test, contexts)
				}
			}
			var repositories []string
			for _, call := range fixture.calls() {
				if call.Command == "helm" && slices.Contains(call.Args, "repo") {
					repositories = append(repositories, option(call.Args, "add"))
				}
			}
			for release, repository := range map[string]string{"argocd": "argo", "external-secrets": "external-secrets", "cert-manager": "jetstack"} {
				require.Equal(test, slices.Contains(scenario.releases, release), slices.Contains(repositories, repository))
			}
			if slices.Contains(scenario.flags, "--stress-ng") {
				var stressCount int
				for _, call := range fixture.calls() {
					if strings.Contains(call.Input, "name: stress-ng") {
						stressCount++
					}
				}
				require.Equal(test, 3, stressCount)
			}
		})
	}
}

func TestWorkloadUninstallRemovesAddonReleasesBeforeNamespaces(test *testing.T) {
	fixture := newScriptFixture(test)
	require.NoError(test, fixture.run("workloads.sh", "uninstall", "all"))
	for _, release := range []string{"argocd", "external-secrets", "cert-manager"} {
		var removedContexts []string
		var deletedNamespaces []string
		for _, call := range fixture.calls() {
			if call.Command == "helm" && option(call.Args, "uninstall") == release {
				require.Equal(test, release, option(call.Args, "--namespace"))
				require.Contains(test, call.Args, "--ignore-not-found")
				removedContexts = append(removedContexts, option(call.Args, "--kube-context"))
			}
			if call.Command == "kubectl" && slices.Contains(call.Args, "delete") && option(call.Args, "namespace") == release {
				require.Contains(test, removedContexts, option(call.Args, "--context"))
				deletedNamespaces = append(deletedNamespaces, option(call.Args, "--context"))
			}
		}
		require.ElementsMatch(test, []string{"dev-cluster", "stg-cluster", "prod-cluster"}, removedContexts)
		require.ElementsMatch(test, removedContexts, deletedNamespaces)
	}
}

func TestWorkloadAddonHelmFailuresAbort(test *testing.T) {
	for _, action := range []string{"install", "uninstall"} {
		test.Run(action, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.write("fail-helm-argocd", "")
			args := []string{action, "dev"}
			if action == "install" {
				args = append(args, "--argocd", "--external-secrets-operator")
			}
			require.Error(test, fixture.run("workloads.sh", args...))
			var attemptedArgocd bool
			for _, call := range fixture.calls() {
				if call.Command == "helm" && slices.Contains(call.Args, "argocd") {
					attemptedArgocd = true
				}
				require.NotContains(test, call.Args, "external-secrets/external-secrets")
				if call.Command == "kubectl" && slices.Contains(call.Args, "delete") {
					require.NotContains(test, call.Args, "argocd")
				}
			}
			require.True(test, attemptedArgocd)
		})
	}
}

func TestWorkloadsRejectInvalidArgumentsBeforeChanges(test *testing.T) {
	for _, args := range [][]string{
		{"install", "dev", "--unknown"},
		{"install", "dev", "unexpected"},
		{"uninstall", "dev", "--stress-ng"},
		{"uninstall", "dev", "--argocd"},
		{"install", "dev", "--cert-manager", "--unknown"},
	} {
		test.Run(strings.Join(args, " "), func(test *testing.T) {
			fixture := newScriptFixture(test)
			require.Error(test, fixture.run("workloads.sh", args...))
			require.Empty(test, fixture.calls())
		})
	}
}

func TestRestrictedNamespaceDiscoveryFailureAbortsSetup(test *testing.T) {
	fixture := newScriptFixture(test)
	fixture.write("fail-namespaces", "")
	require.Error(test, fixture.run("restricted.sh", "start"))
	for _, call := range fixture.calls() {
		if slices.Contains(call.Args, "create") {
			require.NotContains(test, call.Args, "rolebinding")
		}
		require.NotContains(test, call.Args, "token")
	}
}

func TestScriptsSupportSystemBash(test *testing.T) {
	for _, script := range []string{"clusters.sh", "workloads.sh"} {
		test.Run(script, func(test *testing.T) {
			fixture := newScriptFixture(test)
			fixture.shell = "/bin/bash"
			args := []string{"start"}
			if script == "workloads.sh" {
				args = []string{"install", "dev"}
			}
			require.NoError(test, fixture.run(script, args...))
		})
	}
}

func TestRestrictedSetupBindsOnlyManagedNamespaces(test *testing.T) {
	fixture := newScriptFixture(test)
	require.NoError(test, fixture.run("restricted.sh", "start"))
	var namespaces []string
	for _, call := range fixture.calls() {
		if slices.Contains(call.Args, "create") && slices.Contains(call.Args, "rolebinding") {
			namespaces = append(namespaces, option(call.Args, "-n"))
			require.Equal(test, "restricted-cluster-admin", option(call.Args, "--context"))
		}
	}
	require.ElementsMatch(test, []string{"kube-system", "test-managed", "test-team"}, namespaces)
}

func TestKindCLIHelper(test *testing.T) {
	root := os.Getenv("LY_KIND_TEST_ROOT")
	if root == "" {
		return
	}
	separator := slices.Index(os.Args, "--")
	call := cliCall{Command: os.Args[separator+1], Args: os.Args[separator+2:]}
	if slices.Contains(call.Args, "apply") && option(call.Args, "-f") == "-" {
		input, err := io.ReadAll(os.Stdin)
		require.NoError(test, err)
		call.Input = string(input)
	}
	log, err := os.OpenFile(filepath.Join(root, "calls"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	require.NoError(test, err)
	require.NoError(test, json.NewEncoder(log).Encode(call))
	require.NoError(test, log.Close())
	if err := handleCLI(root, call); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func option(args []string, name string) string {
	index := slices.Index(args, name)
	if index >= 0 && index+1 < len(args) {
		return args[index+1]
	}
	return ""
}

func handleCLI(root string, call cliCall) error {
	if call.Command == "kind" {
		return handleKind(root, call.Args)
	}
	if call.Command == "helm" && slices.Contains(call.Args, "argocd") {
		if _, err := os.Stat(filepath.Join(root, "fail-helm-argocd")); err == nil {
			return fmt.Errorf("injected Argo CD Helm failure")
		}
	}
	if call.Command != "kubectl" {
		return nil
	}
	args := call.Args
	if slices.Contains(args, "config") {
		return handleKubeconfig(args)
	}
	if slices.Contains(args, "create") && slices.Contains(args, "namespace") {
		if _, err := os.Stat(filepath.Join(root, "fail-namespace-create")); err == nil {
			return fmt.Errorf("injected namespace generation failure")
		}
		fmt.Printf("apiVersion: v1\nkind: Namespace\nmetadata:\n  name: %s\n", option(args, "namespace"))
	}
	if slices.Contains(args, "apply") && strings.HasPrefix(option(args, "-f"), "https://") {
		if _, err := os.Stat(filepath.Join(root, "fail-metrics")); err == nil {
			return fmt.Errorf("injected metrics failure")
		}
	}
	if slices.Contains(args, "get") && slices.Contains(args, "namespaces") {
		if _, err := os.Stat(filepath.Join(root, "fail-namespaces")); err == nil {
			return fmt.Errorf("injected namespace listing failure")
		}
		fmt.Print("default\nkube-system\ntest-managed\ntest-team\n")
	}
	if slices.Contains(args, "can-i") && (slices.Contains(args, "namespaces") || option(args, "-n") == "default") {
		return fmt.Errorf("permission denied")
	}
	return nil
}

func handleKind(root string, args []string) error {
	if args[0] == "get" {
		if _, err := os.Stat(filepath.Join(root, "fail-clusters")); err == nil {
			return fmt.Errorf("injected cluster discovery failure")
		}
		clusters, err := filepath.Glob(filepath.Join(root, "cluster-*"))
		if err != nil {
			return err
		}
		for _, cluster := range clusters {
			fmt.Println(strings.TrimPrefix(filepath.Base(cluster), "cluster-"))
		}
		return nil
	}
	name := option(args, "--name")
	marker := filepath.Join(root, "cluster-"+name)
	if args[0] == "delete" {
		if _, err := os.Stat(filepath.Join(root, "fail-delete")); err == nil {
			return fmt.Errorf("injected cluster deletion failure")
		}
		return os.Remove(marker)
	}
	if err := os.WriteFile(marker, nil, 0o600); err != nil {
		return err
	}
	config := option(args, "--kubeconfig")
	contexts, _ := os.ReadFile(config)
	context := "kind-" + name
	if !slices.Contains(strings.Fields(string(contexts)), context) {
		contexts = append(contexts, []byte(context+"\n")...)
	}
	return os.WriteFile(config, contexts, 0o600)
}

func handleKubeconfig(args []string) error {
	path := option(args, "--kubeconfig")
	content, _ := os.ReadFile(path)
	contexts := strings.Fields(string(content))
	if slices.Contains(args, "get-contexts") {
		fmt.Print(string(content))
		return nil
	}
	if slices.Contains(args, "delete-context") {
		name := option(args, "delete-context")
		contexts = slices.DeleteFunc(contexts, func(context string) bool { return context == name })
	}
	if slices.Contains(args, "rename-context") {
		previous, next := args[len(args)-2], args[len(args)-1]
		if slices.Contains(contexts, next) {
			return fmt.Errorf("context already exists: %s", next)
		}
		index := slices.Index(contexts, previous)
		if index < 0 {
			return fmt.Errorf("context not found: %s", previous)
		}
		contexts[index] = next
	}
	if slices.Contains(args, "set-context") {
		contexts = append(contexts, option(args, "set-context"))
	}
	return os.WriteFile(path, []byte(strings.Join(contexts, "\n")+"\n"), 0o600)
}
