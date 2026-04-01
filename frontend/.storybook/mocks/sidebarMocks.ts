/**
 * Mock data and helpers for Sidebar Storybook stories.
 * Provides pre-built namespace lists and cluster configurations
 * for rendering the Sidebar in various states.
 */

import type { NamespaceListItem } from '@modules/namespace/contexts/NamespaceContext';

/** A realistic set of namespaces for a production-like cluster. */
export const MOCK_NAMESPACES: NamespaceListItem[] = [
  {
    name: 'All Namespaces',
    scope: '__all__',
    status: 'All namespaces',
    details: 'View resources across all namespaces',
    age: '—',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '__all__',
    isSynthetic: true,
  },
  {
    name: 'default',
    scope: 'default',
    status: 'Active',
    details: 'Status: Active • Workloads: Present',
    age: '120d',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '1001',
  },
  {
    name: 'kube-system',
    scope: 'kube-system',
    status: 'Active',
    details: 'Status: Active • Workloads: Present',
    age: '120d',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '1002',
  },
  {
    name: 'monitoring',
    scope: 'monitoring',
    status: 'Active',
    details: 'Status: Active • Workloads: Present',
    age: '90d',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '1003',
  },
  {
    name: 'ingress-nginx',
    scope: 'ingress-nginx',
    status: 'Active',
    details: 'Status: Active • Workloads: Present',
    age: '60d',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '1004',
  },
  {
    name: 'cert-manager',
    scope: 'cert-manager',
    status: 'Active',
    details: 'Status: Active • Workloads: Present',
    age: '60d',
    hasWorkloads: true,
    workloadsUnknown: false,
    resourceVersion: '1005',
  },
  {
    name: 'empty-ns',
    scope: 'empty-ns',
    status: 'Active',
    details: 'Status: Active • Workloads: None',
    age: '10d',
    hasWorkloads: false,
    workloadsUnknown: false,
    resourceVersion: '1006',
  },
];

/** Fewer namespaces for a minimal story. */
export const MOCK_NAMESPACES_MINIMAL: NamespaceListItem[] = MOCK_NAMESPACES.slice(0, 3);
