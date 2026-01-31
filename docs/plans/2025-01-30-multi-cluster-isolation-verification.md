# Multi-Cluster Isolation - Manual Verification Checklist

**Date:** 2025-01-30
**Status:** Ready for Manual Verification

## Prerequisites

- Two or more Kubernetes clusters configured in kubeconfig
- Ability to invalidate auth for one cluster (e.g., revoke token, rename context temporarily)

## Verification Steps

### 1. Cluster Selection

- [ ] Start app with two clusters configured
- [ ] Verify neither cluster is auto-selected on first launch
- [ ] User must explicitly choose a cluster

### 2. Auth Failure Isolation

- [ ] Select both Cluster A and Cluster B
- [ ] Invalidate auth for Cluster A (e.g., revoke token, edit kubeconfig)
- [ ] Wait for auth failure to be detected
- [ ] **Verify:** Cluster B still loads data normally
- [ ] **Verify:** Cluster A shows auth error in status indicator
- [ ] **Verify:** Cluster A tab is still responsive (not frozen)

### 3. Auth Retry Isolation

- [ ] With Cluster A in auth failed state, click Retry
- [ ] **Verify:** Only Cluster A attempts retry
- [ ] **Verify:** Cluster B data refresh is unaffected during retry
- [ ] Re-authenticate Cluster A externally (fix kubeconfig)
- [ ] Click Retry again
- [ ] **Verify:** Cluster A recovers and shows data

### 4. Status Indicator Per-Cluster

- [ ] Switch to Cluster A tab
- [ ] **Verify:** Status indicator shows Cluster A's status
- [ ] Switch to Cluster B tab
- [ ] **Verify:** Status indicator changes to show Cluster B's status
- [ ] If Cluster A has auth error, indicator should change when switching tabs

### 5. Pods Filter Isolation

- [ ] In Cluster A, apply a pods filter (e.g., show unhealthy only)
- [ ] Switch to Cluster B tab
- [ ] **Verify:** Filter is NOT applied in Cluster B view
- [ ] Switch back to Cluster A
- [ ] **Verify:** Filter is still applied in Cluster A

### 6. Drain Job Isolation

- [ ] In Cluster A, start a node drain operation
- [ ] Switch to Cluster B tab
- [ ] **Verify:** Drain job is NOT visible in Cluster B's drain list
- [ ] Switch back to Cluster A
- [ ] **Verify:** Drain job is visible in Cluster A

### 7. Cluster Removal Resilience

- [ ] With both clusters active, remove Cluster A from selection
- [ ] **Verify:** Cluster B continues working normally
- [ ] **Verify:** HTTP server continues serving Cluster B requests
- [ ] **Verify:** No error notifications about Cluster A after removal

### 8. Heartbeat Isolation

- [ ] Make Cluster A temporarily unreachable (e.g., VPN disconnect)
- [ ] **Verify:** Cluster A shows degraded health
- [ ] **Verify:** Cluster B health is unaffected
- [ ] Restore Cluster A connectivity
- [ ] **Verify:** Cluster A health recovers

## Expected Outcomes

All checks should demonstrate that:

1. **Auth failures are isolated**: A failure in one cluster does not affect other clusters
2. **Status is per-cluster**: The UI reflects the status of the currently active cluster
3. **Data is isolated**: Filters, drain jobs, and other state are per-cluster
4. **Recovery is isolated**: Retry and recovery only affect the target cluster
5. **Removal is safe**: Removing one cluster doesn't break other clusters

## Notes

- If any check fails, document the behavior observed
- Report issues with specific steps to reproduce
