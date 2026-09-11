package main

import (
	"bytes"
	"strings"
	"testing"
	"text/template"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestDarwinBuildEnablesPrivateInspectorOnlyInDevelopment(t *testing.T) {
	var taskfile struct {
		Tasks map[string]struct {
			Vars map[string]string `yaml:"vars"`
		} `yaml:"tasks"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(readTestFile(t, repositoryPath("build", "darwin", "Taskfile.yml"))), &taskfile))
	flags, err := template.New("build flags").Parse(taskfile.Tasks["build:native"].Vars["BUILD_FLAGS"])
	require.NoError(t, err)
	for _, dev := range []string{"true", "false"} {
		for _, extra := range []string{"", "custom_tag"} {
			t.Run(dev+"/"+extra, func(t *testing.T) {
				var result bytes.Buffer
				require.NoError(t, flags.Execute(&result, map[string]string{
					"DEV": dev, "EXTRA_TAGS": extra, "OBFUSCATED": "false",
				}))
				fields := strings.Fields(result.String())
				var tags []string
				for index, field := range fields {
					if field == "-tags" {
						tags = strings.Split(fields[index+1], ",")
					}
				}
				if dev == "true" {
					require.Contains(t, tags, "private_mac_apis", "dev builds must retain native Inspector opening")
					require.NotContains(t, tags, "production")
				} else {
					require.Contains(t, tags, "production")
					require.NotContains(t, tags, "private_mac_apis", "release builds must not opt in implicitly")
				}
				if extra != "" {
					require.Contains(t, tags, extra)
				}
			})
		}
	}
}
