package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// taskCommands returns a task's shell lines and task references in order.
func taskCommands(t *testing.T, taskfilePath, task string) []string {
	t.Helper()
	var taskfile struct {
		Tasks map[string]struct {
			Cmds []yaml.Node `yaml:"cmds"`
		} `yaml:"tasks"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readTestFile(t, taskfilePath)), &taskfile))
	definition, found := taskfile.Tasks[task]
	require.True(t, found, task)

	commands := make([]string, 0, len(definition.Cmds))
	for _, node := range definition.Cmds {
		if node.Kind == yaml.ScalarNode {
			commands = append(commands, node.Value)
			continue
		}
		var reference struct {
			Task string `yaml:"task"`
		}
		require.NoError(t, node.Decode(&reference))
		commands = append(commands, "task: "+reference.Task)
	}
	return commands
}

func darwinTaskCommands(t *testing.T, task string) []string {
	t.Helper()
	return taskCommands(t, repositoryPath("build", "darwin", "Taskfile.yml"), task)
}

func requireCommandsInOrder(t *testing.T, commands []string, wanted ...string) {
	t.Helper()
	next := 0
	for _, want := range wanted {
		found := false
		for next < len(commands) && !found {
			found = strings.Contains(commands[next], want)
			next++
		}
		require.Truef(t, found, "%q is missing or out of order in:\n%s", want, strings.Join(commands, "\n"))
	}
}

// A reused bundle keeps resources a rebuild no longer produces, and Finder
// metadata from a synced folder makes codesign reject it, so each bundle starts
// empty and is verified before anything runs or packages it.
func TestDarwinBundlesStartCleanAndVerifyTheirSignature(t *testing.T) {
	const prepareOutput = `wails3 tool prepare-macos-output --dir "{{.BIN_DIR}}"`

	bundle := `"{{.BIN_DIR}}/{{.APP_PRODUCT_NAME}}.app"`
	packaged := append(darwinTaskCommands(t, "create:app:bundle"), darwinTaskCommands(t, "codesign:adhoc")...)
	requireCommandsInOrder(t, packaged,
		`rm -rf -- `+bundle,
		`{{.APP_PRODUCT_NAME}}.app/Contents/MacOS"`,
		`xattr -cr `+bundle,
		`codesign --force --deep --sign - `+bundle,
		`codesign --verify --deep --strict `+bundle,
	)

	devBundle := `"{{.BIN_DIR}}/{{.APP_PRODUCT_NAME}}.dev.app"`
	requireCommandsInOrder(t, darwinTaskCommands(t, "run"),
		prepareOutput,
		`rm -rf -- `+devBundle,
		`{{.APP_PRODUCT_NAME}}.dev.app/Contents/MacOS"`,
		`xattr -cr `+devBundle,
		`codesign --force --deep --sign - `+devBundle,
		`codesign --verify --deep --strict `+devBundle,
		`.dev.app/Contents/MacOS/{{.APP_NAME}}"`,
	)

	requireCommandsInOrder(t, darwinTaskCommands(t, "build:native"), prepareOutput, `-o "{{.OUTPUT}}"`)
}

// prepare-macos-output moves bin out of a file-provider folder and links it
// back. The `bin/` pattern only matches a directory, so without a separate
// entry the link shows up as untracked and can be committed.
func TestRelocatedMacOSOutputLinkIsIgnored(t *testing.T) {
	root := t.TempDir()
	gitignore := readTestFile(t, repositoryPath(".gitignore"))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".gitignore"), []byte(gitignore), 0o600))
	require.NoError(t, os.Symlink(t.TempDir(), filepath.Join(root, "bin")))

	initialize := exec.Command("git", "init", "--quiet")
	initialize.Dir = root
	require.NoError(t, initialize.Run())

	checkIgnore := exec.Command("git", "check-ignore", "--quiet", "--no-index", "bin")
	checkIgnore.Dir = root
	require.NoError(t, checkIgnore.Run(), "git must ignore a bin symlink")
}
