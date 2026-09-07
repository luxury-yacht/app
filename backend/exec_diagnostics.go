package backend

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/credentialerrors"
	"k8s.io/client-go/rest"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

const execDiagnosticFileEnv = "LUXURY_YACHT_EXEC_DIAGNOSTIC_FILE"

// client-go drops helper stderr from returned errors. Each cluster gets a
// private result file shared with its helper wrapper; only a diagnostic kind,
// never provider output or credentials, crosses this boundary.
type execDiagnosticStore struct {
	mu        sync.Mutex
	directory string
	closed    bool
}

func (s *execDiagnosticStore) prepare(clusterID string, config *rest.Config) error {
	if config.ExecProvider == nil {
		return nil
	}
	// Keep client-go's command policy intact. Rewriting an allowlisted command
	// would change what client-go checks; restricted policies remain unwrapped.
	policy := config.ExecProvider.PluginPolicy.PolicyType
	if policy != "" && policy != clientcmdapi.PluginPolicyAllowAll {
		return nil
	}
	if clusterID == "" {
		return fmt.Errorf("credential diagnostics require cluster identity")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	path, err := s.pathForCluster(clusterID)
	if err != nil {
		return err
	}
	provider := config.ExecProvider.DeepCopy()
	if !isExecWrapperConfigured(provider.Args) {
		provider.Args = append([]string{execWrapperFlag, provider.Command}, provider.Args...)
		provider.Command = executable
	}
	provider.Env = append(provider.Env, clientcmdapi.ExecEnvVar{Name: execDiagnosticFileEnv, Value: path})
	config.ExecProvider = provider
	return nil
}

func (s *execDiagnosticStore) pathForCluster(clusterID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return "", fmt.Errorf("credential diagnostic store is closed")
	}
	if s.directory == "" {
		directory, err := os.MkdirTemp("", "luxury-yacht-exec-diagnostics-")
		if err != nil {
			return "", err
		}
		s.directory = directory
	}
	path := filepath.Join(s.directory, fmt.Sprintf("%x", sha256.Sum256([]byte(clusterID))))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	return path, file.Close()
}

func (s *execDiagnosticStore) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.directory != "" {
		_ = os.RemoveAll(s.directory)
		s.directory = ""
	}
}

func classifyClusterCredentialError(err error, config *rest.Config) credentialerrors.Diagnostic {
	ctx := credentialerrors.Context{ExecCommand: execDisplayCommand(config)}
	diagnostic := credentialerrors.Classify(err, ctx)
	if diagnostic.Kind != credentialerrors.KindHelperFailed || config == nil || config.ExecProvider == nil {
		return diagnostic
	}
	for _, env := range config.ExecProvider.Env {
		if env.Name != execDiagnosticFileEnv {
			continue
		}
		file, openErr := os.Open(env.Value)
		if openErr != nil {
			return diagnostic
		}
		data, readErr := io.ReadAll(io.LimitReader(file, 64))
		_ = file.Close()
		if readErr == nil {
			if detail := credentialerrors.ForKind(credentialerrors.Kind(data), ctx); detail.IsAuth() {
				return detail
			}
		}
	}
	return diagnostic
}

// diagnosticStderr retains a bounded tail while the original stderr stream is
// forwarded unchanged. Credential stdout never enters this buffer.
type diagnosticStderr struct{ tail []byte }

func (b *diagnosticStderr) Write(data []byte) (int, error) {
	const limit = 64 * 1024
	length := len(data)
	if length >= limit {
		b.tail = append(b.tail[:0], data[length-limit:]...)
		return length, nil
	}
	b.tail = append(b.tail, data...)
	if len(b.tail) > limit {
		b.tail = b.tail[len(b.tail)-limit:]
	}
	return length, nil
}

func (b *diagnosticStderr) publish(path string, err error) {
	if path == "" {
		return
	}
	kind := credentialerrors.KindNone
	if err != nil {
		kind = helperFailureKind(err, b.tail)
	}
	// The parent creates the file. A helper finishing after shutdown cannot
	// recreate a removed diagnostic store.
	file, openErr := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	if openErr != nil {
		return
	}
	_, _ = file.WriteString(string(kind))
	_ = file.Close()
}

func helperFailureKind(err error, stderr []byte) credentialerrors.Kind {
	diagnostic := credentialerrors.Classify(fmt.Errorf("exec plugin failed: %w: %s", err, strings.TrimSpace(string(stderr))), credentialerrors.Context{})
	var exited *exec.ExitError
	if diagnostic.Kind == credentialerrors.KindMissingHelper && errors.As(err, &exited) {
		// An exit status proves the executable ran. Its own missing input or
		// cache file must never turn into installation advice for that helper.
		return credentialerrors.KindHelperFailed
	}
	return diagnostic.Kind
}
