// Package templates provides curated starter YAML templates for resource creation.
// To add a new template, append to the slice returned by GetAll().
package templates

// ResourceTemplate defines a curated starter template for resource creation.
type ResourceTemplate struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	APIVersion  string `json:"apiVersion"`
	Category    string `json:"category"`
	Description string `json:"description"`
	YAML        string `json:"yaml"`
}

// GetAll returns all available resource creation templates.
func GetAll() []ResourceTemplate {
	return []ResourceTemplate{
		deploymentTemplate(),
		serviceTemplate(),
		configMapTemplate(),
		secretTemplate(),
		jobTemplate(),
		cronJobTemplate(),
		ingressTemplate(),
	}
}

func deploymentTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "Deployment",
		Kind:        "Deployment",
		APIVersion:  "apps/v1",
		Category:    "Workloads",
		Description: "A Deployment manages a set of replicated Pods",
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  # Required.
  name:
  namespace: my-namespace
  labels:
    app.kubernetes.io/name:
spec:
  # Number of desired Pod replicas.
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name:
  template:
    metadata:
      labels:
        app.kubernetes.io/name:
    spec:
      containers:
      - name:
`,
	}
}

func serviceTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "Service",
		Kind:        "Service",
		APIVersion:  "v1",
		Category:    "Networking",
		Description: "A ClusterIP Service exposes Pods within the cluster",
		YAML: `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: my-namespace
spec:
  # ClusterIP (default), NodePort, or LoadBalancer.
  type: ClusterIP
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 80
    protocol: TCP`,
	}
}

func configMapTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "ConfigMap",
		Kind:        "ConfigMap",
		APIVersion:  "v1",
		Category:    "Config",
		Description: "A ConfigMap stores non-confidential configuration data",
		YAML: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: my-namespace
data:
  # Key-value pairs available as environment variables or mounted files.
  APP_ENV: production
  LOG_LEVEL: info`,
	}
}

func secretTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "Secret",
		Kind:        "Secret",
		APIVersion:  "v1",
		Category:    "Config",
		Description: "A Secret stores sensitive data such as passwords or tokens",
		YAML: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: my-namespace
# Opaque is the default type. Other types: kubernetes.io/tls, kubernetes.io/dockerconfigjson
type: Opaque
stringData:
  # Values here will be base64-encoded automatically.
  username: admin
  password: changeme`,
	}
}

func jobTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "Job",
		Kind:        "Job",
		APIVersion:  "batch/v1",
		Category:    "Workloads",
		Description: "A Job runs a task to completion",
		YAML: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: my-namespace
spec:
  # Number of times to retry on failure.
  backoffLimit: 3
  template:
    spec:
      containers:
      - name: worker
        image: busybox:latest
        command: ["echo", "Hello from the job"]
      restartPolicy: Never`,
	}
}

func cronJobTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "CronJob",
		Kind:        "CronJob",
		APIVersion:  "batch/v1",
		Category:    "Workloads",
		Description: "A CronJob runs Jobs on a recurring schedule",
		YAML: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: my-namespace
spec:
  # Cron expression: minute hour day-of-month month day-of-week
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: worker
            image: busybox:latest
            command: ["echo", "Scheduled task"]
          restartPolicy: Never`,
	}
}

func ingressTemplate() ResourceTemplate {
	return ResourceTemplate{
		Name:        "Ingress",
		Kind:        "Ingress",
		APIVersion:  "networking.k8s.io/v1",
		Category:    "Networking",
		Description: "An Ingress exposes HTTP/HTTPS routes to Services",
		YAML: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: my-namespace
spec:
  rules:
  - host: my-app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-service
            port:
              number: 80`,
	}
}
