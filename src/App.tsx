import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  HardDrive,
  PieChart,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Copy,
  Package,
  FolderArchive,
  Sparkles,
  Activity,
  Shield,
} from "lucide-react";
import { HardHubLogo, EjectSvgIcon } from "./Logo";
import type {
  HardHubTab,
  StorageDriveInfo,
  BlockingProcessInfo,
  EjectReport,
  UpdateCheckInfo,
} from "./types";
import { formatBytes } from "./utils/format";
import { DrivesView } from "./views/DrivesView";
import { EjectDoctorModal } from "./components/EjectDoctorModal";
import { EncryptDriveModal } from "./components/EncryptDriveModal";
import { UpdateModal } from "./components/UpdateModal";
import { DisclaimerModal } from "./components/DisclaimerModal";
import SpaceLensView from "./SpaceLensView";
import CatalogView from "./CatalogView";
import DuplicatesView from "./DuplicatesView";
import LargeFilesView from "./LargeFilesView";
import UninstallerView from "./UninstallerView";
import CleanerPurgeView from "./CleanerPurgeView";
import DiagnosticsView from "./DiagnosticsView";

export default function App() {
  const [activeTab, setActiveTab] = useState<HardHubTab>("drives");
  const [drives, setDrives] = useState<StorageDriveInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [spaceLensTargetPath, setSpaceLensTargetPath] = useState<string | null>(null);

  const [inspectingDrive, setInspectingDrive] = useState<StorageDriveInfo | null>(null);
  const [blockingProcesses, setBlockingProcesses] = useState<BlockingProcessInfo[]>([]);
  const [isCheckingBlockers, setIsCheckingBlockers] = useState(false);
  const [isEjecting, setIsEjecting] = useState<string | null>(null);

  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);

  const [encryptTargetDrive, setEncryptTargetDrive] = useState<StorageDriveInfo | null>(null);
  const [encryptPassphrase, setEncryptPassphrase] = useState<string>("");
  const [encryptConfirmPassphrase, setEncryptConfirmPassphrase] = useState<string>("");
  const [trashPurgeConfirmDrive, setTrashPurgeConfirmDrive] = useState<StorageDriveInfo | null>(null);
  const [confirmTrashIrreversible, setConfirmTrashIrreversible] = useState<boolean>(false);
  const [isPurgingDriveTrash, setIsPurgingDriveTrash] = useState<boolean>(false);
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateCheckInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [installStatus, setInstallStatus] = useState<string>("Téléchargement de la mise à jour…");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const openDriveInSpaceLens = (mountPoint: string) => {
    setSpaceLensTargetPath(mountPoint);
    setActiveTab("spacelens");
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
    } catch {
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

  const handleSafeEject = async (drive: StorageDriveInfo, killBlockers: boolean) => {
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

  const handleQuickPurgeTrash = (drive: StorageDriveInfo) => {
    setConfirmTrashIrreversible(false);
    setTrashPurgeConfirmDrive(drive);
  };

  const handleConfirmQuickPurgeTrash = async () => {
    if (!trashPurgeConfirmDrive || !confirmTrashIrreversible) return;
    const drive = trashPurgeConfirmDrive;
    setIsPurgingDriveTrash(true);
    try {
      const freed = await invoke<number>("quick_purge_drive_trash", {
        mountPoint: drive.mountPoint,
      });
      setTrashPurgeConfirmDrive(null);
      showToast(
        freed > 0
          ? `Corbeille purgée sur ${drive.name} (${formatBytes(freed)} libérés)`
          : `Corbeille vidée sur ${drive.name}`
      );
      await refreshDrives();
    } catch (err) {
      setErrorBanner(String(err));
    } finally {
      setIsPurgingDriveTrash(false);
    }
  };

  const handleRevealFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const navItems: {
    id: HardHubTab;
    label: string;
    icon: typeof HardDrive;
    activeColor: string;
    badge?: number;
  }[] = [
    { id: "drives", label: "Mes Supports", icon: HardDrive, activeColor: "text-[#10B981]", badge: drives.length },
    { id: "spacelens", label: "Space Lens", icon: PieChart, activeColor: "text-[#3B82F6]" },
    { id: "catalog", label: "Catalogue Hors-Ligne", icon: Search, activeColor: "text-[#F59E0B]" },
    { id: "duplicates", label: "Doublons & Photos", icon: Copy, activeColor: "text-[#EF4444]" },
    { id: "largefiles", label: "Gros Fichiers", icon: FolderArchive, activeColor: "text-[#F59E0B]" },
    { id: "uninstaller", label: "Désinstallateur", icon: Package, activeColor: "text-[#06B6D4]" },
    { id: "cleaner", label: "Nettoyage & Purge", icon: Sparkles, activeColor: "text-[#10B981]" },
    { id: "diagnostics", label: "Santé & Débit", icon: Activity, activeColor: "text-[#06B6D4]" },
  ];

  return (
    <div className="relative h-screen w-screen flex flex-col bg-[#191919] text-[#EDEDEC] overflow-hidden select-none">
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#10B981] text-[#141414] font-semibold text-xs shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toast}</span>
        </div>
      )}

      <header className="h-12 px-4 border-b border-[#2A2A2A] flex items-center justify-between bg-[#191919] shrink-0 z-10">
        <div className="flex items-center gap-2.5">
          <HardHubLogo className="w-7 h-7" />
          <span className="font-semibold text-sm tracking-tight text-[#EDEDEC]">HardHub</span>
          <button
            onClick={handleCheckUpdateManual}
            disabled={isCheckingUpdate}
            title="Vérifier les mises à jour"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#252525] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEC] border border-[#2F2F2F] transition-colors cursor-pointer flex items-center gap-1"
          >
            {isCheckingUpdate && <RefreshCw className="w-2.5 h-2.5 animate-spin text-[#3B82F6]" />}
            <span>v1.0.2</span>
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
                {isEjecting === "all" ? "Éjection…" : `Tout éjecter (${externalDrives.length})`}
              </span>
            </button>
          )}

          <button
            onClick={() => refreshDrives(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#3B82F6]" : ""}`} />
            <span>Supports ({drives.length})</span>
          </button>
        </div>
      </header>

      {errorBanner && (() => {
        const lowerErr = errorBanner.toLowerCase();
        const isMacosTccError =
          lowerErr.includes("permission denied") ||
          lowerErr.includes("os error 13") ||
          lowerErr.includes("-69464") ||
          lowerErr.includes("restricted by sandbox") ||
          lowerErr.includes("operation not permitted") ||
          lowerErr.includes("autorisation macos") ||
          lowerErr.includes("accès refusé par macos");

        return (
          <div className="mx-4 mt-2 px-3 py-2 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] text-xs flex flex-col gap-2 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#EF4444] mt-0.5" />
                <span className="break-words">{errorBanner}</span>
              </div>
              <button onClick={() => setErrorBanner(null)} className="hover:bg-[#EF4444]/20 p-0.5 rounded cursor-pointer shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {isMacosTccError && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#EF4444]/25">
                <span className="text-[11px] text-[#FECACA]">
                  macOS bloque l&apos;accès au support : autorisez HardHub (si une ancienne entrée existe, supprimez-la avec « − » puis réajoutez-la) et relancez l&apos;app.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => invoke("open_macos_privacy_settings", { pane: "full_disk" }).catch(() => {})}
                    className="px-2.5 py-1 rounded-md bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-[11px] transition-colors cursor-pointer"
                  >
                    Ouvrir Accès complet au disque
                  </button>
                  <button
                    onClick={() => invoke("open_macos_privacy_settings", { pane: "files" }).catch(() => {})}
                    className="px-2.5 py-1 rounded-md bg-[#2A2A2A] hover:bg-[#363636] text-[#EDEDEC] border border-[#444444] font-medium text-[11px] transition-colors cursor-pointer"
                  >
                    Ouvrir Fichiers et dossiers
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <aside className="w-52 bg-[#141414] border-r border-[#2A2A2A] flex flex-col justify-between p-2.5 shrink-0">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-[#242424] text-[#EDEDEC] border border-[#383838]"
                      : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#1C1C1C] border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? item.activeColor : "text-[#9B9A97]"}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && (
                    <span className="text-[10px] font-mono text-[#787774]">{item.badge}</span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setIsDisclaimerOpen(true)}
            className="w-full px-3 py-2 rounded-lg bg-[#191919] hover:bg-[#222222] border border-[#252525] hover:border-[#333333] flex items-center justify-between text-[11px] text-[#787774] hover:text-[#EDEDEC] transition-all cursor-pointer text-left"
            title="Informations légales et conditions d'utilisation"
          >
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-[#787774]" />
              <span>Hard Suite • v1.0.2</span>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
          </button>
        </aside>

        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
          {activeTab === "drives" && (
            <DrivesView
              externalDrives={externalDrives}
              internalDrives={internalDrives}
              isEjecting={isEjecting}
              onRefresh={() => refreshDrives(false)}
              onEject={(d) => handleSafeEject(d, false)}
              onRevealFinder={handleRevealFinder}
              onOpenSpaceLens={openDriveInSpaceLens}
              onQuickPurgeTrash={handleQuickPurgeTrash}
              onOpenBlockerInspector={handleOpenBlockerInspector}
              onOpenEncryptModal={(d) => {
                setEncryptTargetDrive(d);
                setEncryptPassphrase("");
                setEncryptConfirmPassphrase("");
              }}
            />
          )}

          {activeTab === "spacelens" && (
            <SpaceLensView
              drives={drives}
              initialTargetPath={spaceLensTargetPath}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {activeTab === "catalog" && (
            <CatalogView drives={drives} onShowToast={showToast} onShowError={(err) => setErrorBanner(err)} />
          )}

          {activeTab === "duplicates" && (
            <DuplicatesView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {activeTab === "largefiles" && (
            <LargeFilesView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {activeTab === "uninstaller" && (
            <UninstallerView
              onShowToast={showToast}
              onShowError={(err: string) => setErrorBanner(err)}
              onRefreshDrives={() => refreshDrives(false)}
            />
          )}

          {activeTab === "cleaner" && (
            <CleanerPurgeView
              drives={drives}
              onShowToast={showToast}
              onShowError={(err) => setErrorBanner(err)}
              onRefreshDrives={refreshDrives}
            />
          )}

          {activeTab === "diagnostics" && (
            <DiagnosticsView drives={drives} onShowToast={showToast} onShowError={(err) => setErrorBanner(err)} />
          )}
        </main>
      </div>

      <EjectDoctorModal
        drive={inspectingDrive}
        blockingProcesses={blockingProcesses}
        isChecking={isCheckingBlockers}
        isEjecting={inspectingDrive ? isEjecting === inspectingDrive.id : false}
        onRefresh={handleOpenBlockerInspector}
        onForceEject={(d) => handleSafeEject(d, true)}
        onClose={() => setInspectingDrive(null)}
      />

      <EncryptDriveModal
        drive={encryptTargetDrive}
        passphrase={encryptPassphrase}
        confirmPassphrase={encryptConfirmPassphrase}
        isEncrypting={isEncrypting}
        onPassphraseChange={setEncryptPassphrase}
        onConfirmChange={setEncryptConfirmPassphrase}
        onConfirm={handleExecuteEncryption}
        onClose={() => setEncryptTargetDrive(null)}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        updateInfo={updateInfo}
        isInstalling={isInstallingUpdate}
        downloadProgress={downloadProgress}
        installStatus={installStatus}
        onApply={handleApplyUpdate}
        onClose={() => setIsUpdateModalOpen(false)}
      />

      <DisclaimerModal isOpen={isDisclaimerOpen} onClose={() => setIsDisclaimerOpen(false)} />

      {trashPurgeConfirmDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Vider la corbeille de {trashPurgeConfirmDrive.name}
                </h3>
              </div>
              <button
                onClick={() => setTrashPurgeConfirmDrive(null)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#FCA5A5] space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-[#EF4444]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>ACTION IRRÉVERSIBLE</span>
                </div>
                <p className="text-[11px] text-[#FCA5A5]/90">
                  Tous les fichiers présents dans la corbeille de ce support seront définitivement effacés.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#EDEDEC] cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmTrashIrreversible}
                  onChange={(e) => setConfirmTrashIrreversible(e.target.checked)}
                  className="accent-[#EF4444]"
                />
                <span>
                  Je comprends que le vidage de la corbeille est définitif et irréversible
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setTrashPurgeConfirmDrive(null)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleConfirmQuickPurgeTrash}
                  disabled={!confirmTrashIrreversible || isPurgingDriveTrash}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs cursor-pointer"
                >
                  {isPurgingDriveTrash ? "Vidage…" : "Vider définitivement"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
