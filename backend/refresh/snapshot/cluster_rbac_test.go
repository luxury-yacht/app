package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
)

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
		roleLister:    testsupport.NewClusterRoleLister(t, role),
		bindingLister: testsupport.NewClusterRoleBindingLister(t, binding),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterRBACDomainName, snapshot.Domain)
	require.Equal(t, uint64(25), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)

	entries := map[string]ClusterRBACEntry{}
	for _, entry := range payload.Resources {
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
		roleLister:    testsupport.NewClusterRoleLister(t /* none */),
		bindingLister: testsupport.NewClusterRoleBindingLister(t /* none */),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterRBACDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(ClusterRBACSnapshot)
	require.True(t, ok)
	require.Empty(t, payload.Resources)
}
