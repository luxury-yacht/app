# In-Cluster Web Mode Design

## Overview

Add a web application mode to Luxury Yacht so it can run in-cluster as a multi-cluster Kubernetes web portal, in addition to its existing Wails desktop app mode. Both modes share a single codebase with separate build targets.

## Requirements

- Multi-cluster web portal — full desktop experience in the browser
- Pluggable auth providers — token/cert/OIDC built-in, cloud plugins (EKS/AKS/GKE) later
- Single-tenant first, architected for multi-tenant later
- Shared core codebase, separate build targets via Go build tags
- v1 feature parity for shell exec and HTTP port forwarding; raw TCP tunneling in a later phase
- Multi-pod HA for API/SSE/UI pods with no sticky sessions; session pod is singleton in v1

## Architecture Decisions

| Decision        | Choice                                         | Rationale                                                |
| --------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Backend API     | REST + WebSocket                               | Natural extension of existing HTTP refresh API pattern   |
| Build strategy  | Go build tags, separate entrypoints            | Server binary has zero Wails/CGo dependency              |
| Persistence     | CRDs + Secrets in home cluster                 | Kubernetes-native, no external database                  |
| User auth       | Per-user stateless JWT per-request             | No shared session store needed across pods               |
| Cluster auth    | Pluggable provider interface                   | Extensible to cloud-specific providers                   |
| Multi-pod       | Stateless main pods + singleton session pod (v1) | API path scales horizontally without sticky sessions     |
| Port forwarding | HTTP proxy (v1), WebSocket TCP tunnel (future) | HTTP proxy covers majority of use cases                  |
| Authorization   | K8s RBAC via user impersonation                | No app-level authz logic, leverages standard K8s tooling |

## Project Structure

```
app/
├── cmd/
│   ├── desktop/
│   │   └── main.go              # Wails bootstrap (build tag: desktop)
│   └── server/
│       └── main.go              # HTTP server, no CGo (build tag: server)
│
├── backend/
│   ├── core/                     # Extracted business logic
│   │   ├── core.go               # Core struct — owns cluster clients, catalog, settings
│   │   ├── clusters.go           # Add/remove/list clusters
│   │   ├── resources.go          # CRUD operations on K8s resources
│   │   ├── shell.go              # Exec session management
│   │   └── portforward.go        # Port forward session management
│   │
│   ├── wails/                    # Wails-specific wrapper (build tag: desktop)
│   │   └── app.go                # Current App struct, delegates to core
│   │
│   ├── server/                   # HTTP server wrapper (build tag: server)
│   │   ├── server.go             # Router, middleware, startup
│   │   ├── routes.go             # REST route definitions
│   │   ├── handlers/             # HTTP handlers that call core
│   │   ├── middleware/            # Auth, session, logging
│   │   └── ws/                   # WebSocket handlers (shell, port-forward)
│   │
│   ├── store/                    # Persistence abstraction
│   │   ├── store.go              # Store interface
│   │   ├── filestore/            # Filesystem implementation (desktop)
│   │   └── crdstore/             # CRD implementation (server)
│   │
│   ├── auth/                     # Pluggable auth providers
│   │   ├── provider.go           # Provider interface
│   │   ├── token/                # Static bearer token
│   │   ├── certificate/          # Client cert + key
│   │   ├── oidc/                 # OIDC token exchange
│   │   └── incluster/            # Pod ServiceAccount token
│   │
│   ├── refresh/                  # Existing — unchanged
│   ├── objectcatalog/            # Existing — unchanged
│   └── ...
│
├── frontend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── transport/        # Transport abstraction
│   │   │   │   ├── interface.ts  # Transport interface
│   │   │   │   ├── wails.ts      # Wails binding transport
│   │   │   │   └── http.ts       # REST/fetch transport
│   │   │   └── ...
│   │   └── ...
│   └── ...
```

## Build Targets

```bash
# Desktop (macOS, Windows, Linux) — requires CGo + platform GUI libs
go build -tags desktop ./cmd/desktop

# Server (Linux only) — pure Go, static binary, no CGo
CGO_ENABLED=0 GOOS=linux go build -tags server ./cmd/server
```

### Server binary flags

- `--mode=full` — runs REST API + SSE + static files + WebSocket sessions (default)
- `--mode=api` — runs REST API + SSE + static files only (for main deployment pods)
- `--mode=sessions` — runs WebSocket shell + port-forward handlers only (for singleton session pod)
- `--in-cluster` — use pod ServiceAccount token, discover API server from environment
- `--kubeconfig <path>` — use kubeconfig file (for running server outside a cluster)
- `--port <n>` — HTTP listen port (default 8080)

## Transport Abstraction (Frontend)

The frontend calls the backend two ways today:

1. **Wails bindings** — `window.go.backend.App.Foo()` for RPC-style calls
2. **HTTP fetch** — `fetch('/api/v2/snapshots/...')` for the refresh system

The refresh system stays as-is. Wails binding calls are replaced with a transport abstraction.

### Transport interface

```typescript
interface Transport {
  // Cluster management
  getKubeconfigs(): Promise<KubeconfigInfo[]>;
  setSelectedKubeconfigs(paths: string[]): Promise<void>;
  getClusterClients(): Promise<ClusterClient[]>;

  // Resource operations
  // ObjectRef.namespace is optional for cluster-scoped resources.
  getObjectYaml(clusterId: string, ref: ObjectRef): Promise<string>;
  applyObjectYaml(clusterId: string, yaml: string): Promise<ApplyResult>;
  deleteObject(clusterId: string, ref: ObjectRef): Promise<void>;
  restartWorkload(clusterId: string, ref: ObjectRef): Promise<void>;
  scaleWorkload(clusterId: string, ref: ObjectRef, replicas: number): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<Settings>): Promise<void>;

  // Sessions
  openShell(clusterId: string, ref: ObjectRef, container: string): ShellSession;
  openPortForward(clusterId: string, ref: ObjectRef, ports: PortMapping[]): PortForwardSession;

  // ... one method per current Wails binding
}
```

### Mode detection

The frontend detects which mode it's running in at startup. Wails injects `window.go` — if absent, it's web mode. The appropriate transport is provided via React context.

## REST API

All new endpoints under `/api/v1/` (separate from existing `/api/v2/` refresh system).

```
// Cluster management
GET    /api/v1/kubeconfigs
PUT    /api/v1/kubeconfigs/selected
GET    /api/v1/clusters
GET    /api/v1/clusters/:clusterId/status

// Resource operations (namespaced resources)
GET    /api/v1/clusters/:clusterId/namespaces/:namespace/resources/:group/:version/:kind/:name/yaml
PUT    /api/v1/clusters/:clusterId/namespaces/:namespace/resources/:group/:version/:kind/:name/yaml
DELETE /api/v1/clusters/:clusterId/namespaces/:namespace/resources/:group/:version/:kind/:name
POST   /api/v1/clusters/:clusterId/namespaces/:namespace/resources/:group/:version/:kind/:name/restart
POST   /api/v1/clusters/:clusterId/namespaces/:namespace/resources/:group/:version/:kind/:name/scale

// Resource operations (cluster-scoped resources)
GET    /api/v1/clusters/:clusterId/cluster-resources/:group/:version/:kind/:name/yaml
PUT    /api/v1/clusters/:clusterId/cluster-resources/:group/:version/:kind/:name/yaml
DELETE /api/v1/clusters/:clusterId/cluster-resources/:group/:version/:kind/:name

// Settings
GET    /api/v1/settings
PATCH  /api/v1/settings

// Themes
GET    /api/v1/themes
POST   /api/v1/themes
PUT    /api/v1/themes/:id
DELETE /api/v1/themes/:id

// User management (server mode only)
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:id
PUT    /api/v1/users/:id
DELETE /api/v1/users/:id

// Group management (server mode only)
GET    /api/v1/groups
POST   /api/v1/groups
GET    /api/v1/groups/:id
PUT    /api/v1/groups/:id
DELETE /api/v1/groups/:id
```

### Refresh system integration

In server mode, the existing refresh HTTP routes are mounted directly on the main server's mux under their existing `/api/v2/` prefix — no separate localhost server needed.

### Handler pattern

Every handler is thin — parse request, call `core`, serialize response:

```go
func (h *Handler) GetObjectYaml(w http.ResponseWriter, r *http.Request) {
    clusterId := chi.URLParam(r, "clusterId")
    ref := parseObjectRef(r)
    yaml, err := h.core.GetObjectYaml(clusterId, ref)
    if err != nil {
        writeError(w, err)
        return
    }
    writeJSON(w, yaml)
}
```

## Authentication

### User authentication (web UI login)

**v1 — Per-user JWT:** Each app user gets a signed JWT that includes subject (`sub`) and group claims. Every request is authenticated by validating the JWT signature and claims. This preserves stateless multi-pod operation and provides a concrete user identity for impersonation.

**Future — OIDC:** Configure an OIDC issuer, the app validates JWTs. Self-validating tokens mean any pod can verify without shared state.

### Cluster authentication (pluggable providers)

```go
type Provider interface {
    Name() string
    Configure(cfg ClusterAuthConfig) error
    GetTransportConfig() (*rest.Config, error)
    SupportsRefresh() bool
    Refresh(ctx context.Context) error
}
```

**Built-in providers (v1):**

| Provider      | How it works                       | Use case                         |
| ------------- | ---------------------------------- | -------------------------------- |
| `token`       | Static bearer token from config    | Local clusters, service accounts |
| `certificate` | Client cert + key from config      | Clusters using x509 auth         |
| `oidc`        | OIDC token exchange + refresh      | Enterprise clusters with OIDC    |
| `in-cluster`  | Pod's mounted ServiceAccount token | The home cluster itself          |

**Future plugin providers:**

| Provider | How it works                                      |
| -------- | ------------------------------------------------- |
| `eks`    | AWS SDK — `sts:GetCallerIdentity` presigned token |
| `aks`    | Azure SDK — AAD token exchange                    |
| `gke`    | GCP SDK — Google token exchange                   |

### Cluster configuration

- Home cluster auto-discovered via in-cluster config at startup
- Additional clusters added through the web UI (API server URL + auth provider + config)
- Cluster config persisted as `LuxuryYachtCluster` CRD
- Credentials stored in referenced Kubernetes Secrets

## Authorization

Authorization uses Kubernetes RBAC via user impersonation. The app manages its own users and groups, maps them to Kubernetes identities, and lets the Kubernetes API server enforce all permission decisions.

### How it works

1. **App manages users and groups** — stored as CRDs (`LuxuryYachtUser`, `LuxuryYachtGroup`)
2. **K8s RBAC defines permissions** — standard ClusterRoles/Roles (e.g., `view`, `edit`, `cluster-admin`, or custom roles)
3. **App maps users to K8s identities** — each app user/group gets a prefixed K8s identity (e.g., `luxury-yacht:alice`, `luxury-yacht:developers`)
4. **App impersonates on every K8s API call** — using Kubernetes [user impersonation](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#user-impersonation) headers

### Request flow

```
Alice (browser) → REST API → App backend
  → Looks up Alice's groups: ["developers"]
  → K8s API call with headers:
      Impersonate-User: luxury-yacht:alice
      Impersonate-Group: luxury-yacht:developers
  → K8s RBAC evaluates permissions for luxury-yacht:alice / luxury-yacht:developers
  → Allowed or denied
```

### K8s RBAC setup (by cluster admin)

The app admin creates standard Kubernetes RoleBindings/ClusterRoleBindings that bind app user/group identities to K8s roles:

```yaml
# Developers can edit in all namespaces
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: luxury-yacht-developers
subjects:
- kind: Group
  name: luxury-yacht:developers
roleRef:
  kind: ClusterRole
  name: edit

# Viewers are read-only
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: luxury-yacht-viewers
subjects:
- kind: Group
  name: luxury-yacht:viewers
roleRef:
  kind: ClusterRole
  name: view
```

### ServiceAccount impersonation permission

The app's ServiceAccount needs permission to impersonate users and groups used by the app.

Kubernetes RBAC does not support prefix wildcards in `resourceNames`; names must be explicit. The app reconciles this ClusterRole from `LuxuryYachtUser`/`LuxuryYachtGroup` objects.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: luxury-yacht-impersonator
rules:
  - apiGroups: ['']
    resources: ['users', 'groups']
    verbs: ['impersonate']
    resourceNames:
      - luxury-yacht:alice
      - luxury-yacht:bob
      - luxury-yacht:developers
      - luxury-yacht:viewers
```

### Per-cluster granularity

Each target cluster has its own RBAC bindings. The app impersonates the same user identity on every cluster, but permissions differ based on that cluster's bindings. This means Alice can be an admin on the dev cluster but read-only on prod — configured entirely through standard K8s RBAC, not in the app.

### Why this model

- **No authz logic in the app** — the app never decides "can Alice delete this pod?" It impersonates Alice and lets K8s decide.
- **Standard K8s tooling** — admins use familiar ClusterRoles, Roles, and RoleBindings.
- **Audit trail** — K8s audit logs show the impersonated user, so you know who did what.
- **Identity isolation** — the `luxury-yacht:` prefix prevents collisions with real cluster users.

### Desktop mode

Desktop mode does not use impersonation. The user's kubeconfig credentials are used directly, as they are today.

## Shell Exec & Port Forwarding

### Shell exec over WebSocket

```
Browser (xterm.js)
    ↕ WebSocket
Session pod (/api/v1/clusters/:clusterId/shell/:ns/:pod/:container)
    ↕ SPDY
Kubernetes API Server → container exec
```

**WebSocket message protocol:**

- `0x00` + bytes → stdin (browser → server → container)
- `0x01` + bytes → stdout (container → server → browser)
- `0x02` + bytes → stderr (container → server → browser)
- `0x03` + JSON → resize event `{"width": 120, "height": 40}`

Server uses `client-go`'s `remotecommand.NewSPDYExecutor` to open exec streams, then pipes frames between the WebSocket and SPDY streams.

### Port forwarding via HTTP proxy (v1)

- User requests a port-forward through the UI
- Session pod starts a `client-go` `portforward` tunnel to the pod
- Allocates a proxied route: `/api/v1/clusters/:clusterId/portforward/:ns/:pod/:port/*`
- Browser accesses the forwarded service through that route
- Works for HTTP services (dashboards, web UIs, APIs)

**Future:** WebSocket TCP tunnel for raw TCP protocols (databases, Redis). Requires a client-side helper to bind a local port.

### Session lifecycle

- Tracked by session ID on the session pod
- Idle timeout: 15 minutes (shell), 30 minutes (port-forward), configurable
- Cleaned up on WebSocket disconnect
- Maximum concurrent sessions limit per user

## Deployment Architecture

### Two-component deployment

| Component               | Replicas | Stateful?       | Handles                             |
| ----------------------- | -------- | --------------- | ----------------------------------- |
| `luxury-yacht`          | 2+       | No              | REST API, SSE streams, static files |
| `luxury-yacht-sessions` | 1        | Yes (ephemeral) | Shell exec, port-forward WebSocket  |

### Ingress routing (path-based, no sticky sessions)

```
app.example.com/api/v1/clusters/:clusterId/shell/*       → luxury-yacht-sessions service
app.example.com/api/v1/clusters/:clusterId/portforward/* → luxury-yacht-sessions service
app.example.com/*                                  → luxury-yacht service (round-robin)
```

### Container image

```dockerfile
FROM golang:1.23 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -tags server -o /luxury-yacht ./cmd/server

FROM scratch
COPY --from=builder /luxury-yacht /luxury-yacht
COPY --from=builder /app/frontend/dist /static
ENTRYPOINT ["/luxury-yacht"]
```

### Helm chart contents

- CRD definitions (`LuxuryYachtUser`, `LuxuryYachtGroup`, `LuxuryYachtCluster`, `LuxuryYachtTheme`)
- Deployment for main pods (`luxury-yacht`, replicas: 2)
- Deployment for session pod (`luxury-yacht-sessions`, replicas: 1, strategy: Recreate)
- Services for both components
- ServiceAccount + RBAC (CRD access, Secret access in own namespace)
- Ingress with path-based routing
- ConfigMap for server configuration
- PodDisruptionBudget (minAvailable: 1 for main pods)

### RBAC

**Home cluster (own namespace):**

- Full CRUD on `luxuryyacht.io` custom resources
- Create/read/update/delete Secrets in own namespace
- Impersonate explicitly listed app users/groups (ClusterRole reconciled from `LuxuryYachtUser`/`LuxuryYachtGroup`)

**Target clusters:**

- Impersonate explicitly listed app users/groups (requires ClusterRole on each target cluster)
- All other permissions are determined by the impersonated user's RBAC bindings on that cluster

### Health & observability

- `GET /healthz` — liveness probe
- `GET /readyz` — readiness probe (at least one cluster connection healthy)
- Structured JSON logging to stdout
- Prometheus `/metrics` endpoint (future)

## Persistence

### Store interface

```go
type Store interface {
    // User management
    GetUser(userId string) (*User, error)
    ListUsers() ([]User, error)
    SaveUser(user User) error
    DeleteUser(userId string) error

    // Group management
    GetGroup(groupId string) (*Group, error)
    ListGroups() ([]Group, error)
    SaveGroup(group Group) error
    DeleteGroup(groupId string) error

    // User preferences
    GetUserPreferences(userId string) (*Preferences, error)
    SaveUserPreferences(userId string, prefs *Preferences) error

    // Cluster configs
    ListClusterConfigs() ([]ClusterConfig, error)
    SaveClusterConfig(cfg ClusterConfig) error
    DeleteClusterConfig(id string) error

    // Themes
    ListThemes() ([]Theme, error)
    SaveTheme(theme Theme) error
    DeleteTheme(id string) error
}
```

- Desktop mode: `FileStore` — filesystem persistence as today, unchanged
- Server mode: `CRDStore` — reads/writes Kubernetes CRDs and Secrets

### CRD definitions

- `LuxuryYachtUser` — user profiles, preferences, and group memberships
- `LuxuryYachtGroup` — group definitions (mapped to K8s impersonation group identities)
- `LuxuryYachtCluster` — cluster connection configurations (references a Secret for credentials)
- `LuxuryYachtTheme` — saved themes

## Migration Path

Each phase is independently shippable. The desktop app never breaks.

### Phase 1 — Extract core (desktop-only refactor)

- Extract business logic from `backend/app.go` into `backend/core/`
- Wails `App` struct becomes a thin wrapper delegating to `core`
- All existing tests pass against `core`
- Desktop app works identically

### Phase 2 — Transport abstraction (desktop-only refactor)

- Introduce `Transport` interface on the frontend
- Implement `WailsTransport` wrapping existing bindings
- Replace all direct Wails binding calls with `transport.foo()`
- Desktop app works identically

### Phase 3 — Server entrypoint + REST API

- Add `cmd/server/main.go` and `backend/server/`
- Implement `HttpTransport` on the frontend
- REST handlers calling `core`
- CRD-based persistence (`CRDStore`)
- Pluggable auth providers (token/certificate/OIDC + in-cluster for v1)
- Web version is functional

### Phase 4 — WebSocket sessions

- Shell exec over WebSocket
- Port-forward HTTP proxy
- Session pod mode (`--mode=sessions`)

### Phase 5 — Deployment

- Helm chart with CRDs, RBAC, Deployments, Services, Ingress
- Container image build in CI
- Dockerfile
- Documentation

## Testing Strategy

| Layer                     | Approach                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `core` package            | Unit tests with mocked K8s clients (fake clientset), 80%+ coverage |
| REST handlers             | HTTP handler tests with `httptest.NewRecorder()`                   |
| Auth providers            | Unit tests per provider, integration test with real token in CI    |
| CRD store                 | Integration tests against `envtest` (embedded API server)          |
| Transport interface       | Frontend unit tests with mocked transport                          |
| WebSocket (shell/portfwd) | Integration tests with real cluster in CI                          |
| End-to-end                | Helm install into kind cluster in CI, smoke tests                  |

## What Doesn't Change

- Desktop app behavior and appearance
- Refresh system (`/api/v2/`)
- Object catalog
- All existing frontend components, views, and hooks
- Frontend build tooling (Vite)
