package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// clusterRBACCollectIndexer resolves the cluster-RBAC stream descriptors to the
// supplied test indexers (nil = kind unavailable).
func clusterRBACCollectIndexer(roleIdx, bindingIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		switch d.Resource {
		case "clusterroles":
			return roleIdx
		case "clusterrolebindings":
			return bindingIdx
		}
		return nil
	}
}

func TestClusterRBACBuilder(t *testing.T) {
	now := time.Now()

	role := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "edit",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
			ResourceVersion:   "20",
		},
		Rules: []rbacv1.PolicyRule{{
			APIGroups: []string{"*"},
			Resources: []string{"*"},
			Verbs:     []string{"*"},
		}},
	}
	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "edit-binding",
			CreationTimestamp: metav1.NewTime(now.Add(-90 * time.Minute)),
			ResourceVersion:   "25",
		},
		RoleRef: rbacv1.RoleRef{
			Kind: "ClusterRole",
			Name: "edit",
		},
		Subjects: []rbacv1.Subject{
			{Kind: "Group", Name: "developers"},
		},
	}

	builder := &ClusterRBACBuilder{
		collectIndexer: clusterRBACCollectIndexer(
			testsupport.NewClusterIndexer(t, role),
			testsupport.NewClusterIndexer(t, binding),
		),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterRBACDomainName, snapshot.Domain)
	require.Equal(t, uint64(25), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"ClusterRole", "ClusterRoleBinding"}, payload.Kinds)

	entries := map[string]ClusterRBACEntry{}
	for _, entry := range payload.Rows {
		entries[entry.Kind+"-"+entry.Name] = entry
		require.NotEmpty(t, entry.Age)
	}

	roleEntry := entries["ClusterRole-"+role.Name]
	require.Contains(t, roleEntry.Details, "Rules: 1")
	require.Equal(t, "CR", roleEntry.TypeAlias)

	bindingEntry := entries["ClusterRoleBinding-"+binding.Name]
	require.Contains(t, bindingEntry.Details, "Subjects: 1")
	require.Equal(t, "CRB", bindingEntry.TypeAlias)
}

func TestClusterRBACBuilderEmpty(t *testing.T) {
	builder := &ClusterRBACBuilder{
		collectIndexer: clusterRBACCollectIndexer(
			testsupport.NewClusterIndexer[rbacv1.ClusterRole](t),
			testsupport.NewClusterIndexer[rbacv1.ClusterRoleBinding](t),
		),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterRBACDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(ClusterRBACSnapshot)
	require.True(t, ok)
	require.Empty(t, payload.Rows)
	require.Empty(t, payload.Kinds)
}

func TestClusterRBACBuilderCapsLargeSnapshots(t *testing.T) {
	roles := make([]*rbacv1.ClusterRole, 0, config.SnapshotClusterRBACEntryLimit+1)
	for i := 0; i < config.SnapshotClusterRBACEntryLimit+1; i++ {
		roles = append(roles, &rbacv1.ClusterRole{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "role-" + time.Unix(int64(i), 0).Format("150405"),
				ResourceVersion: "1",
			},
		})
	}

	builder := &ClusterRBACBuilder{
		collectIndexer: clusterRBACCollectIndexer(testsupport.NewClusterIndexer(t, roles...), nil),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterRBACSnapshot)
	require.Len(t, payload.Rows, config.SnapshotClusterRBACEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotClusterRBACEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "cluster RBAC resources")
}
