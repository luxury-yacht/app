package mage

import (
	"os"
	"strings"
	"testing"
)

func TestPreReleaseRunsAgentContextBudget(t *testing.T) {
	source, err := os.ReadFile("../magefile.go")
	if err != nil {
		t.Fatalf("read magefile: %v", err)
	}

	magefile := string(source)
	start := strings.Index(magefile, "func (QC) PreRelease() error")
	if start < 0 {
		t.Fatal("magefile has no QC.PreRelease task")
	}

	preRelease := magefile[start:]
	end := strings.Index(preRelease, "\n}\n")
	if end < 0 {
		t.Fatal("could not locate the end of QC.PreRelease")
	}
	preRelease = preRelease[:end]

	if !strings.Contains(preRelease, "QC.AgentContext") {
		t.Fatal("QC.PreRelease does not run QC.AgentContext")
	}

	agentContextStart := strings.Index(magefile, "func (QC) AgentContext() error")
	if agentContextStart < 0 {
		t.Fatal("magefile has no QC.AgentContext task")
	}
	agentContext := magefile[agentContextStart:]
	agentContextEnd := strings.Index(agentContext, "\n}\n")
	if agentContextEnd < 0 {
		t.Fatal("could not locate the end of QC.AgentContext")
	}
	agentContext = agentContext[:agentContextEnd]

	for _, requiredScript := range []string{
		"check-context-budget_test.sh",
		"check-context-budget.sh",
	} {
		if !strings.Contains(agentContext, requiredScript) {
			t.Fatalf("QC.AgentContext does not run %s", requiredScript)
		}
	}
}
