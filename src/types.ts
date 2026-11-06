export type HardHubTab =
  | "drives"
  | "spacelens"
  | "catalog"
  | "duplicates"
  | "uninstaller"
  | "largefiles"
  | "tools";

export interface StorageDriveInfo {
  id: string;
  name: string;
  mountPoint: string;
  bsdName: string;
  fileSystem: string;
  deviceType:
    | "internal_ssd"
    | "external_ssd"
    | "external_hdd"
    | "sd_card"
    | "cloud_drive"
    | string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  isRemovable: boolean;
  isReadOnly: boolean;
  isCloud: boolean;
  protocol: string;
  linkSpeedLabel: string;
  linkSpeedMbps: number;
  isCableBottlenecked: boolean;
  cableWarning?: string | null;
  hiddenTrashBytes: number;
  isEncrypted: boolean;
  encryptionStatus: string;
  canEncrypt: boolean;
}

export interface SystemGhostItem {
  id: string;
  name: string;
  category: "developer" | "package_manager" | "logs" | string;
  path: string;
  sizeBytes: number;
  itemCount: number;
  description: string;
}

export interface SystemGhostReport {
  totalBytes: number;
  items: SystemGhostItem[];
}

export interface SystemGhostPurgeReport {
  freedBytes: number;
  purgedIds: string[];
  errors: string[];
}

export interface UpdateCheckInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  assetName: string;
  assetSize: number;
  assetUpdatedAt: string;
  downloadUrl: string;
}

export interface BlockingProcessInfo {
  pid: number;
  processName: string;
  isSystemAgent: boolean;
  sampleOpenFile: string;
  openFilesCount: number;
  description: string;
}

export interface EjectReport {
  mountPoint: string;
  driveName: string;
  success: boolean;
  killedProcesses: string[];
  message: string;
}

export interface SpaceNode {
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  isDir: boolean;
  category: string;
  children: SpaceNode[];
}

export interface LargeFileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  category: string;
}

export interface CategoryStat {
  category: string;
  label: string;
  sizeBytes: number;
  fileCount: number;
}

export interface SpaceLensReport {
  rootPath: string;
  rootName: string;
  totalScannedBytes: number;
  totalFiles: number;
  totalDirs: number;
  scanDurationMs: number;
  rootNode: SpaceNode;
  topFiles: LargeFileEntry[];
  categories: CategoryStat[];
}

export interface PurgeCollectorResult {
  deletedCount: number;
  freedBytes: number;
  errors: string[];
}

export interface QuickPreset {
  label: string;
  path: string;
}

export interface CollectorItem {
  path: string;
  name: string;
  sizeBytes: number;
  isDir: boolean;
  category: string;
}

export interface CatalogEntry {
  name: string;
  relPath: string;
  parentRelPath: string;
  sizeBytes: number;
  isDir: boolean;
  category: string;
  modifiedTs: number;
}

export interface CatalogVolumeSummary {
  volumeId: string;
  volumeName: string;
  deviceType: string;
  fileSystem: string;
  lastMountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  indexedAt: string;
  totalFilesIndexed: number;
  totalDirsIndexed: number;
  isOnline: boolean;
}

export interface CatalogSearchResult {
  volumeId: string;
  volumeName: string;
  deviceType: string;
  isOnline: boolean;
  lastMountPoint: string;
  name: string;
  relPath: string;
  fullPathIfOnline: string;
  sizeBytes: number;
  isDir: boolean;
  category: string;
  modifiedTs: number;
}

export interface GhostCategorySummary {
  id: string;
  label: string;
  description: string;
  itemCount: number;
  totalBytes: number;
  samplePaths: string[];
}

export interface GhostScanReport {
  targetPath: string;
  totalReclaimableBytes: number;
  totalItems: number;
  categories: GhostCategorySummary[];
}

export interface GhostPurgeReport {
  deletedItems: number;
  freedBytes: number;
  errors: string[];
}

export interface SpeedTestResult {
  targetPath: string;
  writeMbps: number;
  readMbps: number;
  testedMegabytes: number;
  capabilityVerdict: string;
  isUsb2Limited: boolean;
}

export interface FormatDriveResult {
  bsdName: string;
  newName: string;
  fileSystem: string;
  success: boolean;
  message: string;
}

export interface DuplicateFileItem {
  path: string;
  name: string;
  parentDir: string;
  sizeBytes: number;
  modifiedTs: number;
  isMarkedForDeletion: boolean;
  isSuggestedOriginal: boolean;
}

export interface DuplicateGroup {
  groupId: string;
  matchType: "exact" | "similar_photo" | "burst" | string;
  similarityLabel: string;
  sharedSizeBytes: number;
  wastedBytes: number;
  files: DuplicateFileItem[];
}

export interface DuplicateScanReport {
  targetPath: string;
  totalScannedFiles: number;
  totalDuplicateGroups: number;
  totalWastedBytes: number;
  totalDuplicateFiles: number;
  scanDurationMs: number;
  groups: DuplicateGroup[];
}

export interface DuplicatePurgeReport {
  deletedFilesCount: number;
  freedBytes: number;
  errors: string[];
}

export interface AppResidualItem {
  path: string;
  label: string;
  category: string;
  sizeBytes: number;
  isDir: boolean;
  isSelected: boolean;
}

export interface InstalledAppSummary {
  id: string;
  name: string;
  bundleId: string;
  version: string;
  appPath: string;
  appSizeBytes: number;
  totalFootprintBytes: number;
  residualsCount: number;
  isSystemProtected: boolean;
  isRunning: boolean;
  lastModified: number;
  iconDataUrl?: string | null;
}

export interface AppDetails {
  app: InstalledAppSummary;
  items: AppResidualItem[];
}

export interface UninstallReport {
  appName: string;
  deletedItemsCount: number;
  freedBytes: number;
  errors: string[];
}

export interface ApfsSnapshotItem {
  uuid: string;
  name: string;
  dateLabel: string;
  isPurgeable: boolean;
  isSystemRoot: boolean;
  volumeMount: string;
}

export interface SnapshotReport {
  mountPoint: string;
  isApfs: boolean;
  totalSnapshots: number;
  purgeableSnapshots: number;
  snapshots: ApfsSnapshotItem[];
}

export interface SnapshotPurgeResult {
  deletedCount: number;
  message: string;
  success: boolean;
}

export interface ApfsVolumeItem {
  bsdName: string;
  name: string;
  mountPoint: string;
  role: string;
  capacityConsumedBytes: number;
  isEncrypted: boolean;
  isSystemLocked: boolean;
}

export interface ApfsContainerInfo {
  containerId: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  physicalStore: string;
  isInternal: boolean;
  volumes: ApfsVolumeItem[];
}

export interface AddVolumeRequest {
  containerId: string;
  volumeName: string;
  volumeFormat: string;
  roleType: string;
  quotaGb?: number | null;
  reserveGb?: number | null;
  passphrase?: string | null;
}

export interface SplitPartitionRequest {
  parentDisk: string;
  isRemovable: boolean;
  partition1Name: string;
  partition1Fs: string;
  partition1Pct: number;
  partition2Name: string;
  partition2Fs: string;
}

export interface PartitionActionResult {
  success: boolean;
  message: string;
}

export interface FlashTestProgress {
  stage: "writing" | "verifying" | "completed" | "error";
  percent: number;
  currentMb: number;
  totalMb: number;
  speedMbps: number;
  message: string;
}

export interface FlashTestResult {
  success: boolean;
  isCounterfeit: boolean;
  testedBytes: number;
  corruptedBytes: number;
  writeSpeedMbps: number;
  readSpeedMbps: number;
  verdictTitle: string;
  verdictDescription: string;
  durationSeconds: number;
}

export interface SsdHealthReport {
  bsdName: string;
  modelName: string;
  protocol: string;
  isSsd: boolean;
  totalBytes: number;
  bytesWritten: number;
  bytesRead: number;
  tbwWritten: number;
  tbrRead: number;
  writeOps: number;
  readOps: number;
  errorsCount: number;
  smartStatus: string;
  healthPercent: number;
  ratedTbw: number;
  temperatureCelsius?: number | null;
  statusVerdict: string;
  statusAdvice: string;
}

export interface LargeFileItem {
  path: string;
  name: string;
  sizeBytes: number;
  category: "installer" | "video" | "archive" | "ios_backup" | "disk_image" | "other" | string;
  lastModified: number;
  ageDays: number;
  ageCategory: "older_than_year" | "older_than_6m" | "older_than_3m" | "recent" | string;
  isSelected?: boolean;
}

export interface LargeFilesReport {
  targetPath: string;
  totalScannedFiles: number;
  matchedFilesCount: number;
  totalMatchedBytes: number;
  items: LargeFileItem[];
}

export interface LargeFilesPurgeReport {
  deletedCount: number;
  freedBytes: number;
  errors: string[];
}
