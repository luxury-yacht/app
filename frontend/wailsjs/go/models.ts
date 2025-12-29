export namespace api {
	
	export class AllowlistEntry {
	
	
	    static createFrom(source: any = {}) {
	        return new AllowlistEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}
	export class AuthProviderConfig {
	    name: string;
	    config?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new AuthProviderConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.config = source["config"];
	    }
	}
	export class ExecEnvVar {
	    name: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecEnvVar(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class ExecConfig {
	    command: string;
	    args: string[];
	    env: ExecEnvVar[];
	    apiVersion?: string;
	    installHint?: string;
	    provideClusterInfo: boolean;
	    interactiveMode?: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.args = source["args"];
	        this.env = this.convertValues(source["env"], ExecEnvVar);
	        this.apiVersion = source["apiVersion"];
	        this.installHint = source["installHint"];
	        this.provideClusterInfo = source["provideClusterInfo"];
	        this.interactiveMode = source["interactiveMode"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PluginPolicy {
	
	
	    static createFrom(source: any = {}) {
	        return new PluginPolicy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

export namespace backend {
	
	export class UpdateInfo {
	    currentVersion: string;
	    latestVersion: string;
	    releaseUrl: string;
	    releaseName?: string;
	    publishedAt?: string;
	    checkedAt?: string;
	    isUpdateAvailable: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseUrl = source["releaseUrl"];
	        this.releaseName = source["releaseName"];
	        this.publishedAt = source["publishedAt"];
	        this.checkedAt = source["checkedAt"];
	        this.isUpdateAvailable = source["isUpdateAvailable"];
	        this.error = source["error"];
	    }
	}
	export class AppInfo {
	    version: string;
	    buildTime: string;
	    gitCommit: string;
	    isBeta: boolean;
	    expiryDate?: string;
	    update?: UpdateInfo;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.buildTime = source["buildTime"];
	        this.gitCommit = source["gitCommit"];
	        this.isBeta = source["isBeta"];
	        this.expiryDate = source["expiryDate"];
	        this.update = this.convertValues(source["update"], UpdateInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CatalogDomainDiagnostics {
	    domain: string;
	    scope?: string;
	    lastStatus: string;
	    lastError?: string;
	    lastWarning?: string;
	    lastDurationMs: number;
	    averageDurationMs?: number;
	    successCount?: number;
	    failureCount?: number;
	    totalItems?: number;
	    truncated?: boolean;
	    fallbackCount?: number;
	    hydrationCount?: number;
	
	    static createFrom(source: any = {}) {
	        return new CatalogDomainDiagnostics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.domain = source["domain"];
	        this.scope = source["scope"];
	        this.lastStatus = source["lastStatus"];
	        this.lastError = source["lastError"];
	        this.lastWarning = source["lastWarning"];
	        this.lastDurationMs = source["lastDurationMs"];
	        this.averageDurationMs = source["averageDurationMs"];
	        this.successCount = source["successCount"];
	        this.failureCount = source["failureCount"];
	        this.totalItems = source["totalItems"];
	        this.truncated = source["truncated"];
	        this.fallbackCount = source["fallbackCount"];
	        this.hydrationCount = source["hydrationCount"];
	    }
	}
	export class CatalogHealth {
	    status: string;
	    consecutiveFailures: number;
	    lastSyncMs: number;
	    lastSuccessMs?: number;
	    lastError?: string;
	    stale: boolean;
	    failedResources?: number;
	
	    static createFrom(source: any = {}) {
	        return new CatalogHealth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.consecutiveFailures = source["consecutiveFailures"];
	        this.lastSyncMs = source["lastSyncMs"];
	        this.lastSuccessMs = source["lastSuccessMs"];
	        this.lastError = source["lastError"];
	        this.stale = source["stale"];
	        this.failedResources = source["failedResources"];
	    }
	}
	export class CatalogDiagnostics {
	    enabled: boolean;
	    itemCount: number;
	    resourceCount: number;
	    lastSyncMs: number;
	    lastUpdated: number;
	    lastError?: string;
	    lastSuccessMs?: number;
	    status?: string;
	    consecutiveFailures?: number;
	    stale?: boolean;
	    failedResources?: number;
	    fallbackCount?: number;
	    hydrationCount?: number;
	    health?: CatalogHealth;
	    domains?: CatalogDomainDiagnostics[];
	
	    static createFrom(source: any = {}) {
	        return new CatalogDiagnostics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.itemCount = source["itemCount"];
	        this.resourceCount = source["resourceCount"];
	        this.lastSyncMs = source["lastSyncMs"];
	        this.lastUpdated = source["lastUpdated"];
	        this.lastError = source["lastError"];
	        this.lastSuccessMs = source["lastSuccessMs"];
	        this.status = source["status"];
	        this.consecutiveFailures = source["consecutiveFailures"];
	        this.stale = source["stale"];
	        this.failedResources = source["failedResources"];
	        this.fallbackCount = source["fallbackCount"];
	        this.hydrationCount = source["hydrationCount"];
	        this.health = this.convertValues(source["health"], CatalogHealth);
	        this.domains = this.convertValues(source["domains"], CatalogDomainDiagnostics);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class LogEntry {
	    // Go type: time
	    timestamp: any;
	    level: string;
	    message: string;
	    source?: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = this.convertValues(source["timestamp"], null);
	        this.level = source["level"];
	        this.message = source["message"];
	        this.source = source["source"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ObjectYAMLMutationRequest {
	    yaml: string;
	    kind: string;
	    apiVersion: string;
	    namespace: string;
	    name: string;
	    resourceVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new ObjectYAMLMutationRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.yaml = source["yaml"];
	        this.kind = source["kind"];
	        this.apiVersion = source["apiVersion"];
	        this.namespace = source["namespace"];
	        this.name = source["name"];
	        this.resourceVersion = source["resourceVersion"];
	    }
	}
	export class ObjectYAMLMutationResponse {
	    resourceVersion: string;
	
	    static createFrom(source: any = {}) {
	        return new ObjectYAMLMutationResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.resourceVersion = source["resourceVersion"];
	    }
	}
	
	export class VersionedResponse {
	    data: any;
	    version: string;
	    notModified: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VersionedResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.version = source["version"];
	        this.notModified = source["notModified"];
	    }
	}

}

export namespace capabilities {
	
	export class CheckRequest {
	    id: string;
	    clusterId?: string;
	    verb: string;
	    resourceKind: string;
	    namespace?: string;
	    name?: string;
	    subresource?: string;
	
	    static createFrom(source: any = {}) {
	        return new CheckRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.clusterId = source["clusterId"];
	        this.verb = source["verb"];
	        this.resourceKind = source["resourceKind"];
	        this.namespace = source["namespace"];
	        this.name = source["name"];
	        this.subresource = source["subresource"];
	    }
	}
	export class CheckResult {
	    id: string;
	    clusterId?: string;
	    verb: string;
	    resourceKind: string;
	    namespace?: string;
	    name?: string;
	    subresource?: string;
	    allowed: boolean;
	    deniedReason?: string;
	    evaluationError?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new CheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.clusterId = source["clusterId"];
	        this.verb = source["verb"];
	        this.resourceKind = source["resourceKind"];
	        this.namespace = source["namespace"];
	        this.name = source["name"];
	        this.subresource = source["subresource"];
	        this.allowed = source["allowed"];
	        this.deniedReason = source["deniedReason"];
	        this.evaluationError = source["evaluationError"];
	        this.error = source["error"];
	    }
	}

}

export namespace clientset {
	
	export class Clientset {
	    LegacyPrefix: string;
	    UseLegacyDiscovery: boolean;
	    NoPeerDiscovery: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Clientset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.LegacyPrefix = source["LegacyPrefix"];
	        this.UseLegacyDiscovery = source["UseLegacyDiscovery"];
	        this.NoPeerDiscovery = source["NoPeerDiscovery"];
	    }
	}

}

export namespace rest {
	
	export class ImpersonationConfig {
	    UserName: string;
	    UID: string;
	    Groups: string[];
	    Extra: Record<string, Array<string>>;
	
	    static createFrom(source: any = {}) {
	        return new ImpersonationConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.UserName = source["UserName"];
	        this.UID = source["UID"];
	        this.Groups = source["Groups"];
	        this.Extra = source["Extra"];
	    }
	}
	export class Config {
	    Host: string;
	    APIPath: string;
	    AcceptContentTypes: string;
	    ContentType: string;
	    // Go type: schema
	    GroupVersion?: any;
	    NegotiatedSerializer: any;
	    Username: string;
	    Password: string;
	    BearerToken: string;
	    BearerTokenFile: string;
	    Impersonate: ImpersonationConfig;
	    AuthProvider?: api.AuthProviderConfig;
	    AuthConfigPersister: any;
	    ExecProvider?: api.ExecConfig;
	    Insecure: boolean;
	    ServerName: string;
	    CertFile: string;
	    KeyFile: string;
	    CAFile: string;
	    CertData: number[];
	    KeyData: number[];
	    CAData: number[];
	    NextProtos: string[];
	    UserAgent: string;
	    DisableCompression: boolean;
	    Transport: any;
	    QPS: number;
	    Burst: number;
	    RateLimiter: any;
	    WarningHandler: any;
	    WarningHandlerWithContext: any;
	    Timeout: number;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Host = source["Host"];
	        this.APIPath = source["APIPath"];
	        this.AcceptContentTypes = source["AcceptContentTypes"];
	        this.ContentType = source["ContentType"];
	        this.GroupVersion = this.convertValues(source["GroupVersion"], null);
	        this.NegotiatedSerializer = source["NegotiatedSerializer"];
	        this.Username = source["Username"];
	        this.Password = source["Password"];
	        this.BearerToken = source["BearerToken"];
	        this.BearerTokenFile = source["BearerTokenFile"];
	        this.Impersonate = this.convertValues(source["Impersonate"], ImpersonationConfig);
	        this.AuthProvider = this.convertValues(source["AuthProvider"], api.AuthProviderConfig);
	        this.AuthConfigPersister = source["AuthConfigPersister"];
	        this.ExecProvider = this.convertValues(source["ExecProvider"], api.ExecConfig);
	        this.Insecure = source["Insecure"];
	        this.ServerName = source["ServerName"];
	        this.CertFile = source["CertFile"];
	        this.KeyFile = source["KeyFile"];
	        this.CAFile = source["CAFile"];
	        this.CertData = source["CertData"];
	        this.KeyData = source["KeyData"];
	        this.CAData = source["CAData"];
	        this.NextProtos = source["NextProtos"];
	        this.UserAgent = source["UserAgent"];
	        this.DisableCompression = source["DisableCompression"];
	        this.Transport = source["Transport"];
	        this.QPS = source["QPS"];
	        this.Burst = source["Burst"];
	        this.RateLimiter = source["RateLimiter"];
	        this.WarningHandler = source["WarningHandler"];
	        this.WarningHandlerWithContext = source["WarningHandlerWithContext"];
	        this.Timeout = source["Timeout"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace types {
	
	export class AggregationRule {
	    clusterRoleSelectors?: any[];
	
	    static createFrom(source: any = {}) {
	        return new AggregationRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.clusterRoleSelectors = source["clusterRoleSelectors"];
	    }
	}
	export class AppSettings {
	    theme: string;
	    selectedKubeconfig: string;
	    selectedKubeconfigs: string[];
	    useShortResourceNames: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.selectedKubeconfig = source["selectedKubeconfig"];
	        this.selectedKubeconfigs = source["selectedKubeconfigs"];
	        this.useShortResourceNames = source["useShortResourceNames"];
	    }
	}
	export class CRDCondition {
	    kind: string;
	    status: string;
	    reason?: string;
	    message?: string;
	    lastTransitionTime?: v1.Time;
	
	    static createFrom(source: any = {}) {
	        return new CRDCondition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.message = source["message"];
	        this.lastTransitionTime = this.convertValues(source["lastTransitionTime"], v1.Time);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CRDNames {
	    plural: string;
	    singular: string;
	    kind: string;
	    listKind?: string;
	    shortNames?: string[];
	    categories?: string[];
	
	    static createFrom(source: any = {}) {
	        return new CRDNames(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plural = source["plural"];
	        this.singular = source["singular"];
	        this.kind = source["kind"];
	        this.listKind = source["listKind"];
	        this.shortNames = source["shortNames"];
	        this.categories = source["categories"];
	    }
	}
	export class CRDVersion {
	    name: string;
	    served: boolean;
	    storage: boolean;
	    deprecated?: boolean;
	    schema?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new CRDVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.served = source["served"];
	        this.storage = source["storage"];
	        this.deprecated = source["deprecated"];
	        this.schema = source["schema"];
	    }
	}
	export class ClaimReference {
	    namespace: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaimReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.name = source["name"];
	    }
	}
	export class Subject {
	    kind: string;
	    apiGroup?: string;
	    name: string;
	    namespace?: string;
	
	    static createFrom(source: any = {}) {
	        return new Subject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.apiGroup = source["apiGroup"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	    }
	}
	export class RoleRef {
	    apiGroup: string;
	    kind: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new RoleRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiGroup = source["apiGroup"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	    }
	}
	export class ClusterRoleBindingDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    roleRef: RoleRef;
	    subjects: Subject[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ClusterRoleBindingDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.roleRef = this.convertValues(source["roleRef"], RoleRef);
	        this.subjects = this.convertValues(source["subjects"], Subject);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PolicyRule {
	    apiGroups?: string[];
	    resources?: string[];
	    resourceNames?: string[];
	    verbs: string[];
	    nonResourceURLs?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PolicyRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiGroups = source["apiGroups"];
	        this.resources = source["resources"];
	        this.resourceNames = source["resourceNames"];
	        this.verbs = source["verbs"];
	        this.nonResourceURLs = source["nonResourceURLs"];
	    }
	}
	export class ClusterRoleDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    rules: PolicyRule[];
	    aggregationRule?: AggregationRule;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    clusterRoleBindings?: string[];
	    roleBindings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ClusterRoleDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.rules = this.convertValues(source["rules"], PolicyRule);
	        this.aggregationRule = this.convertValues(source["aggregationRule"], AggregationRule);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.clusterRoleBindings = source["clusterRoleBindings"];
	        this.roleBindings = source["roleBindings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConfigMapDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    data?: Record<string, string>;
	    binaryData?: Record<string, string>;
	    dataCount: number;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    usedBy?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ConfigMapDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.data = source["data"];
	        this.binaryData = source["binaryData"];
	        this.dataCount = source["dataCount"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.usedBy = source["usedBy"];
	    }
	}
	export class PodMetricsSummary {
	    pods: number;
	    readyPods: number;
	    cpuUsage?: string;
	    memUsage?: string;
	    cpuRequest?: string;
	    cpuLimit?: string;
	    memRequest?: string;
	    memLimit?: string;
	
	    static createFrom(source: any = {}) {
	        return new PodMetricsSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pods = source["pods"];
	        this.readyPods = source["readyPods"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memUsage = source["memUsage"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	    }
	}
	export class PodSimpleInfo {
	    kind: string;
	    name: string;
	    namespace: string;
	    status: string;
	    ready: string;
	    restarts: number;
	    age: string;
	    cpuRequest: string;
	    cpuLimit: string;
	    cpuUsage: string;
	    memRequest: string;
	    memLimit: string;
	    memUsage: string;
	    ownerKind: string;
	    ownerName: string;
	
	    static createFrom(source: any = {}) {
	        return new PodSimpleInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.status = source["status"];
	        this.ready = source["ready"];
	        this.restarts = source["restarts"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.ownerKind = source["ownerKind"];
	        this.ownerName = source["ownerName"];
	    }
	}
	export class PodDetailInfoContainer {
	    name: string;
	    image: string;
	    imagePullPolicy: string;
	    ready: boolean;
	    restartCount: number;
	    state: string;
	    stateReason?: string;
	    stateMessage?: string;
	    startedAt?: string;
	    cpuRequest: string;
	    cpuLimit: string;
	    memRequest: string;
	    memLimit: string;
	    ports?: string[];
	    volumeMounts?: string[];
	    environment?: Record<string, string>;
	    command?: string[];
	    args?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PodDetailInfoContainer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.image = source["image"];
	        this.imagePullPolicy = source["imagePullPolicy"];
	        this.ready = source["ready"];
	        this.restartCount = source["restartCount"];
	        this.state = source["state"];
	        this.stateReason = source["stateReason"];
	        this.stateMessage = source["stateMessage"];
	        this.startedAt = source["startedAt"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.ports = source["ports"];
	        this.volumeMounts = source["volumeMounts"];
	        this.environment = source["environment"];
	        this.command = source["command"];
	        this.args = source["args"];
	    }
	}
	export class JobTemplateDetails {
	    completions?: number;
	    parallelism?: number;
	    backoffLimit?: number;
	    activeDeadlineSeconds?: number;
	    ttlSecondsAfterFinished?: number;
	    containers?: PodDetailInfoContainer[];
	
	    static createFrom(source: any = {}) {
	        return new JobTemplateDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.completions = source["completions"];
	        this.parallelism = source["parallelism"];
	        this.backoffLimit = source["backoffLimit"];
	        this.activeDeadlineSeconds = source["activeDeadlineSeconds"];
	        this.ttlSecondsAfterFinished = source["ttlSecondsAfterFinished"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class JobReference {
	    name: string;
	    startTime?: v1.Time;
	
	    static createFrom(source: any = {}) {
	        return new JobReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.startTime = this.convertValues(source["startTime"], v1.Time);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CronJobDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    age: string;
	    schedule: string;
	    suspend: boolean;
	    lastScheduleTime?: v1.Time;
	    lastSuccessfulTime?: v1.Time;
	    nextScheduleTime?: string;
	    timeUntilNextSchedule?: string;
	    concurrencyPolicy: string;
	    startingDeadlineSeconds?: number;
	    successfulJobsHistory: number;
	    failedJobsHistory: number;
	    activeJobs?: JobReference[];
	    jobTemplate: JobTemplateDetails;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	
	    static createFrom(source: any = {}) {
	        return new CronJobDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.age = source["age"];
	        this.schedule = source["schedule"];
	        this.suspend = source["suspend"];
	        this.lastScheduleTime = this.convertValues(source["lastScheduleTime"], v1.Time);
	        this.lastSuccessfulTime = this.convertValues(source["lastSuccessfulTime"], v1.Time);
	        this.nextScheduleTime = source["nextScheduleTime"];
	        this.timeUntilNextSchedule = source["timeUntilNextSchedule"];
	        this.concurrencyPolicy = source["concurrencyPolicy"];
	        this.startingDeadlineSeconds = source["startingDeadlineSeconds"];
	        this.successfulJobsHistory = source["successfulJobsHistory"];
	        this.failedJobsHistory = source["failedJobsHistory"];
	        this.activeJobs = this.convertValues(source["activeJobs"], JobReference);
	        this.jobTemplate = this.convertValues(source["jobTemplate"], JobTemplateDetails);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CustomResourceDefinitionDetails {
	    kind: string;
	    name: string;
	    group: string;
	    scope: string;
	    age: string;
	    details: string;
	    versions: CRDVersion[];
	    names: CRDNames;
	    conversionStrategy?: string;
	    conditions?: CRDCondition[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new CustomResourceDefinitionDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.group = source["group"];
	        this.scope = source["scope"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.versions = this.convertValues(source["versions"], CRDVersion);
	        this.names = this.convertValues(source["names"], CRDNames);
	        this.conversionStrategy = source["conversionStrategy"];
	        this.conditions = this.convertValues(source["conditions"], CRDCondition);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DaemonSetDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    desired: number;
	    current: number;
	    ready: number;
	    upToDate?: number;
	    available: number;
	    updated?: number;
	    age: string;
	    cpuRequest?: string;
	    cpuLimit?: string;
	    cpuUsage?: string;
	    memRequest?: string;
	    memLimit?: string;
	    memUsage?: string;
	    updateStrategy?: string;
	    maxUnavailable?: string;
	    maxSurge?: string;
	    minReadySeconds?: number;
	    revisionHistoryLimit?: number;
	    selector?: Record<string, string>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    nodeSelector?: Record<string, string>;
	    conditions?: string[];
	    containers?: PodDetailInfoContainer[];
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	    observedGeneration?: number;
	    numberMisscheduled?: number;
	    collisionCount?: number;
	
	    static createFrom(source: any = {}) {
	        return new DaemonSetDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.desired = source["desired"];
	        this.current = source["current"];
	        this.ready = source["ready"];
	        this.upToDate = source["upToDate"];
	        this.available = source["available"];
	        this.updated = source["updated"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.updateStrategy = source["updateStrategy"];
	        this.maxUnavailable = source["maxUnavailable"];
	        this.maxSurge = source["maxSurge"];
	        this.minReadySeconds = source["minReadySeconds"];
	        this.revisionHistoryLimit = source["revisionHistoryLimit"];
	        this.selector = source["selector"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.nodeSelector = source["nodeSelector"];
	        this.conditions = source["conditions"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	        this.observedGeneration = source["observedGeneration"];
	        this.numberMisscheduled = source["numberMisscheduled"];
	        this.collisionCount = source["collisionCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DataSourceInfo {
	    kind: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new DataSourceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	    }
	}
	export class ReplicaSetSummary {
	    name: string;
	    revision: string;
	    replicas: string;
	    readyReplicas: string;
	    availableReplicas: string;
	    age: string;
	
	    static createFrom(source: any = {}) {
	        return new ReplicaSetSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.revision = source["revision"];
	        this.replicas = source["replicas"];
	        this.readyReplicas = source["readyReplicas"];
	        this.availableReplicas = source["availableReplicas"];
	        this.age = source["age"];
	    }
	}
	export class DeploymentDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    replicas: string;
	    ready: string;
	    updated?: string;
	    upToDate?: number;
	    available?: number;
	    desiredReplicas?: number;
	    age: string;
	    cpuRequest?: string;
	    cpuLimit?: string;
	    cpuUsage?: string;
	    memRequest?: string;
	    memLimit?: string;
	    memUsage?: string;
	    strategy?: string;
	    maxSurge?: string;
	    maxUnavailable?: string;
	    minReadySeconds?: number;
	    revisionHistory?: number;
	    progressDeadline?: number;
	    selector?: Record<string, string>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    conditions?: string[];
	    containers?: PodDetailInfoContainer[];
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	    currentRevision?: string;
	    replicaSets?: string[];
	    replicaSetSummaries?: ReplicaSetSummary[];
	    observedGeneration?: number;
	    paused?: boolean;
	    rolloutStatus?: string;
	    rolloutMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new DeploymentDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.replicas = source["replicas"];
	        this.ready = source["ready"];
	        this.updated = source["updated"];
	        this.upToDate = source["upToDate"];
	        this.available = source["available"];
	        this.desiredReplicas = source["desiredReplicas"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.strategy = source["strategy"];
	        this.maxSurge = source["maxSurge"];
	        this.maxUnavailable = source["maxUnavailable"];
	        this.minReadySeconds = source["minReadySeconds"];
	        this.revisionHistory = source["revisionHistory"];
	        this.progressDeadline = source["progressDeadline"];
	        this.selector = source["selector"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.conditions = source["conditions"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	        this.currentRevision = source["currentRevision"];
	        this.replicaSets = source["replicaSets"];
	        this.replicaSetSummaries = this.convertValues(source["replicaSetSummaries"], ReplicaSetSummary);
	        this.observedGeneration = source["observedGeneration"];
	        this.paused = source["paused"];
	        this.rolloutStatus = source["rolloutStatus"];
	        this.rolloutMessage = source["rolloutMessage"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DrainNodeOptions {
	    gracePeriodSeconds: number;
	    ignoreDaemonSets: boolean;
	    deleteEmptyDirData: boolean;
	    force: boolean;
	    disableEviction: boolean;
	    skipWaitForPodsToTerminate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DrainNodeOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gracePeriodSeconds = source["gracePeriodSeconds"];
	        this.ignoreDaemonSets = source["ignoreDaemonSets"];
	        this.deleteEmptyDirData = source["deleteEmptyDirData"];
	        this.force = source["force"];
	        this.disableEviction = source["disableEviction"];
	        this.skipWaitForPodsToTerminate = source["skipWaitForPodsToTerminate"];
	    }
	}
	export class EndpointSliceAddress {
	    ip: string;
	    hostname?: string;
	    nodeName?: string;
	    targetRef?: string;
	
	    static createFrom(source: any = {}) {
	        return new EndpointSliceAddress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ip = source["ip"];
	        this.hostname = source["hostname"];
	        this.nodeName = source["nodeName"];
	        this.targetRef = source["targetRef"];
	    }
	}
	export class EndpointSlicePort {
	    name?: string;
	    port: number;
	    protocol: string;
	    appProtocol?: string;
	
	    static createFrom(source: any = {}) {
	        return new EndpointSlicePort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	        this.appProtocol = source["appProtocol"];
	    }
	}
	export class EndpointSliceSummary {
	    name: string;
	    addressType: string;
	    age: string;
	    readyAddresses?: EndpointSliceAddress[];
	    notReadyAddresses?: EndpointSliceAddress[];
	    ports?: EndpointSlicePort[];
	
	    static createFrom(source: any = {}) {
	        return new EndpointSliceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.addressType = source["addressType"];
	        this.age = source["age"];
	        this.readyAddresses = this.convertValues(source["readyAddresses"], EndpointSliceAddress);
	        this.notReadyAddresses = this.convertValues(source["notReadyAddresses"], EndpointSliceAddress);
	        this.ports = this.convertValues(source["ports"], EndpointSlicePort);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EndpointSliceDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    slices?: EndpointSliceSummary[];
	    totalReady: number;
	    totalNotReady: number;
	    totalPorts: number;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new EndpointSliceDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.slices = this.convertValues(source["slices"], EndpointSliceSummary);
	        this.totalReady = source["totalReady"];
	        this.totalNotReady = source["totalNotReady"];
	        this.totalPorts = source["totalPorts"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class HelmResource {
	    kind: string;
	    name: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new HelmResource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	    }
	}
	export class HelmRevision {
	    revision: number;
	    updated: string;
	    status: string;
	    chart: string;
	    appVersion?: string;
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new HelmRevision(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.revision = source["revision"];
	        this.updated = source["updated"];
	        this.status = source["status"];
	        this.chart = source["chart"];
	        this.appVersion = source["appVersion"];
	        this.description = source["description"];
	    }
	}
	export class HelmReleaseDetails {
	    kind: string;
	    typeAlias: string;
	    name: string;
	    namespace: string;
	    age: string;
	    chart: string;
	    version: string;
	    appVersion: string;
	    status: string;
	    revision: number;
	    updated: string;
	    description?: string;
	    notes?: string;
	    values?: Record<string, any>;
	    history?: HelmRevision[];
	    resources?: HelmResource[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new HelmReleaseDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.typeAlias = source["typeAlias"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.chart = source["chart"];
	        this.version = source["version"];
	        this.appVersion = source["appVersion"];
	        this.status = source["status"];
	        this.revision = source["revision"];
	        this.updated = source["updated"];
	        this.description = source["description"];
	        this.notes = source["notes"];
	        this.values = source["values"];
	        this.history = this.convertValues(source["history"], HelmRevision);
	        this.resources = this.convertValues(source["resources"], HelmResource);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class ScalingRules {
	    stabilizationWindowSeconds?: number;
	    selectPolicy?: string;
	    policies?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ScalingRules(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stabilizationWindowSeconds = source["stabilizationWindowSeconds"];
	        this.selectPolicy = source["selectPolicy"];
	        this.policies = source["policies"];
	    }
	}
	export class ScalingBehavior {
	    scaleUp?: ScalingRules;
	    scaleDown?: ScalingRules;
	
	    static createFrom(source: any = {}) {
	        return new ScalingBehavior(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scaleUp = this.convertValues(source["scaleUp"], ScalingRules);
	        this.scaleDown = this.convertValues(source["scaleDown"], ScalingRules);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MetricStatus {
	    kind: string;
	    current: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new MetricStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.current = source["current"];
	    }
	}
	export class MetricSpec {
	    kind: string;
	    target: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new MetricSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.target = source["target"];
	    }
	}
	export class ScaleTargetReference {
	    kind: string;
	    name: string;
	    apiVersion?: string;
	
	    static createFrom(source: any = {}) {
	        return new ScaleTargetReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.apiVersion = source["apiVersion"];
	    }
	}
	export class HorizontalPodAutoscalerDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    scaleTargetRef: ScaleTargetReference;
	    minReplicas?: number;
	    maxReplicas: number;
	    currentReplicas: number;
	    desiredReplicas: number;
	    metrics: MetricSpec[];
	    currentMetrics?: MetricStatus[];
	    behavior?: ScalingBehavior;
	    conditions?: string[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    lastScaleTime?: v1.Time;
	
	    static createFrom(source: any = {}) {
	        return new HorizontalPodAutoscalerDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.scaleTargetRef = this.convertValues(source["scaleTargetRef"], ScaleTargetReference);
	        this.minReplicas = source["minReplicas"];
	        this.maxReplicas = source["maxReplicas"];
	        this.currentReplicas = source["currentReplicas"];
	        this.desiredReplicas = source["desiredReplicas"];
	        this.metrics = this.convertValues(source["metrics"], MetricSpec);
	        this.currentMetrics = this.convertValues(source["currentMetrics"], MetricStatus);
	        this.behavior = this.convertValues(source["behavior"], ScalingBehavior);
	        this.conditions = source["conditions"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.lastScaleTime = this.convertValues(source["lastScaleTime"], v1.Time);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IPBlock {
	    cidr: string;
	    except?: string[];
	
	    static createFrom(source: any = {}) {
	        return new IPBlock(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cidr = source["cidr"];
	        this.except = source["except"];
	    }
	}
	export class IngressBackendDetails {
	    serviceName?: string;
	    servicePort?: string;
	    resource?: string;
	
	    static createFrom(source: any = {}) {
	        return new IngressBackendDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.serviceName = source["serviceName"];
	        this.servicePort = source["servicePort"];
	        this.resource = source["resource"];
	    }
	}
	export class IngressClassParameters {
	    apiGroup?: string;
	    kind: string;
	    name: string;
	    namespace?: string;
	    scope?: string;
	
	    static createFrom(source: any = {}) {
	        return new IngressClassParameters(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiGroup = source["apiGroup"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.scope = source["scope"];
	    }
	}
	export class IngressClassDetails {
	    kind: string;
	    name: string;
	    controller: string;
	    age: string;
	    isDefault: boolean;
	    details: string;
	    parameters?: IngressClassParameters;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    ingresses?: string[];
	
	    static createFrom(source: any = {}) {
	        return new IngressClassDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.controller = source["controller"];
	        this.age = source["age"];
	        this.isDefault = source["isDefault"];
	        this.details = source["details"];
	        this.parameters = this.convertValues(source["parameters"], IngressClassParameters);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.ingresses = source["ingresses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class IngressTLSDetails {
	    hosts: string[];
	    secretName?: string;
	
	    static createFrom(source: any = {}) {
	        return new IngressTLSDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hosts = source["hosts"];
	        this.secretName = source["secretName"];
	    }
	}
	export class IngressPathDetails {
	    path: string;
	    pathType: string;
	    backend: IngressBackendDetails;
	
	    static createFrom(source: any = {}) {
	        return new IngressPathDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.pathType = source["pathType"];
	        this.backend = this.convertValues(source["backend"], IngressBackendDetails);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IngressRuleDetails {
	    host?: string;
	    paths: IngressPathDetails[];
	
	    static createFrom(source: any = {}) {
	        return new IngressRuleDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.paths = this.convertValues(source["paths"], IngressPathDetails);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IngressDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    ingressClassName?: string;
	    rules: IngressRuleDetails[];
	    tls?: IngressTLSDetails[];
	    loadBalancerStatus?: string[];
	    defaultBackend?: IngressBackendDetails;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new IngressDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.ingressClassName = source["ingressClassName"];
	        this.rules = this.convertValues(source["rules"], IngressRuleDetails);
	        this.tls = this.convertValues(source["tls"], IngressTLSDetails);
	        this.loadBalancerStatus = source["loadBalancerStatus"];
	        this.defaultBackend = this.convertValues(source["defaultBackend"], IngressBackendDetails);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class JobDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    age?: string;
	    status?: string;
	    completions?: number;
	    parallelism?: number;
	    succeeded?: number;
	    failed?: number;
	    active?: number;
	    startTime?: v1.Time;
	    completionTime?: v1.Time;
	    duration?: string;
	    backoffLimit?: number;
	    activeDeadlineSeconds?: number;
	    ttlSecondsAfterFinished?: number;
	    completionMode?: string;
	    suspend?: boolean;
	    selector?: Record<string, string>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    containers?: PodDetailInfoContainer[];
	    conditions?: string[];
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	
	    static createFrom(source: any = {}) {
	        return new JobDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.age = source["age"];
	        this.status = source["status"];
	        this.completions = source["completions"];
	        this.parallelism = source["parallelism"];
	        this.succeeded = source["succeeded"];
	        this.failed = source["failed"];
	        this.active = source["active"];
	        this.startTime = this.convertValues(source["startTime"], v1.Time);
	        this.completionTime = this.convertValues(source["completionTime"], v1.Time);
	        this.duration = source["duration"];
	        this.backoffLimit = source["backoffLimit"];
	        this.activeDeadlineSeconds = source["activeDeadlineSeconds"];
	        this.ttlSecondsAfterFinished = source["ttlSecondsAfterFinished"];
	        this.completionMode = source["completionMode"];
	        this.suspend = source["suspend"];
	        this.selector = source["selector"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.conditions = source["conditions"];
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class KubeconfigInfo {
	    name: string;
	    path: string;
	    context: string;
	    isDefault: boolean;
	    isCurrentContext: boolean;
	
	    static createFrom(source: any = {}) {
	        return new KubeconfigInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.context = source["context"];
	        this.isDefault = source["isDefault"];
	        this.isCurrentContext = source["isCurrentContext"];
	    }
	}
	export class LimitRangeItem {
	    kind: string;
	    max?: Record<string, string>;
	    min?: Record<string, string>;
	    default?: Record<string, string>;
	    defaultRequest?: Record<string, string>;
	    maxLimitRequestRatio?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new LimitRangeItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.max = source["max"];
	        this.min = source["min"];
	        this.default = source["default"];
	        this.defaultRequest = source["defaultRequest"];
	        this.maxLimitRequestRatio = source["maxLimitRequestRatio"];
	    }
	}
	export class LimitRangeDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    limits: LimitRangeItem[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new LimitRangeDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.limits = this.convertValues(source["limits"], LimitRangeItem);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LogFetchRequest {
	    namespace: string;
	    workloadName?: string;
	    workloadKind?: string;
	    podName?: string;
	    container?: string;
	    previous: boolean;
	    tailLines: number;
	    sinceSeconds?: number;
	
	    static createFrom(source: any = {}) {
	        return new LogFetchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.workloadName = source["workloadName"];
	        this.workloadKind = source["workloadKind"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	        this.previous = source["previous"];
	        this.tailLines = source["tailLines"];
	        this.sinceSeconds = source["sinceSeconds"];
	    }
	}
	export class PodLogEntry {
	    timestamp: string;
	    pod: string;
	    container: string;
	    line: string;
	    isInit: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PodLogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.pod = source["pod"];
	        this.container = source["container"];
	        this.line = source["line"];
	        this.isInit = source["isInit"];
	    }
	}
	export class LogFetchResponse {
	    entries: PodLogEntry[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new LogFetchResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], PodLogEntry);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class WebhookSelectorExpression {
	    key: string;
	    operator: string;
	    values?: string[];
	
	    static createFrom(source: any = {}) {
	        return new WebhookSelectorExpression(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.operator = source["operator"];
	        this.values = source["values"];
	    }
	}
	export class WebhookSelector {
	    matchLabels?: Record<string, string>;
	    matchExpressions?: WebhookSelectorExpression[];
	
	    static createFrom(source: any = {}) {
	        return new WebhookSelector(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matchLabels = source["matchLabels"];
	        this.matchExpressions = this.convertValues(source["matchExpressions"], WebhookSelectorExpression);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WebhookRule {
	    apiGroups?: string[];
	    apiVersions?: string[];
	    resources?: string[];
	    operations?: string[];
	    scope?: string;
	
	    static createFrom(source: any = {}) {
	        return new WebhookRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.apiGroups = source["apiGroups"];
	        this.apiVersions = source["apiVersions"];
	        this.resources = source["resources"];
	        this.operations = source["operations"];
	        this.scope = source["scope"];
	    }
	}
	export class WebhookService {
	    namespace: string;
	    name: string;
	    path?: string;
	    port?: number;
	
	    static createFrom(source: any = {}) {
	        return new WebhookService(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.port = source["port"];
	    }
	}
	export class WebhookClientConfig {
	    service?: WebhookService;
	    url?: string;
	
	    static createFrom(source: any = {}) {
	        return new WebhookClientConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.service = this.convertValues(source["service"], WebhookService);
	        this.url = source["url"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WebhookDetails {
	    name: string;
	    clientConfig: WebhookClientConfig;
	    rules: WebhookRule[];
	    failurePolicy?: string;
	    matchPolicy?: string;
	    namespaceSelector?: WebhookSelector;
	    objectSelector?: WebhookSelector;
	    sideEffects?: string;
	    timeoutSeconds?: number;
	    admissionReviewVersions?: string[];
	    reinvocationPolicy?: string;
	
	    static createFrom(source: any = {}) {
	        return new WebhookDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.clientConfig = this.convertValues(source["clientConfig"], WebhookClientConfig);
	        this.rules = this.convertValues(source["rules"], WebhookRule);
	        this.failurePolicy = source["failurePolicy"];
	        this.matchPolicy = source["matchPolicy"];
	        this.namespaceSelector = this.convertValues(source["namespaceSelector"], WebhookSelector);
	        this.objectSelector = this.convertValues(source["objectSelector"], WebhookSelector);
	        this.sideEffects = source["sideEffects"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.admissionReviewVersions = source["admissionReviewVersions"];
	        this.reinvocationPolicy = source["reinvocationPolicy"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MutatingWebhookConfigurationDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    webhooks: WebhookDetails[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new MutatingWebhookConfigurationDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.webhooks = this.convertValues(source["webhooks"], WebhookDetails);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NamespaceDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    status: string;
	    hasWorkloads: boolean;
	    workloadsUnknown?: boolean;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    resourceQuotas?: string[];
	    limitRanges?: string[];
	
	    static createFrom(source: any = {}) {
	        return new NamespaceDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.status = source["status"];
	        this.hasWorkloads = source["hasWorkloads"];
	        this.workloadsUnknown = source["workloadsUnknown"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.resourceQuotas = source["resourceQuotas"];
	        this.limitRanges = source["limitRanges"];
	    }
	}
	export class NetworkPolicyPort {
	    protocol?: string;
	    port?: string;
	    endPort?: number;
	
	    static createFrom(source: any = {}) {
	        return new NetworkPolicyPort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.protocol = source["protocol"];
	        this.port = source["port"];
	        this.endPort = source["endPort"];
	    }
	}
	export class NetworkPolicyPeer {
	    podSelector?: Record<string, string>;
	    namespaceSelector?: Record<string, string>;
	    ipBlock?: IPBlock;
	
	    static createFrom(source: any = {}) {
	        return new NetworkPolicyPeer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.podSelector = source["podSelector"];
	        this.namespaceSelector = source["namespaceSelector"];
	        this.ipBlock = this.convertValues(source["ipBlock"], IPBlock);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NetworkPolicyRule {
	    from?: NetworkPolicyPeer[];
	    to?: NetworkPolicyPeer[];
	    ports?: NetworkPolicyPort[];
	
	    static createFrom(source: any = {}) {
	        return new NetworkPolicyRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.from = this.convertValues(source["from"], NetworkPolicyPeer);
	        this.to = this.convertValues(source["to"], NetworkPolicyPeer);
	        this.ports = this.convertValues(source["ports"], NetworkPolicyPort);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NetworkPolicyDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    podSelector: Record<string, string>;
	    policyTypes: string[];
	    ingressRules?: NetworkPolicyRule[];
	    egressRules?: NetworkPolicyRule[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new NetworkPolicyDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.podSelector = source["podSelector"];
	        this.policyTypes = source["policyTypes"];
	        this.ingressRules = this.convertValues(source["ingressRules"], NetworkPolicyRule);
	        this.egressRules = this.convertValues(source["egressRules"], NetworkPolicyRule);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class NodeCondition {
	    kind: string;
	    status: string;
	    reason?: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new NodeCondition(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.message = source["message"];
	    }
	}
	export class NodeTaint {
	    key: string;
	    value?: string;
	    effect: string;
	
	    static createFrom(source: any = {}) {
	        return new NodeTaint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.value = source["value"];
	        this.effect = source["effect"];
	    }
	}
	export class NodeDetails {
	    name: string;
	    status: string;
	    unschedulable: boolean;
	    roles: string;
	    age: string;
	    version: string;
	    internalIP: string;
	    externalIP?: string;
	    hostname: string;
	    architecture: string;
	    os: string;
	    osImage: string;
	    kernelVersion: string;
	    containerRuntime: string;
	    kubeletVersion: string;
	    cpuCapacity: string;
	    cpuAllocatable: string;
	    memoryCapacity: string;
	    memoryAllocatable: string;
	    podsCapacity: string;
	    podsAllocatable: string;
	    storageCapacity?: string;
	    podsCount: number;
	    restarts: number;
	    cpuRequests: string;
	    cpuLimits: string;
	    memRequests: string;
	    memLimits: string;
	    cpuUsage?: string;
	    memoryUsage?: string;
	    kind: string;
	    cpu: string;
	    memory: string;
	    pods: string;
	    conditions: NodeCondition[];
	    taints?: NodeTaint[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    podsList?: PodSimpleInfo[];
	
	    static createFrom(source: any = {}) {
	        return new NodeDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.unschedulable = source["unschedulable"];
	        this.roles = source["roles"];
	        this.age = source["age"];
	        this.version = source["version"];
	        this.internalIP = source["internalIP"];
	        this.externalIP = source["externalIP"];
	        this.hostname = source["hostname"];
	        this.architecture = source["architecture"];
	        this.os = source["os"];
	        this.osImage = source["osImage"];
	        this.kernelVersion = source["kernelVersion"];
	        this.containerRuntime = source["containerRuntime"];
	        this.kubeletVersion = source["kubeletVersion"];
	        this.cpuCapacity = source["cpuCapacity"];
	        this.cpuAllocatable = source["cpuAllocatable"];
	        this.memoryCapacity = source["memoryCapacity"];
	        this.memoryAllocatable = source["memoryAllocatable"];
	        this.podsCapacity = source["podsCapacity"];
	        this.podsAllocatable = source["podsAllocatable"];
	        this.storageCapacity = source["storageCapacity"];
	        this.podsCount = source["podsCount"];
	        this.restarts = source["restarts"];
	        this.cpuRequests = source["cpuRequests"];
	        this.cpuLimits = source["cpuLimits"];
	        this.memRequests = source["memRequests"];
	        this.memLimits = source["memLimits"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memoryUsage = source["memoryUsage"];
	        this.kind = source["kind"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	        this.pods = source["pods"];
	        this.conditions = this.convertValues(source["conditions"], NodeCondition);
	        this.taints = this.convertValues(source["taints"], NodeTaint);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.podsList = this.convertValues(source["podsList"], PodSimpleInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PersistentVolumeClaimDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    status: string;
	    volumeName?: string;
	    storageClass?: string;
	    accessModes: string[];
	    capacity: string;
	    volumeMode: string;
	    selector?: Record<string, string>;
	    dataSource?: DataSourceInfo;
	    conditions?: string[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    mountedBy?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PersistentVolumeClaimDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.status = source["status"];
	        this.volumeName = source["volumeName"];
	        this.storageClass = source["storageClass"];
	        this.accessModes = source["accessModes"];
	        this.capacity = source["capacity"];
	        this.volumeMode = source["volumeMode"];
	        this.selector = source["selector"];
	        this.dataSource = this.convertValues(source["dataSource"], DataSourceInfo);
	        this.conditions = source["conditions"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.mountedBy = source["mountedBy"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VolumeSourceInfo {
	    type: string;
	    details?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new VolumeSourceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.details = source["details"];
	    }
	}
	export class PersistentVolumeDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    status: string;
	    storageClass: string;
	    capacity: string;
	    accessModes: string[];
	    volumeMode: string;
	    reclaimPolicy: string;
	    claimRef?: ClaimReference;
	    mountOptions?: string[];
	    volumeSource: VolumeSourceInfo;
	    nodeAffinity?: string[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    conditions?: string[];
	
	    static createFrom(source: any = {}) {
	        return new PersistentVolumeDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.status = source["status"];
	        this.storageClass = source["storageClass"];
	        this.capacity = source["capacity"];
	        this.accessModes = source["accessModes"];
	        this.volumeMode = source["volumeMode"];
	        this.reclaimPolicy = source["reclaimPolicy"];
	        this.claimRef = this.convertValues(source["claimRef"], ClaimReference);
	        this.mountOptions = source["mountOptions"];
	        this.volumeSource = this.convertValues(source["volumeSource"], VolumeSourceInfo);
	        this.nodeAffinity = source["nodeAffinity"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.conditions = source["conditions"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PodDetailInfo {
	    name: string;
	    namespace: string;
	    status: string;
	    ready: string;
	    restarts: number;
	    age: string;
	    cpuRequest: string;
	    cpuLimit: string;
	    cpuUsage: string;
	    memRequest: string;
	    memLimit: string;
	    memUsage: string;
	    ownerKind: string;
	    ownerName: string;
	    node: string;
	    nodeIP?: string;
	    podIP?: string;
	    qosClass: string;
	    priority?: number;
	    priorityClass?: string;
	    serviceAccount: string;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    conditions?: string[];
	    containers: PodDetailInfoContainer[];
	    initContainers?: PodDetailInfoContainer[];
	    volumes?: string[];
	    tolerations?: string[];
	    affinity?: Record<string, any>;
	    hostNetwork: boolean;
	    hostPID: boolean;
	    hostIPC: boolean;
	    dnsPolicy?: string;
	    restartPolicy: string;
	    schedulerName?: string;
	    runtimeClass?: string;
	    securityContext?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new PodDetailInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.status = source["status"];
	        this.ready = source["ready"];
	        this.restarts = source["restarts"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.ownerKind = source["ownerKind"];
	        this.ownerName = source["ownerName"];
	        this.node = source["node"];
	        this.nodeIP = source["nodeIP"];
	        this.podIP = source["podIP"];
	        this.qosClass = source["qosClass"];
	        this.priority = source["priority"];
	        this.priorityClass = source["priorityClass"];
	        this.serviceAccount = source["serviceAccount"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.conditions = source["conditions"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.initContainers = this.convertValues(source["initContainers"], PodDetailInfoContainer);
	        this.volumes = source["volumes"];
	        this.tolerations = source["tolerations"];
	        this.affinity = source["affinity"];
	        this.hostNetwork = source["hostNetwork"];
	        this.hostPID = source["hostPID"];
	        this.hostIPC = source["hostIPC"];
	        this.dnsPolicy = source["dnsPolicy"];
	        this.restartPolicy = source["restartPolicy"];
	        this.schedulerName = source["schedulerName"];
	        this.runtimeClass = source["runtimeClass"];
	        this.securityContext = source["securityContext"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PodDisruptionBudgetDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    minAvailable?: string;
	    maxUnavailable?: string;
	    selector?: Record<string, string>;
	    currentHealthy: number;
	    desiredHealthy: number;
	    disruptionsAllowed: number;
	    expectedPods: number;
	    observedGeneration: number;
	    disruptedPods?: Record<string, v1.Time>;
	    conditions?: string[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new PodDisruptionBudgetDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.minAvailable = source["minAvailable"];
	        this.maxUnavailable = source["maxUnavailable"];
	        this.selector = source["selector"];
	        this.currentHealthy = source["currentHealthy"];
	        this.desiredHealthy = source["desiredHealthy"];
	        this.disruptionsAllowed = source["disruptionsAllowed"];
	        this.expectedPods = source["expectedPods"];
	        this.observedGeneration = source["observedGeneration"];
	        this.disruptedPods = this.convertValues(source["disruptedPods"], v1.Time, true);
	        this.conditions = source["conditions"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class ReplicaSetDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    replicas: string;
	    ready: string;
	    available?: number;
	    desiredReplicas?: number;
	    age: string;
	    cpuRequest?: string;
	    cpuLimit?: string;
	    cpuUsage?: string;
	    memRequest?: string;
	    memLimit?: string;
	    memUsage?: string;
	    minReadySeconds?: number;
	    selector?: Record<string, string>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    conditions?: string[];
	    containers?: PodDetailInfoContainer[];
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	    observedGeneration?: number;
	    isActive: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ReplicaSetDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.replicas = source["replicas"];
	        this.ready = source["ready"];
	        this.available = source["available"];
	        this.desiredReplicas = source["desiredReplicas"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.minReadySeconds = source["minReadySeconds"];
	        this.selector = source["selector"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.conditions = source["conditions"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	        this.observedGeneration = source["observedGeneration"];
	        this.isActive = source["isActive"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ScopeSelectorRequirement {
	    scopeName: string;
	    operator: string;
	    values?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ScopeSelectorRequirement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scopeName = source["scopeName"];
	        this.operator = source["operator"];
	        this.values = source["values"];
	    }
	}
	export class ScopeSelector {
	    matchExpressions?: ScopeSelectorRequirement[];
	
	    static createFrom(source: any = {}) {
	        return new ScopeSelector(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matchExpressions = this.convertValues(source["matchExpressions"], ScopeSelectorRequirement);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResourceQuotaDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    hard: Record<string, string>;
	    used: Record<string, string>;
	    scopes?: string[];
	    scopeSelector?: ScopeSelector;
	    usedPercentage?: Record<string, number>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ResourceQuotaDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.hard = source["hard"];
	        this.used = source["used"];
	        this.scopes = source["scopes"];
	        this.scopeSelector = this.convertValues(source["scopeSelector"], ScopeSelector);
	        this.usedPercentage = source["usedPercentage"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RoleBindingDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    roleRef: RoleRef;
	    subjects: Subject[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new RoleBindingDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.roleRef = this.convertValues(source["roleRef"], RoleRef);
	        this.subjects = this.convertValues(source["subjects"], Subject);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RoleDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    rules: PolicyRule[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    usedByRoleBindings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new RoleDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.rules = this.convertValues(source["rules"], PolicyRule);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.usedByRoleBindings = source["usedByRoleBindings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	export class SecretDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    secretType: string;
	    data?: Record<string, string>;
	    dataKeys: string[];
	    dataCount: number;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    usedBy?: string[];
	
	    static createFrom(source: any = {}) {
	        return new SecretDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.secretType = source["secretType"];
	        this.data = source["data"];
	        this.dataKeys = source["dataKeys"];
	        this.dataCount = source["dataCount"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.usedBy = source["usedBy"];
	    }
	}
	export class ServiceAccountDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    secrets?: string[];
	    imagePullSecrets?: string[];
	    automountServiceAccountToken?: boolean;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    usedByPods?: string[];
	    roleBindings?: string[];
	    clusterRoleBindings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ServiceAccountDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.secrets = source["secrets"];
	        this.imagePullSecrets = source["imagePullSecrets"];
	        this.automountServiceAccountToken = source["automountServiceAccountToken"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.usedByPods = source["usedByPods"];
	        this.roleBindings = source["roleBindings"];
	        this.clusterRoleBindings = source["clusterRoleBindings"];
	    }
	}
	export class ServicePortDetails {
	    name?: string;
	    protocol: string;
	    port: number;
	    targetPort: string;
	    nodePort?: number;
	
	    static createFrom(source: any = {}) {
	        return new ServicePortDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.port = source["port"];
	        this.targetPort = source["targetPort"];
	        this.nodePort = source["nodePort"];
	    }
	}
	export class ServiceDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    age: string;
	    details: string;
	    serviceType: string;
	    clusterIP: string;
	    clusterIPs?: string[];
	    externalIPs?: string[];
	    loadBalancerIP?: string;
	    loadBalancerStatus?: string;
	    externalName?: string;
	    ports: ServicePortDetails[];
	    sessionAffinity: string;
	    sessionAffinityTimeout?: number;
	    selector?: Record<string, string>;
	    endpoints?: string[];
	    endpointCount: number;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    healthStatus: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.serviceType = source["serviceType"];
	        this.clusterIP = source["clusterIP"];
	        this.clusterIPs = source["clusterIPs"];
	        this.externalIPs = source["externalIPs"];
	        this.loadBalancerIP = source["loadBalancerIP"];
	        this.loadBalancerStatus = source["loadBalancerStatus"];
	        this.externalName = source["externalName"];
	        this.ports = this.convertValues(source["ports"], ServicePortDetails);
	        this.sessionAffinity = source["sessionAffinity"];
	        this.sessionAffinityTimeout = source["sessionAffinityTimeout"];
	        this.selector = source["selector"];
	        this.endpoints = source["endpoints"];
	        this.endpointCount = source["endpointCount"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.healthStatus = source["healthStatus"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ShellSession {
	    sessionId: string;
	    namespace: string;
	    podName: string;
	    container: string;
	    command: string[];
	    containers: string[];
	
	    static createFrom(source: any = {}) {
	        return new ShellSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	        this.command = source["command"];
	        this.containers = source["containers"];
	    }
	}
	export class ShellSessionRequest {
	    namespace: string;
	    podName: string;
	    container?: string;
	    command?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ShellSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.namespace = source["namespace"];
	        this.podName = source["podName"];
	        this.container = source["container"];
	        this.command = source["command"];
	    }
	}
	export class StatefulSetDetails {
	    kind: string;
	    name: string;
	    namespace: string;
	    details: string;
	    replicas: string;
	    ready: string;
	    upToDate?: number;
	    available?: number;
	    desiredReplicas?: number;
	    age: string;
	    cpuRequest?: string;
	    cpuLimit?: string;
	    cpuUsage?: string;
	    memRequest?: string;
	    memLimit?: string;
	    memUsage?: string;
	    updateStrategy?: string;
	    partition?: number;
	    maxUnavailable?: string;
	    podManagementPolicy?: string;
	    minReadySeconds?: number;
	    revisionHistoryLimit?: number;
	    serviceName?: string;
	    pvcRetentionPolicy?: Record<string, string>;
	    selector?: Record<string, string>;
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    conditions?: string[];
	    containers?: PodDetailInfoContainer[];
	    volumeClaimTemplates?: string[];
	    pods?: PodSimpleInfo[];
	    podMetricsSummary?: PodMetricsSummary;
	    currentRevision?: string;
	    updateRevision?: string;
	    currentReplicas?: number;
	    updatedReplicas?: number;
	    observedGeneration?: number;
	    collisionCount?: number;
	
	    static createFrom(source: any = {}) {
	        return new StatefulSetDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.details = source["details"];
	        this.replicas = source["replicas"];
	        this.ready = source["ready"];
	        this.upToDate = source["upToDate"];
	        this.available = source["available"];
	        this.desiredReplicas = source["desiredReplicas"];
	        this.age = source["age"];
	        this.cpuRequest = source["cpuRequest"];
	        this.cpuLimit = source["cpuLimit"];
	        this.cpuUsage = source["cpuUsage"];
	        this.memRequest = source["memRequest"];
	        this.memLimit = source["memLimit"];
	        this.memUsage = source["memUsage"];
	        this.updateStrategy = source["updateStrategy"];
	        this.partition = source["partition"];
	        this.maxUnavailable = source["maxUnavailable"];
	        this.podManagementPolicy = source["podManagementPolicy"];
	        this.minReadySeconds = source["minReadySeconds"];
	        this.revisionHistoryLimit = source["revisionHistoryLimit"];
	        this.serviceName = source["serviceName"];
	        this.pvcRetentionPolicy = source["pvcRetentionPolicy"];
	        this.selector = source["selector"];
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.conditions = source["conditions"];
	        this.containers = this.convertValues(source["containers"], PodDetailInfoContainer);
	        this.volumeClaimTemplates = source["volumeClaimTemplates"];
	        this.pods = this.convertValues(source["pods"], PodSimpleInfo);
	        this.podMetricsSummary = this.convertValues(source["podMetricsSummary"], PodMetricsSummary);
	        this.currentRevision = source["currentRevision"];
	        this.updateRevision = source["updateRevision"];
	        this.currentReplicas = source["currentReplicas"];
	        this.updatedReplicas = source["updatedReplicas"];
	        this.observedGeneration = source["observedGeneration"];
	        this.collisionCount = source["collisionCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TopologyLabelRequirement {
	    key: string;
	    values: string[];
	
	    static createFrom(source: any = {}) {
	        return new TopologyLabelRequirement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.values = source["values"];
	    }
	}
	export class TopologySelector {
	    matchLabelExpressions: TopologyLabelRequirement[];
	
	    static createFrom(source: any = {}) {
	        return new TopologySelector(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matchLabelExpressions = this.convertValues(source["matchLabelExpressions"], TopologyLabelRequirement);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StorageClassDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    isDefault: boolean;
	    provisioner: string;
	    reclaimPolicy: string;
	    volumeBindingMode: string;
	    allowVolumeExpansion: boolean;
	    parameters?: Record<string, string>;
	    mountOptions?: string[];
	    allowedTopologies?: TopologySelector[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	    persistentVolumes?: string[];
	
	    static createFrom(source: any = {}) {
	        return new StorageClassDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.isDefault = source["isDefault"];
	        this.provisioner = source["provisioner"];
	        this.reclaimPolicy = source["reclaimPolicy"];
	        this.volumeBindingMode = source["volumeBindingMode"];
	        this.allowVolumeExpansion = source["allowVolumeExpansion"];
	        this.parameters = source["parameters"];
	        this.mountOptions = source["mountOptions"];
	        this.allowedTopologies = this.convertValues(source["allowedTopologies"], TopologySelector);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	        this.persistentVolumes = source["persistentVolumes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ThemeInfo {
	    currentTheme: string;
	    userTheme: string;
	
	    static createFrom(source: any = {}) {
	        return new ThemeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.currentTheme = source["currentTheme"];
	        this.userTheme = source["userTheme"];
	    }
	}
	
	
	export class ValidatingWebhookConfigurationDetails {
	    kind: string;
	    name: string;
	    age: string;
	    details: string;
	    webhooks: WebhookDetails[];
	    labels?: Record<string, string>;
	    annotations?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ValidatingWebhookConfigurationDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.age = source["age"];
	        this.details = source["details"];
	        this.webhooks = this.convertValues(source["webhooks"], WebhookDetails);
	        this.labels = source["labels"];
	        this.annotations = source["annotations"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	
	
	export class WindowSettings {
	    x: number;
	    y: number;
	    width: number;
	    height: number;
	    maximized: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WindowSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.maximized = source["maximized"];
	    }
	}

}

export namespace v1 {
	
	export class Time {
	
	
	    static createFrom(source: any = {}) {
	        return new Time(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	
	    }
	}

}

export namespace versioned {
	
	export class Clientset {
	    LegacyPrefix: string;
	    UseLegacyDiscovery: boolean;
	    NoPeerDiscovery: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Clientset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.LegacyPrefix = source["LegacyPrefix"];
	        this.UseLegacyDiscovery = source["UseLegacyDiscovery"];
	        this.NoPeerDiscovery = source["NoPeerDiscovery"];
	    }
	}

}

