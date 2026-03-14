/**
 * Mock for @wailsjs/go/models used in Storybook.
 * Replicates the Wails-generated AppInfo and UpdateInfo classes.
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
