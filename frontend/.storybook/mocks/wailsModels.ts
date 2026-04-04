/**
 * Mock for @wailsjs/go/models used in Storybook.
 * Replicates the Wails-generated model classes with browser-compatible constructors.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
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
      this.currentVersion = source['currentVersion'];
      this.latestVersion = source['latestVersion'];
      this.releaseUrl = source['releaseUrl'];
      this.releaseName = source['releaseName'];
      this.publishedAt = source['publishedAt'];
      this.checkedAt = source['checkedAt'];
      this.isUpdateAvailable = source['isUpdateAvailable'];
      this.error = source['error'];
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
      this.version = source['version'];
      this.buildTime = source['buildTime'];
      this.gitCommit = source['gitCommit'];
      this.isBeta = source['isBeta'];
      this.expiryDate = source['expiryDate'];
      this.update = source['update'] ? new UpdateInfo(source['update']) : undefined;
    }
  }
}

export namespace types {
  export class ThemeInfo {
    currentTheme: string;
    userTheme: string;

    static createFrom(source: any = {}) {
      return new ThemeInfo(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.currentTheme = source['currentTheme'];
      this.userTheme = source['userTheme'];
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

    static createFrom(source: any = {}) {
      return new Theme(source);
    }

    constructor(source: any = {}) {
      if ('string' === typeof source) source = JSON.parse(source);
      this.id = source['id'];
      this.name = source['name'];
      this.clusterPattern = source['clusterPattern'];
      this.paletteHueLight = source['paletteHueLight'];
      this.paletteSaturationLight = source['paletteSaturationLight'];
      this.paletteBrightnessLight = source['paletteBrightnessLight'];
      this.paletteHueDark = source['paletteHueDark'];
      this.paletteSaturationDark = source['paletteSaturationDark'];
      this.paletteBrightnessDark = source['paletteBrightnessDark'];
      this.accentColorLight = source['accentColorLight'];
      this.accentColorDark = source['accentColorDark'];
      this.linkColorLight = source['linkColorLight'];
      this.linkColorDark = source['linkColorDark'];
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
      this.name = source['name'];
      this.path = source['path'];
      this.context = source['context'];
      this.isDefault = source['isDefault'];
      this.isCurrentContext = source['isCurrentContext'];
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
      this.key = source['key'];
      this.value = source['value'];
      this.effect = source['effect'];
    }
  }
}
