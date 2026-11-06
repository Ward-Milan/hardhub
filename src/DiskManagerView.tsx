import React, { useState, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Layers,
  Split,
  Plus,
  Trash2,
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  Info,
  X,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  FolderPlus,
} from "lucide-react";
import {
  StorageDrive,
  ApfsContainerInfo,
  ApfsVolumeItem,
  PartitionActionResult,
  FormatDriveResult,
} from "./types";

interface DiskManagerViewProps {
  drives: StorageDrive[];
  onShowToast: (message: string) => void;
  onShowError: (message: string) => void;
  onRefreshDrives: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 o";
  const k = 1024;
  const sizes = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export const DiskManagerView: React.FC<DiskManagerViewProps> = ({
  drives,
  onShowToast,
  onShowError,
  onRefreshDrives,
}) => {
  const [activeTab, setActiveTab] = useState<
    "apfs_volume" | "hybrid_split" | "format_single"
  >("apfs_volume");

  // APFS Containers
  const [apfsContainers, setApfsContainers] = useState<ApfsContainerInfo[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string>("");
  const [isLoadingContainers, setIsLoadingContainers] = useState(false);

  // New volume form
  const [newApfsVolumeName, setNewApfsVolumeName] = useState<string>("MonVolume");
  const [newApfsRole, setNewApfsRole] = useState<"standard" | "backup">("standard");
  const [newApfsQuotaGb, setNewApfsQuotaGb] = useState<number>(0);
  const [isAddingVolume, setIsAddingVolume] = useState(false);

  // Modals
  const [volumeToDelete, setVolumeToDelete] = useState<ApfsVolumeItem | null>(null);
  const [isDeletingVolume, setIsDeletingVolume] = useState(false);

  // Volume encryption modal
  const [encryptVolumeTarget, setEncryptVolumeTarget] = useState<ApfsVolumeItem | null>(null);
  const [volumePassphrase, setVolumePassphrase] = useState("");
  const [volumeConfirmPassphrase, setVolumeConfirmPassphrase] = useState("");
  const [isEncryptingVolume, setIsEncryptingVolume] = useState(false);

  // Removable drives for formatting / partitioning
  const externalRemovableDrives = useMemo(
    () => drives.filter((d) => d.isRemovable),
    [drives]
  );

  const [formatTargetId, setFormatTargetId] = useState<string>("");
  const [formatFs, setFormatFs] = useState<"ExFAT" | "APFS" | "FAT32">("ExFAT");
  const [formatVolumeName, setFormatVolumeName] = useState<string>("UNTITLED");
  const [confirmFormatModal, setConfirmFormatModal] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);

  // Hybrid Split state
  const [hybridSplitPct, setHybridSplitPct] = useState<number>(50);
  const [hybridName1, setHybridName1] = useState<string>("Mac_APFS");
  const [hybridName2, setHybridName2] = useState<string>("PC_ExFAT");
  const [isSplitting, setIsSplitting] = useState(false);
  const [confirmSplitModal, setConfirmSplitModal] = useState(false);

  const selectedFormatDrive = useMemo(
    () => externalRemovableDrives.find((d) => d.id === formatTargetId) || externalRemovableDrives[0] || null,
    [externalRemovableDrives, formatTargetId]
  );

  const loadApfsContainers = async () => {
    setIsLoadingContainers(true);
    try {
      const list = await invoke<ApfsContainerInfo[]>("list_apfs_containers_cmd");
      setApfsContainers(list);
      if (!selectedContainerId && list.length > 0) {
        setSelectedContainerId(list[0].containerId);
      }
    } catch (err) {
      console.warn("Could not load APFS containers", err);
    } finally {
      setIsLoadingContainers(false);
    }
  };

  useEffect(() => {
    loadApfsContainers();
  }, []);

  useEffect(() => {
    if (externalRemovableDrives.length > 0 && !formatTargetId) {
      setFormatTargetId(externalRemovableDrives[0].id);
      setFormatVolumeName(externalRemovableDrives[0].name.slice(0, 20));
    }
  }, [externalRemovableDrives, formatTargetId]);

  const currentContainer = useMemo(() => {
    return (
      apfsContainers.find((c) => c.containerId === selectedContainerId) ||
      apfsContainers[0] ||
      null
    );
  }, [apfsContainers, selectedContainerId]);

  const handleAddApfsVolume = async () => {
    if (!selectedContainerId) {
      onShowError("Veuillez selectionner un conteneur APFS.");
      return;
    }
    const clean = newApfsVolumeName.trim();
    if (!clean) {
      onShowError("Veuillez saisir un nom pour le volume.");
      return;
    }
    setIsAddingVolume(true);
    try {
      const res = await invoke<PartitionActionResult>("add_apfs_volume_cmd", {
        req: {
          containerId: selectedContainerId,
          volumeName: clean,
          volumeFormat: "APFS",
          roleType: newApfsRole,
          quotaGb: newApfsQuotaGb > 0 ? Number(newApfsQuotaGb) : null,
          reserveGb: null,
          passphrase: null,
        },
      });
      onShowToast(res.message);
      setNewApfsVolumeName("MonVolume");
      setNewApfsQuotaGb(0);
      await loadApfsContainers();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsAddingVolume(false);
    }
  };

  const handleConfirmDeleteVolume = async () => {
    if (!volumeToDelete) return;
    setIsDeletingVolume(true);
    try {
      const res = await invoke<PartitionActionResult>("delete_apfs_volume_cmd", {
        bsdName: volumeToDelete.bsdName,
        mountPoint: volumeToDelete.mountPoint,
      });
      onShowToast(res.message);
      setVolumeToDelete(null);
      await loadApfsContainers();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsDeletingVolume(false);
    }
  };

  const handleExecuteFormat = async () => {
    if (!selectedFormatDrive) return;
    setIsFormatting(true);
    try {
      const res = await invoke<FormatDriveResult>("format_removable_drive", {
        bsdName: selectedFormatDrive.bsdName,
        mountPoint: selectedFormatDrive.mountPoint,
        isRemovable: selectedFormatDrive.isRemovable,
        fileSystem: formatFs,
        newVolumeName: formatVolumeName,
      });
      setConfirmFormatModal(false);
      onShowToast(res.message);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsFormatting(false);
    }
  };

  const handleExecuteSplit = async () => {
    if (!selectedFormatDrive) return;
    setIsSplitting(true);
    try {
      const res = await invoke<PartitionActionResult>("split_dual_partition_cmd", {
        req: {
          parentDisk: selectedFormatDrive.bsdName,
          isRemovable: selectedFormatDrive.isRemovable,
          partition1Name: hybridName1.trim() || "Mac_APFS",
          partition1Fs: "APFS",
          partition1Pct: Number(hybridSplitPct),
          partition2Name: hybridName2.trim() || "PC_ExFAT",
          partition2Fs: "ExFAT",
        },
      });
      setConfirmSplitModal(false);
      onShowToast(res.message);
      onRefreshDrives();
      await loadApfsContainers();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsSplitting(false);
    }
  };

  const handleEncryptVolume = async () => {
    if (!encryptVolumeTarget) return;
    if (volumePassphrase.length < 4) {
      onShowError("Le mot de passe doit comporter au moins 4 caracteres.");
      return;
    }
    if (volumePassphrase !== volumeConfirmPassphrase) {
      onShowError("Les mots de passe ne correspondent pas.");
      return;
    }
    setIsEncryptingVolume(true);
    try {
      const res = await invoke<{ success: boolean; message: string }>(
        "encrypt_apfs_drive_cmd",
        {
          mountPoint: encryptVolumeTarget.mountPoint,
          bsdName: encryptVolumeTarget.bsdName,
          passphrase: volumePassphrase,
        }
      );
      if (res.success) {
        onShowToast(res.message);
        setEncryptVolumeTarget(null);
        setVolumePassphrase("");
        setVolumeConfirmPassphrase("");
        await loadApfsContainers();
        onRefreshDrives();
      } else {
        onShowError(res.message);
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsEncryptingVolume(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#EDEDEC] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#8B5CF6]" />
            <span>Disques &amp; Formatage</span>
          </h2>
          <p className="text-xs text-[#9B9A97]">
            Gestion des conteneurs APFS, volumes dynamiques, double partition hybride et formateur express
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center p-1 rounded-xl bg-[#161616] border border-[#2B2B2B]">
          <button
            onClick={() => setActiveTab("apfs_volume")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "apfs_volume"
                ? "bg-[#252525] text-[#EDEDEC] shadow-sm font-semibold"
                : "text-[#787774] hover:text-[#9B9A97]"
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>Volumes APFS</span>
          </button>
          <button
            onClick={() => setActiveTab("hybrid_split")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "hybrid_split"
                ? "bg-[#252525] text-[#EDEDEC] shadow-sm font-semibold"
                : "text-[#787774] hover:text-[#9B9A97]"
            }`}
          >
            <Split className="w-3.5 h-3.5 text-[#FBBF24]" />
            <span>Hybride Mac &amp; PC</span>
          </button>
          <button
            onClick={() => setActiveTab("format_single")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "format_single"
                ? "bg-[#252525] text-[#EDEDEC] shadow-sm font-semibold"
                : "text-[#787774] hover:text-[#9B9A97]"
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Formateur Express</span>
          </button>
        </div>
      </div>

      {/* TAB 1: DYNAMIC APFS VOLUMES */}
      {activeTab === "apfs_volume" && (
        <div className="bg-[#202020] border border-[#2F2F2F] rounded-2xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#2A2A2A]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center">
                <Layers className="w-5 h-5 text-[#A78BFA]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Conteneurs &amp; Volumes APFS Dynamiques
                </h3>
                <p className="text-xs text-[#9B9A97]">
                  Les volumes APFS partagent instantanement le stockage physique sans repartitionnement lourd
                </p>
              </div>
            </div>

            <button
              onClick={loadApfsContainers}
              disabled={isLoadingContainers}
              className="px-3 py-1.5 rounded-xl bg-[#161616] hover:bg-[#252525] border border-[#2F2F2F] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingContainers ? "animate-spin" : ""}`} />
              <span>Actualiser</span>
            </button>
          </div>

          {/* Container Selector & Free Space Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-medium text-[#9B9A97]">
                Conteneur APFS actif
              </label>
              <select
                value={selectedContainerId}
                onChange={(e) => setSelectedContainerId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#161616] border border-[#2E2E2E] text-xs text-[#EDEDEC] focus:outline-none"
              >
                {apfsContainers.map((c) => (
                  <option key={c.containerId} value={c.containerId}>
                    Conteneur {c.containerId} ({c.isInternal ? "Stockage Interne" : "Disque Externe"} • {formatBytes(c.totalBytes)})
                  </option>
                ))}
              </select>
            </div>

            {currentContainer && (
              <div className="p-3 rounded-xl bg-[#171717] border border-[#2B2B2B] flex flex-col justify-center">
                <span className="text-[11px] text-[#9B9A97]">Espace partage disponible</span>
                <span className="text-base font-bold font-mono text-[#10B981]">
                  {formatBytes(currentContainer.freeBytes)} libres
                </span>
              </div>
            )}
          </div>

          {/* Volume List in Container */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
              Volumes presents dans ce conteneur ({currentContainer?.volumes.length || 0})
            </h4>

            <div className="space-y-2">
              {!currentContainer || currentContainer.volumes.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#787774] border border-[#2A2A2A] rounded-xl bg-[#161616]">
                  Aucun volume detecte dans ce conteneur.
                </div>
              ) : (
                currentContainer.volumes.map((vol) => (
                  <div
                    key={vol.bsdName}
                    className="p-3.5 rounded-xl bg-[#171717] border border-[#282828] hover:border-[#383838] flex flex-wrap items-center justify-between gap-3 text-xs transition-colors"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#252525] border border-[#303030] flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4 text-[#9B9A97]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[#EDEDEC] truncate">
                            {vol.name || "Sans nom"}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#202020] text-[#787774] border border-[#2A2A2A]">
                            /dev/{vol.bsdName}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                              vol.isSystemLocked
                                ? "bg-[#3B82F6]/15 text-[#60A5FA] border border-[#3B82F6]/30"
                                : vol.role.toLowerCase().includes("backup")
                                ? "bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30"
                                : "bg-[#252525] text-[#9B9A97] border border-[#303030]"
                            }`}
                          >
                            {vol.role || "Standard"}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-medium flex items-center gap-1 ${
                              vol.isEncrypted
                                ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                                : "bg-[#202020] text-[#787774] border border-[#2A2A2A]"
                            }`}
                          >
                            {vol.isEncrypted ? (
                              <Lock className="w-2.5 h-2.5 text-[#10B981]" />
                            ) : (
                              <Unlock className="w-2.5 h-2.5 text-[#787774]" />
                            )}
                            <span>{vol.isEncrypted ? "Chiffre FileVault" : "Non chiffre"}</span>
                          </span>
                        </div>
                        <p className="text-[11px] text-[#787774] truncate mt-0.5">
                          {vol.mountPoint}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="font-mono text-xs font-semibold text-[#EDEDEC] block">
                          {formatBytes(vol.capacityConsumedBytes)}
                        </span>
                        <span className="text-[10px] text-[#787774]">occupes</span>
                      </div>

                      {!vol.isEncrypted &&
                        !vol.isSystemLocked &&
                        currentContainer &&
                        !currentContainer.isInternal && (
                          <button
                            onClick={() => {
                              setEncryptVolumeTarget(vol);
                              setVolumePassphrase("");
                              setVolumeConfirmPassphrase("");
                            }}
                            title="Proteger ce volume par un mot de passe (Chiffrement APFS)"
                            className="px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25 border border-[#3B82F6]/30 text-[#60A5FA] text-xs flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Chiffrer</span>
                          </button>
                        )}

                      {vol.isSystemLocked ? (
                        <span
                          title="Protege par le systeme macOS (Volume d'amorcage racine)"
                          className="px-2.5 py-1.5 rounded-lg bg-[#1D1D1D] text-[#555555] text-xs flex items-center gap-1 border border-[#262626]"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Systeme</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => setVolumeToDelete(vol)}
                          title="Supprimer definitivement ce volume APFS"
                          className="px-2.5 py-1.5 rounded-lg bg-[#EF4444]/10 hover:bg-[#EF4444]/20 border border-[#EF4444]/30 text-[#FCA5A5] text-xs flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Supprimer</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add New Volume Form */}
          <div className="p-4 rounded-xl bg-[#171717] border border-[#2B2B2B] space-y-3">
            <div>
              <h4 className="text-xs font-semibold text-[#EDEDEC] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Ajouter un nouveau volume partage</span>
              </h4>
              <p className="text-[11px] text-[#9B9A97]">
                Instantane et sans partitionnement destructif. Le stockage est alloue dynamiquement selon vos besoins.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
              <div className="sm:col-span-2">
                <label className="text-[10px] text-[#9B9A97] block mb-1">Nom du volume</label>
                <input
                  type="text"
                  value={newApfsVolumeName}
                  onChange={(e) => setNewApfsVolumeName(e.target.value)}
                  placeholder="Ex: Projets, Archives, TimeMachine"
                  maxLength={24}
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] text-[#9B9A97] block mb-1">Role APFS</label>
                <select
                  value={newApfsRole}
                  onChange={(e) => setNewApfsRole(e.target.value as "standard" | "backup")}
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                >
                  <option value="standard">Standard (Donnees)</option>
                  <option value="backup">Sauvegarde (Time Machine)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-[#9B9A97] block mb-1">Quota maximal (Go)</label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={newApfsQuotaGb || ""}
                  onChange={(e) =>
                    setNewApfsQuotaGb(Math.max(0, parseInt(e.target.value) || 0))
                  }
                  placeholder="0 = Illimite"
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleAddApfsVolume}
                disabled={isAddingVolume || !newApfsVolumeName.trim()}
                className="px-4 py-2 rounded-xl bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAddingVolume ? "Creation en cours..." : "Creer le volume APFS"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HYBRID DUAL PARTITION */}
      {activeTab === "hybrid_split" && (
        <div className="bg-[#202020] border border-[#2F2F2F] rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#2A2A2A]">
            <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/30 flex items-center justify-center">
              <Split className="w-5 h-5 text-[#FBBF24]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#EDEDEC]">
                Double Partition Hybride Universelle Mac &amp; PC
              </h3>
              <p className="text-xs text-[#9B9A97]">
                Configurez en un clic une partition APFS ultra-rapide pour macOS et une partition ExFAT compatible Windows / Linux
              </p>
            </div>
          </div>

          {externalRemovableDrives.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#161616] border border-[#282828] text-xs text-[#787774] text-center space-y-2">
              <HardDrive className="w-8 h-8 text-[#555555] mx-auto" />
              <p className="font-semibold text-sm text-[#EDEDEC]">
                Aucun disque amovible externe connecte
              </p>
              <p className="text-xs max-w-md mx-auto">
                Connectez un disque SSD externe ou une cle USB pour proceder au partitionnement hybride.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Target Drive Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Disque externe cible a partitionner
                </label>
                <select
                  value={formatTargetId}
                  onChange={(e) => setFormatTargetId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                >
                  {externalRemovableDrives.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (/dev/{d.bsdName} • {formatBytes(d.totalBytes)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Names for Partitions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-[#171717] border border-[#8B5CF6]/30 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#A78BFA]">
                    <span>Partition 1 : APFS (Mac Natif)</span>
                    <span className="font-mono">{hybridSplitPct}%</span>
                  </div>
                  <input
                    type="text"
                    value={hybridName1}
                    onChange={(e) => setHybridName1(e.target.value)}
                    placeholder="Nom Mac"
                    maxLength={20}
                    className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                  />
                  <p className="text-[10px] text-[#787774]">
                    Ideal pour sauvegardes Time Machine et transferts ultra-rapides macOS
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#171717] border border-[#F59E0B]/30 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#FBBF24]">
                    <span>Partition 2 : ExFAT (Universel PC / Mac)</span>
                    <span className="font-mono">{100 - hybridSplitPct}%</span>
                  </div>
                  <input
                    type="text"
                    value={hybridName2}
                    onChange={(e) => setHybridName2(e.target.value)}
                    placeholder="Nom PC"
                    maxLength={20}
                    className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                  />
                  <p className="text-[10px] text-[#787774]">
                    Compatible sans pilote sur Windows 10/11, macOS, Linux, TV et consoles
                  </p>
                </div>
              </div>

              {/* Slider & Proportions */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs text-[#9B9A97]">
                  <span>
                    Volume Mac :{" "}
                    <strong className="text-[#A78BFA] font-mono">
                      {selectedFormatDrive
                        ? formatBytes((selectedFormatDrive.totalBytes * hybridSplitPct) / 100)
                        : `${hybridSplitPct}%`}
                    </strong>
                  </span>
                  <span>
                    Volume PC :{" "}
                    <strong className="text-[#FBBF24] font-mono">
                      {selectedFormatDrive
                        ? formatBytes((selectedFormatDrive.totalBytes * (100 - hybridSplitPct)) / 100)
                        : `${100 - hybridSplitPct}%`}
                    </strong>
                  </span>
                </div>

                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={hybridSplitPct}
                  onChange={(e) => setHybridSplitPct(parseInt(e.target.value))}
                  className="w-full accent-[#8B5CF6] cursor-pointer"
                />

                {/* Visual split representation */}
                <div className="h-7 rounded-xl overflow-hidden flex text-xs font-bold shadow-inner">
                  <div
                    style={{ width: `${hybridSplitPct}%` }}
                    className="bg-[#8B5CF6] text-white flex items-center justify-center transition-all truncate px-2"
                  >
                    {hybridName1 || "Mac"} ({hybridSplitPct}%)
                  </div>
                  <div
                    style={{ width: `${100 - hybridSplitPct}%` }}
                    className="bg-[#F59E0B] text-black flex items-center justify-center transition-all truncate px-2"
                  >
                    {hybridName2 || "PC"} ({100 - hybridSplitPct}%)
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setConfirmSplitModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold text-xs flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  <Split className="w-4 h-4" />
                  <span>Partitionner en 2 volumes...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SIMPLE 1-CLICK FORMAT */}
      {activeTab === "format_single" && (
        <div className="bg-[#202020] border border-[#2F2F2F] rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-[#2A2A2A]">
            <div className="w-10 h-10 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-[#34D399]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#EDEDEC]">
                Formateur Express 1-Clic
              </h3>
              <p className="text-xs text-[#9B9A97]">
                Formatage propre et optimise pour supports externes, cles USB et cartes SD
              </p>
            </div>
          </div>

          {externalRemovableDrives.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#161616] border border-[#282828] text-xs text-[#787774] text-center space-y-2">
              <HardDrive className="w-8 h-8 text-[#555555] mx-auto" />
              <p className="font-semibold text-sm text-[#EDEDEC]">
                Aucun support amovible detecte
              </p>
              <p className="text-xs max-w-md mx-auto">
                Branchez un disque externe, une cle USB ou une carte SD pour debloquer le formateur express.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Drive selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Support amovible a formater
                </label>
                <select
                  value={formatTargetId}
                  onChange={(e) => {
                    setFormatTargetId(e.target.value);
                    const d = externalRemovableDrives.find((x) => x.id === e.target.value);
                    if (d) setFormatVolumeName(d.name.slice(0, 20));
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                >
                  {externalRemovableDrives.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (/dev/{d.bsdName} • {formatBytes(d.totalBytes)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Filesystem options */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Profil du systeme de fichiers
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        id: "ExFAT",
                        label: "ExFAT Universel",
                        sub: "Recommande pour Camera, Mac & PC sans limite de taille de fichier 4Go",
                      },
                      {
                        id: "APFS",
                        label: "APFS Apple",
                        sub: "Performance maximale macOS SSD, snapshots et chiffrement natif",
                      },
                      {
                        id: "FAT32",
                        label: "FAT32 Classique",
                        sub: "Compatibilite maximale autoradio, anciennes TV et consoles vintage",
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setFormatFs(opt.id)}
                      className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        formatFs === opt.id
                          ? "bg-[#10B981]/15 border-[#10B981]/50 text-[#EDEDEC]"
                          : "bg-[#171717] border-[#2A2A2A] text-[#9B9A97] hover:border-[#383838]"
                      }`}
                    >
                      <div className="text-xs font-bold text-[#EDEDEC] flex items-center justify-between">
                        <span>{opt.label}</span>
                        {formatFs === opt.id && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                        )}
                      </div>
                      <div className="text-[11px] text-[#787774] mt-1">
                        {opt.sub}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Nom du nouveau volume
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={formatVolumeName}
                    onChange={(e) => setFormatVolumeName(e.target.value)}
                    placeholder="Nom du volume"
                    maxLength={24}
                    className="flex-1 px-3 py-2 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                  />
                  <button
                    onClick={() => setConfirmFormatModal(true)}
                    className="px-5 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-semibold text-xs cursor-pointer shrink-0 shadow-sm"
                  >
                    Formater le disque...
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: CONFIRM FORMAT */}
      {confirmFormatModal && selectedFormatDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#202020] border border-[#EF4444]/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center text-[#EF4444]">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#EDEDEC]">
                  Confirmer le formatage
                </h3>
                <p className="text-xs text-[#9B9A97]">
                  Action irreversible sur le disque amovible
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#171717] border border-[#2B2B2B] text-xs space-y-1.5">
              <p className="text-[#EDEDEC]">
                Support cible : <strong className="font-mono">{selectedFormatDrive.name}</strong> ({selectedFormatDrive.bsdName})
              </p>
              <p className="text-[#9B9A97]">
                Nouveau systeme : <strong className="text-[#10B981]">{formatFs}</strong> (Nom : &laquo; {formatVolumeName} &raquo;)
              </p>
              <p className="text-[#EF4444] font-semibold pt-1">
                Toutes les donnees presentes sur ce support amovible seront definitivement effacees.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmFormatModal(false)}
                disabled={isFormatting}
                className="px-4 py-2 rounded-xl bg-[#282828] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC] cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={handleExecuteFormat}
                disabled={isFormatting}
                className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-50 text-white font-semibold text-xs cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {isFormatting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isFormatting ? "Formatage en cours..." : "Oui, effacer et formater"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM SPLIT */}
      {confirmSplitModal && selectedFormatDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#202020] border border-[#8B5CF6]/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center text-[#A78BFA]">
                <Split className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#EDEDEC]">
                  Creer la double partition hybride
                </h3>
                <p className="text-xs text-[#9B9A97]">
                  Reinitialisation complete du disque externe
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#171717] border border-[#2B2B2B] text-xs space-y-2">
              <p className="text-[#EDEDEC]">
                Disque : <strong className="font-mono">{selectedFormatDrive.name}</strong> ({selectedFormatDrive.bsdName})
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2 rounded-lg bg-[#202020] border border-[#8B5CF6]/20">
                  <div className="text-[10px] text-[#A78BFA] font-semibold">1. Mac (APFS)</div>
                  <div className="font-mono text-xs text-[#EDEDEC] truncate">&laquo; {hybridName1} &raquo;</div>
                  <div className="text-[10px] text-[#787774]">{hybridSplitPct}%</div>
                </div>
                <div className="p-2 rounded-lg bg-[#202020] border border-[#F59E0B]/20">
                  <div className="text-[10px] text-[#FBBF24] font-semibold">2. PC (ExFAT)</div>
                  <div className="font-mono text-xs text-[#EDEDEC] truncate">&laquo; {hybridName2} &raquo;</div>
                  <div className="text-[10px] text-[#787774]">{100 - hybridSplitPct}%</div>
                </div>
              </div>
              <p className="text-[#EF4444] text-[11px] pt-1">
                Attention : Le disque sera entierement formate en table GPT avec 2 volumes distincts.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setConfirmSplitModal(false)}
                disabled={isSplitting}
                className="px-4 py-2 rounded-xl bg-[#282828] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC] cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={handleExecuteSplit}
                disabled={isSplitting}
                className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white font-semibold text-xs cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {isSplitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSplitting ? "Partitionnement..." : "Confirmer et partitionner"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DELETE APFS VOLUME */}
      {volumeToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#202020] border border-[#EF4444]/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center text-[#EF4444]">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#EDEDEC]">
                  Supprimer le volume APFS
                </h3>
                <p className="text-xs text-[#9B9A97]">
                  Suppression du volume sans toucher aux autres volumes
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#171717] border border-[#2B2B2B] text-xs space-y-1.5">
              <p className="text-[#EDEDEC]">
                Volume : <strong className="font-mono text-[#FCA5A5]">&laquo; {volumeToDelete.name} &raquo;</strong> ({volumeToDelete.bsdName})
              </p>
              <p className="text-[#9B9A97]">
                Point de montage : <span className="font-mono text-[11px]">{volumeToDelete.mountPoint}</span>
              </p>
              <p className="text-[#EF4444] text-[11px] pt-1">
                Le contenu de ce volume sera supprime. Les autres volumes du conteneur ne seront pas affectes.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setVolumeToDelete(null)}
                disabled={isDeletingVolume}
                className="px-4 py-2 rounded-xl bg-[#282828] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC] cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmDeleteVolume}
                disabled={isDeletingVolume}
                className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-50 text-white font-semibold text-xs cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {isDeletingVolume && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isDeletingVolume ? "Suppression..." : "Supprimer definitivement"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ENCRYPT APFS VOLUME */}
      {encryptVolumeTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#202020] border border-[#3B82F6]/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#60A5FA]">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#EDEDEC]">
                    Chiffrer le volume APFS
                  </h3>
                  <p className="text-xs text-[#9B9A97]">
                    Protection native FileVault avec mot de passe
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEncryptVolumeTarget(null)}
                className="text-[#787774] hover:text-[#EDEDEC] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#171717] border border-[#2B2B2B] text-xs">
              <span className="text-[#9B9A97]">Volume cible : </span>
              <strong className="text-[#EDEDEC] font-mono">
                {encryptVolumeTarget.name || "Sans nom"} ({encryptVolumeTarget.bsdName})
              </strong>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Mot de passe de securite
                </label>
                <input
                  type="password"
                  value={volumePassphrase}
                  onChange={(e) => setVolumePassphrase(e.target.value)}
                  placeholder="Minimum 4 caracteres"
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#9B9A97]">
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  value={volumeConfirmPassphrase}
                  onChange={(e) => setVolumeConfirmPassphrase(e.target.value)}
                  placeholder="Ressaisir le mot de passe"
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setEncryptVolumeTarget(null)}
                disabled={isEncryptingVolume}
                className="px-4 py-2 rounded-xl bg-[#282828] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC] cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={handleEncryptVolume}
                disabled={isEncryptingVolume || !volumePassphrase || !volumeConfirmPassphrase}
                className="px-4 py-2 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-semibold text-xs cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {isEncryptingVolume && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isEncryptingVolume ? "Chiffrement..." : "Activer le chiffrement"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiskManagerView;
