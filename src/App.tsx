import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  HardDrive,
  PieChart,
  Search,
  Wrench,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Zap,
  ShieldAlert,
  ShieldCheck,
  Cloud,
  X,
  Lock,
  Unlock,
  Copy,
  Package,
  FolderArchive,
  ArrowRight,
  ArrowDownToLine,
  Sparkles,
  Activity,
  Layers,
} from "lucide-react";
import {
  HardHubLogo,
  SdCardIcon,
  SsdIcon,
  HddIcon,
  EjectSvgIcon,
} from "./Logo";
import type {
  HardHubTab,
  StorageDriveInfo,
  BlockingProcessInfo,
  EjectReport,
  UpdateCheckInfo,
} from "./types";
import SpaceLensView from "./SpaceLensView";
import CatalogView from "./CatalogView";
import DuplicatesView from "./DuplicatesView";
import LargeFilesView from "./LargeFilesView";
import UninstallerView from "./UninstallerView";
import CleanerPurgeView from "./CleanerPurgeView";
import DiagnosticsView from "./DiagnosticsView";
import DiskManagerView from "./DiskManagerView";
import DriveCard from "./DriveCard";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

function DriveTypeIcon({
  deviceType,
  className = "w-5 h-5",
}: {
  deviceType: string;
  className?: string;
}) {
  if (deviceType === "sd_card") return <SdCardIcon className={className} />;
  if (deviceType === "external_hdd") return <HddIcon className={className} />;
  if (deviceType === "cloud_drive") return <Cloud className={className} />;
  return <SsdIcon className={className} />;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<HardHubTab>("drives");
  const [drives, setDrives] = useState<StorageDriveInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [spaceLensTargetPath, setSpaceLensTargetPath] = useState<string | null>(
    null
  );

  const openDriveInSpaceLens = (mountPoint: string) => {
    setSpaceLensTargetPath(mountPoint);
    setActiveTab("spacelens");
  };

  // Eject Doctor Modal State
  const [inspectingDrive, setInspectingDrive] =
    useState<StorageDriveInfo | null>(null);
  const [blockingProcesses, setBlockingProcesses] = useState<
    BlockingProcessInfo[]
  >([]);
  const [isCheckingBlockers, setIsCheckingBlockers] = useState(false);
  const [isEjecting, setIsEjecting] = useState<string | null>(null);

  // External Drive Encryption Modal State
  const [encryptTargetDrive, setEncryptTargetDrive] =
    useState<StorageDriveInfo | null>(null);
  const [encryptPassphrase, setEncryptPassphrase] = useState<string>("");
  const [encryptConfirmPassphrase, setEncryptConfirmPassphrase] =
    useState<string>("");
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const refreshDrives = async (silent: boolean = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const list = await invoke<StorageDriveInfo[]>("get_storage_drives");
      setDrives((prev) => {
        if (prev.length === list.length) {
          const isIdentical = prev.every((d, i) => {
            const o = list[i];
            return (
              o &&
              d.id === o.id &&
              d.mountPoint === o.mountPoint &&
              d.availableBytes === o.availableBytes &&
              d.usedBytes === o.usedBytes &&
              d.isEncrypted === o.isEncrypted &&
              d.hiddenTrashBytes === o.hiddenTrashBytes
            );
          });
          if (isIdentical) return prev;
        }
        return list;
      });
      invoke("refresh_tray_menu_cmd").catch(() => {});
    } catch (err) {
      if (!silent) setErrorBanner(String(err));
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  const handleExecuteEncryption = async () => {
    if (!encryptTargetDrive) return;
    if (encryptPassphrase.length < 4) {
      setErrorBanner("Le mot de passe doit comporter au moins 4 caractères.");
      return;
    }
    if (encryptPassphrase !== encryptConfirmPassphrase) {
      setErrorBanner("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setIsEncrypting(true);
    try {
      const res = await invoke<{ success: boolean; message: string }>(
        "encrypt_external_volume_cmd",
        {
          bsdName: encryptTargetDrive.bsdName,
          passphrase: encryptPassphrase,
        }
      );
      showToast(res.message);
      setEncryptTargetDrive(null);
      setEncryptPassphrase("");
      setEncryptConfirmPassphrase("");
      refreshDrives();
    } catch (err) {
      setErrorBanner(String(err));
    } finally {
      setIsEncrypting(false);
    }
  };

  // In-App Auto-Updater state
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [installStatus, setInstallStatus] = useState<string>("Téléchargement de la mise à jour…");

  const handleCheckUpdateManual = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await invoke<UpdateCheckInfo>("check_for_updates");
      if (info.updateAvailable) {
        setUpdateInfo(info);
        setIsUpdateModalOpen(true);
      } else {
        setUpdateInfo(null);
        showToast(`HardHub est à jour (${info.currentVersion})`);
      }
    } catch (err) {
      showToast("Impossible de vérifier les mises à jour (vérifiez la connexion)");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateInfo) return;
    setIsInstallingUpdate(true);
    setInstallStatus("Téléchargement de la mise à jour…");
    setDownloadProgress(0);

    const unlisten = await listen<number>("update-download-progress", (event) => {
      const p = Math.round(event.payload);
      setDownloadProgress(p);
      if (p >= 100) {
        setInstallStatus("Installation et redémarrage automatique…");
      }
    });

    try {
      await invoke("install_update", {
        downloadUrl: updateInfo.downloadUrl,
        assetSize: updateInfo.assetSize,
        assetUpdatedAt: updateInfo.assetUpdatedAt,
      });
    } catch (err) {
      unlisten();
      setIsInstallingUpdate(false);
      setErrorBanner(`Erreur mise à jour : ${err}`);
    }
  };

  useEffect(() => {
    // Silent check for updates on startup
    invoke<UpdateCheckInfo>("check_for_updates")
      .then((info) => {
        if (info && info.updateAvailable) {
          setUpdateInfo(info);
        }
      })
      .catch((e) => console.log("Recherche silencieuse mise à jour:", e));
  }, []);

  useEffect(() => {
    refreshDrives(false);
    const timer = setInterval(() => refreshDrives(true), 20000);
    return () => clearInterval(timer);
  }, []);

  const externalDrives = useMemo(
    () => drives.filter((d) => d.isRemovable),
    [drives]
  );

  const internalDrives = useMemo(
    () => drives.filter((d) => !d.isRemovable),
    [drives]
  );

  const handleOpenBlockerInspector = async (drive: StorageDriveInfo) => {
    setInspectingDrive(drive);
    setIsCheckingBlockers(true);
    try {
      const list = await invoke<BlockingProcessInfo[]>("check_drive_blockers", {
        mountPoint: drive.mountPoint,
      });
      setBlockingProcesses(list);
    } catch (err) {
      setErrorBanner(String(err));
    } finally {
      setIsCheckingBlockers(false);
    }
  };

  const handleSafeEject = async (
    drive: StorageDriveInfo,
    killBlockers: boolean
  ) => {
    setIsEjecting(drive.id);
    setErrorBanner(null);
    try {
      const report = await invoke<EjectReport>("safe_eject_drive", {
        mountPoint: drive.mountPoint,
        driveName: drive.name,
        killBlockers,
      });
      if (report.success) {
        showToast(report.message);
        if (inspectingDrive?.id === drive.id) {
          setInspectingDrive(null);
        }
        await refreshDrives();
      }
    } catch (err) {
      // Automatically open Eject Doctor if normal eject is blocked
      if (!killBlockers) {
        await handleOpenBlockerInspector(drive);
      } else {
        setErrorBanner(String(err));
      }
    } finally {
      setIsEjecting(null);
    }
  };

  const handleEjectAllExternal = async () => {
    if (externalDrives.length === 0) return;
    setIsEjecting("all");
    setErrorBanner(null);
    try {
      const reports = await invoke<EjectReport[]>("eject_all_external_drives");
      const okCount = reports.filter((r) => r.success).length;
      showToast(`${okCount}/${reports.length} support(s) éjecté(s) proprement.`);
      await refreshDrives();
    } catch (err) {
      setErrorBanner(String(err));
    } finally {
      setIsEjecting(null);
    }
  };

  const handleQuickPurgeTrash = async (drive: StorageDriveInfo) => {
    try {
      const freed = await invoke<number>("quick_purge_drive_trash", {
        mountPoint: drive.mountPoint,
      });
      showToast(
        freed > 0
          ? `Corbeille purgée sur ${drive.name} (${formatBytes(freed)} libérés)`
          : `Corbeille vidée sur ${drive.name}`
      );
      await refreshDrives();
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleRevealFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  return (
    <div className="relative h-screen w-screen flex flex-col bg-[#191919] text-[#EDEDEC] overflow-hidden select-none">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#10B981] text-[#141414] font-semibold text-xs shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toast}</span>
        </div>
      )}

      {/* ================= TOP HEADER ================= */}
      <header className="h-12 px-4 border-b border-[#2A2A2A] flex items-center justify-between bg-[#191919] shrink-0 z-10">
        <div className="flex items-center gap-2.5">
          <HardHubLogo className="w-7 h-7" />
          <span className="font-semibold text-sm tracking-tight text-[#EDEDEC]">
            HardHub
          </span>
          <button
            onClick={handleCheckUpdateManual}
            disabled={isCheckingUpdate}
            title="Vérifier les mises à jour"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252525] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEC] border border-[#2F2F2F] transition-colors cursor-pointer flex items-center gap-1"
          >
            {isCheckingUpdate && (
              <RefreshCw className="w-2.5 h-2.5 animate-spin text-[#3B82F6]" />
            )}
            <span>v1.0.0</span>
          </button>
          {updateInfo?.updateAvailable && (
            <button
              onClick={() => setIsUpdateModalOpen(true)}
              className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#10B981]/15 hover:bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/30 transition-colors cursor-pointer animate-pulse"
            >
              <Sparkles className="w-3 h-3" />
              <span>Mise à jour disponible ({updateInfo.latestVersion})</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {externalDrives.length > 0 && (
            <button
              onClick={handleEjectAllExternal}
              disabled={isEjecting === "all"}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-lg bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/35 text-[#FBBF24] transition-colors cursor-pointer"
              title="Synchroniser les caches et éjecter tous les supports externes"
            >
              <EjectSvgIcon className="w-3.5 h-3.5" />
              <span>
                {isEjecting === "all"
                  ? "Éjection…"
                  : `Tout éjecter (${externalDrives.length})`}
              </span>
            </button>
          )}

          <button
            onClick={() => refreshDrives(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isRefreshing ? "animate-spin text-[#3B82F6]" : ""
              }`}
            />
            <span>Supports ({drives.length})</span>
          </button>
        </div>
      </header>

      {/* Error Notification Banner */}
      {errorBanner && (
        <div className="mx-4 mt-2 px-3 py-1.5 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#EF4444]" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="hover:bg-[#EF4444]/20 p-0.5 rounded cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ================= MAIN WORKSPACE ================= */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR */}
        <aside className="w-52 bg-[#141414] border-r border-[#2A2A2A] flex flex-col justify-between p-2.5 shrink-0">
          <div className="space-y-1">
            <button
              onClick={() => setActiveTab("drives")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "drives"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <HardDrive
                  className={`w-4 h-4 ${
                    activeTab === "drives" ? "text-[#10B981]" : "text-[#9B9A97]"
                  }`}
                />
                <span>Mes Supports</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#2A2A2A] text-[#9B9A97]">
                {drives.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("spacelens")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "spacelens"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <PieChart
                  className={`w-4 h-4 ${
                    activeTab === "spacelens"
                      ? "text-[#3B82F6]"
                      : "text-[#9B9A97]"
                  }`}
                />
                <span>Space Lens</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("catalog")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "catalog"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Search
                  className={`w-4 h-4 ${
                    activeTab === "catalog"
                      ? "text-[#F59E0B]"
                      : "text-[#9B9A97]"
                  }`}
                />
                <span>Catalogue Hors-Ligne</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("duplicates")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "duplicates"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Copy
                  className={`w-4 h-4 ${
                    activeTab === "duplicates"
                      ? "text-[#EF4444]"
                      : "text-[#9B9A97]"
                  }`}
                />
                <span>Doublons &amp; Photos</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("largefiles")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "largefiles"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <FolderArchive
                  className={`w-4 h-4 ${
                    activeTab === "largefiles"
                      ? "text-[#F59E0B]"
                      : "text-[#9B9A97]"
                  }`}
                />
                <span>Gros Fichiers</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("uninstaller")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "uninstaller"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Package
                  className={`w-4 h-4 ${
                    activeTab === "uninstaller"
                      ? "text-[#06B6D4]"
                      : "text-[#9B9A97]"
                  }`}
                />
                <span>Désinstallateur</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("cleaner")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "cleaner"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Sparkles
                  className={`w-4 h-4 ${
                    activeTab === "cleaner" ? "text-[#10B981]" : "text-[#9B9A97]"
                  }`}
                />
                <span>Nettoyage &amp; Purge</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("diagnostics")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "diagnostics"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Activity
                  className={`w-4 h-4 ${
                    activeTab === "diagnostics" ? "text-[#06B6D4]" : "text-[#9B9A97]"
                  }`}
                />
                <span>Sante &amp; Debit</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("disks")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "disks"
                  ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                  : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Layers
                  className={`w-4 h-4 ${
                    activeTab === "disks" ? "text-[#8B5CF6]" : "text-[#9B9A97]"
                  }`}
                />
                <span>Disques &amp; Format</span>
              </div>
            </button>
          </div>

          <div className="px-3 py-2 rounded-lg bg-[#191919] border border-[#252525] flex items-center justify-between text-[11px] text-[#787774]">
            <span>Hard Suite • v1.0</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
          {/* ================= TAB 1: MES SUPPORTS ================= */}
          {activeTab === "drives" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* External Drives & SD Cards */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#9B9A97]">
                    Disques externes &amp; Cartes mémoire ({externalDrives.length})
                  </span>
                </div>

                {externalDrives.length === 0 ? (
                  <div className="rounded-xl border border-[#2B2B2B] bg-[#202020]/40 p-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <SdCardIcon className="w-5 h-5 text-[#787774]" />
                      <span className="text-xs text-[#9B9A97]">
                        Aucun disque externe ou carte SD branché.
                      </span>
                    </div>
                    <button
                      onClick={() => refreshDrives(false)}
                      className="px-3 py-1 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#353535] text-xs text-[#EDEDEC] cursor-pointer"
                    >
                      Actualiser
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {externalDrives.map((drive) => (
                      <DriveCard
                        key={drive.id}
                        drive={drive}
                        isEjecting={isEjecting === drive.id}
                        onEject={(d) => handleSafeEject(d, false)}
                        onRevealFinder={handleRevealFinder}
                        onOpenSpaceLens={openDriveInSpaceLens}
                        onQuickPurgeTrash={handleQuickPurgeTrash}
                        onOpenBlockerInspector={handleOpenBlockerInspector}
                        onEncryptDrive={(d) => {
                          setEncryptTargetDrive(d);
                          setEncryptPassphrase("");
                          setEncryptConfirmPassphrase("");
                        }}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Internal Mac Storage */}
              <section className="space-y-3">
                <span className="text-xs font-semibold text-[#9B9A97]">
                  Stockage interne Mac ({internalDrives.length})
                </span>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {internalDrives.map((drive) => (
                    <DriveCard
                      key={drive.id}
                      drive={drive}
                      onRevealFinder={handleRevealFinder}
                      onOpenSpaceLens={openDriveInSpaceLens}
                      onQuickPurgeTrash={handleQuickPurgeTrash}
                    />
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* ================= TAB 2: SPACE LENS (ÉTAPE 2) ================= */}
          {activeTab === "spacelens" && (
            <SpaceLensView
              drives={drives}
              initialTargetPath={spaceLensTargetPath}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {/* ================= TAB 3: CATALOGUE HORS-LIGNE (ÉTAPE 3) ================= */}
          {activeTab === "catalog" && (
            <CatalogView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
            />
          )}

          {/* ================= TAB 4: DOUBLONS & PHOTOS SIMILAIRES ================= */}
          {activeTab === "duplicates" && (
            <DuplicatesView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {/* ================= TAB 5: GROS FICHIERS OUBLIÉS ================= */}
          {activeTab === "largefiles" && (
            <LargeFilesView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {/* ================= TAB 6: DÉSINSTALLATEUR PROPRE ================= */}
          {activeTab === "uninstaller" && (
            <UninstallerView
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {/* ================= TAB 7: NETTOYAGE & PURGE ================= */}
          {activeTab === "cleaner" && (
            <CleanerPurgeView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {/* ================= TAB 8: SANTE & DEBIT ================= */}
          {activeTab === "diagnostics" && (
            <DiagnosticsView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
            />
          )}

          {/* ================= TAB 9: DISQUES & FORMATAGE ================= */}
          {activeTab === "disks" && (
            <DiskManagerView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}
        </main>
      </div>

      {/* ================= MODAL: EJECT DOCTOR ("QUI BLOQUE MON DISQUE ?") ================= */}
      {inspectingDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Unlock className="w-4 h-4 text-[#F59E0B]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Débloqueur d&apos;Éjection — {inspectingDrive.name}
                </h3>
              </div>
              <button
                onClick={() => setInspectingDrive(null)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#2C2C2C] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {isCheckingBlockers ? (
                <div className="py-8 text-center text-xs text-[#9B9A97]">
                  Inspection des descripteurs ouverts (lsof)…
                </div>
              ) : blockingProcesses.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center gap-3 text-xs text-[#34D399]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Aucun processus ne retient actuellement « {inspectingDrive.name} ». Vous pouvez l&apos;éjecter en toute sécurité.
                  </span>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="text-xs text-[#9B9A97]">
                    {blockingProcesses.length} processus retient ce disque :
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {blockingProcesses.map((proc) => (
                      <div
                        key={proc.pid}
                        className="p-3 rounded-xl bg-[#171717] border border-[#2B2B2B] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-[#EDEDEC]">
                              {proc.processName}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#262626] text-[#9B9A97]">
                              PID {proc.pid}
                            </span>
                            {proc.isSystemAgent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/15 text-[#60A5FA]">
                                Agent macOS
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#9B9A97] mt-0.5">
                            {proc.description}
                          </p>
                          <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                            {proc.sampleOpenFile}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono text-[#FBBF24] shrink-0">
                          {proc.openFilesCount} fichier(s)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleOpenBlockerInspector(inspectingDrive)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] border border-[#383838] text-xs font-medium text-[#EDEDEC] cursor-pointer"
                >
                  Revérifier
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setInspectingDrive(null)}
                    className="px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#2F2F2F] text-xs text-[#9B9A97] cursor-pointer"
                  >
                    Annuler
                  </button>

                  <button
                    onClick={() => handleSafeEject(inspectingDrive, true)}
                    disabled={isEjecting === inspectingDrive.id}
                    className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#059669] text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <EjectSvgIcon className="w-3.5 h-3.5" />
                    <span>
                      {isEjecting === inspectingDrive.id
                        ? "Libération & Éjection…"
                        : "Libérer & Éjecter maintenant"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= ENCRYPT DRIVE MODAL ================= */}
      {encryptTargetDrive && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#2F2F2F] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#60A5FA]">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Chiffrer le support externe
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    {encryptTargetDrive.name} (/dev/{encryptTargetDrive.bsdName})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEncryptTargetDrive(null)}
                className="p-1 rounded-lg text-[#787774] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-[#171717] border border-[#292929] text-xs text-[#9B9A97] space-y-1.5">
                <p className="text-[#EDEDEC] font-medium">Protection matérielle APFS XTS-AES-128</p>
                <p>
                  Ce mot de passe sera exigé par macOS lors de chaque branchement du disque sur n&apos;importe quel ordinateur.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#9B9A97] mb-1">
                    Mot de passe de protection
                  </label>
                  <input
                    type="password"
                    value={encryptPassphrase}
                    onChange={(e) => setEncryptPassphrase(e.target.value)}
                    placeholder="Au moins 4 caractères"
                    className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-[#2F2F2F] text-sm text-[#EDEDEC] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9B9A97] mb-1">
                    Confirmer le mot de passe
                  </label>
                  <input
                    type="password"
                    value={encryptConfirmPassphrase}
                    onChange={(e) => setEncryptConfirmPassphrase(e.target.value)}
                    placeholder="Répétez le mot de passe"
                    className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-[#2F2F2F] text-sm text-[#EDEDEC] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEncryptTargetDrive(null)}
                  className="px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#2F2F2F] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>

                <button
                  onClick={handleExecuteEncryption}
                  disabled={
                    isEncrypting ||
                    encryptPassphrase.length < 4 ||
                    encryptPassphrase !== encryptConfirmPassphrase
                  }
                  className="px-4 py-2 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    {isEncrypting ? "Activation du chiffrement…" : "Activer la protection"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ================= IN-APP AUTO-UPDATER MODAL ================= */}
      {isUpdateModalOpen && updateInfo && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden">
            {/* MODAL HEADER */}
            <div className="px-6 py-4 border-b border-[#2C2C2C] flex items-center justify-between bg-[#232323]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                  <ArrowDownToLine className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#EDEDEC]">
                    Mise à jour disponible
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    {updateInfo.releaseName || updateInfo.latestVersion} • {formatBytes(updateInfo.assetSize)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isInstallingUpdate}
                onClick={() => setIsUpdateModalOpen(false)}
                className="text-[#888888] hover:text-[#EDEDEC] p-1.5 rounded-lg hover:bg-[#2A2A2A] transition-colors disabled:opacity-30 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* MODAL BODY */}
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between text-xs bg-[#161616] p-3 rounded-xl border border-[#2B2B2B]">
                <div>
                  <span className="text-[#888888] block text-[10px]">Version actuelle</span>
                  <span className="font-semibold text-[#EDEDEC] font-mono">{updateInfo.currentVersion}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-[#555555]" />
                <div>
                  <span className="text-blue-400 block text-[10px] font-semibold">Nouvelle version</span>
                  <span className="font-bold text-blue-400 font-mono">{updateInfo.latestVersion}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
                  Résumé des nouveautés
                </span>
                <div className="bg-[#161616] p-3.5 rounded-xl border border-[#2A2A2A] text-xs text-[#D1D5DB] leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap font-sans">
                  {updateInfo.releaseNotes}
                </div>
              </div>

              {/* PROGRESS BAR WHILE INSTALLING */}
              {isInstallingUpdate && (
                <div className="space-y-2 pt-2 bg-[#171717] p-3.5 rounded-xl border border-blue-500/20">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-blue-300 font-medium">{installStatus}</span>
                    <span className="font-mono text-blue-400 font-bold">{downloadProgress}%</span>
                  </div>
                  <div className="w-full bg-[#111111] h-2 rounded-full overflow-hidden border border-[#2A2A2A]">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-150"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* MODAL ACTIONS */}
            <div className="px-6 py-4 bg-[#191919] border-t border-[#2C2C2C] flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={isInstallingUpdate}
                onClick={() => setIsUpdateModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] transition-colors disabled:opacity-40 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isInstallingUpdate}
                onClick={handleApplyUpdate}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg shadow-blue-600/30 border border-blue-400/40 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isInstallingUpdate ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Mise à jour en cours…</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    <span>Mettre à jour</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

