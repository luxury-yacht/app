/**
 * Mock for @wailsjs/go/models used in Storybook.
 * Replicates the Wails-generated model classes with browser-compatible constructors.
 */

const parseModelSource = <T extends object>(source: unknown): Partial<T> => {
  const parsed = typeof source === 'string' ? JSON.parse(source) : source;
  return parsed !== null && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
};

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

    static createFrom(source: unknown = {}): UpdateInfo {
      return new UpdateInfo(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<UpdateInfo>(source);
      this.currentVersion = parsed.currentVersion ?? '';
      this.latestVersion = parsed.latestVersion ?? '';
      this.releaseUrl = parsed.releaseUrl ?? '';
      this.releaseName = parsed.releaseName;
      this.publishedAt = parsed.publishedAt;
      this.checkedAt = parsed.checkedAt;
      this.isUpdateAvailable = parsed.isUpdateAvailable ?? false;
      this.error = parsed.error;
    }
  }

  export class AppInfo {
    version: string;
    buildTime: string;
    gitCommit: string;
    isBeta: boolean;
    expiryDate?: string;
    update?: UpdateInfo;

    static createFrom(source: unknown = {}): AppInfo {
      return new AppInfo(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<AppInfo>(source);
      this.version = parsed.version ?? '';
      this.buildTime = parsed.buildTime ?? '';
      this.gitCommit = parsed.gitCommit ?? '';
      this.isBeta = parsed.isBeta ?? false;
      this.expiryDate = parsed.expiryDate;
      this.update = parsed.update ? new UpdateInfo(parsed.update) : undefined;
    }
  }
}

export namespace types {
  export class AppearanceModeInfo {
    currentMode: string;
    userMode: string;

    static createFrom(source: unknown = {}): AppearanceModeInfo {
      return new AppearanceModeInfo(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<AppearanceModeInfo>(source);
      this.currentMode = parsed.currentMode ?? '';
      this.userMode = parsed.userMode ?? '';
    }
  }

  export class Theme {
    id: string;
    name: string;
    clusterPattern: string;
    paletteHueLight: number;
    paletteSaturationLight: number;
    paletteBrightnessLight: number;
    paletteHueDark: number;
    paletteSaturationDark: number;
    paletteBrightnessDark: number;
    accentColorLight?: string;
    accentColorDark?: string;
    linkColorLight?: string;
    linkColorDark?: string;

    static createFrom(source: unknown = {}): Theme {
      return new Theme(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<Theme>(source);
      this.id = parsed.id ?? '';
      this.name = parsed.name ?? '';
      this.clusterPattern = parsed.clusterPattern ?? '';
      this.paletteHueLight = parsed.paletteHueLight ?? 0;
      this.paletteSaturationLight = parsed.paletteSaturationLight ?? 0;
      this.paletteBrightnessLight = parsed.paletteBrightnessLight ?? 0;
      this.paletteHueDark = parsed.paletteHueDark ?? 0;
      this.paletteSaturationDark = parsed.paletteSaturationDark ?? 0;
      this.paletteBrightnessDark = parsed.paletteBrightnessDark ?? 0;
      this.accentColorLight = parsed.accentColorLight;
      this.accentColorDark = parsed.accentColorDark;
      this.linkColorLight = parsed.linkColorLight;
      this.linkColorDark = parsed.linkColorDark;
    }
  }

  export class KubeconfigInfo {
    name: string;
    path: string;
    context: string;
    isDefault: boolean;
    isCurrentContext: boolean;

    static createFrom(source: unknown = {}): KubeconfigInfo {
      return new KubeconfigInfo(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<KubeconfigInfo>(source);
      this.name = parsed.name ?? '';
      this.path = parsed.path ?? '';
      this.context = parsed.context ?? '';
      this.isDefault = parsed.isDefault ?? false;
      this.isCurrentContext = parsed.isCurrentContext ?? false;
    }
  }

  export class NodeTaint {
    key: string;
    value?: string;
    effect: string;

    static createFrom(source: unknown = {}): NodeTaint {
      return new NodeTaint(source);
    }

    constructor(source: unknown = {}) {
      const parsed = parseModelSource<NodeTaint>(source);
      this.key = parsed.key ?? '';
      this.value = parsed.value;
      this.effect = parsed.effect ?? '';
    }
  }
}
