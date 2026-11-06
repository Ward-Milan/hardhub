import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Package,
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldAlert,
  Shield,
  Check,
  CheckSquare,
  Square,
  AlertTriangle,
  Power,
  Layers,
  HardDrive,
  Folder,
  File,
  X,
  AppWindow,
  Zap,
  Box,
  Sliders,
  FileText,
} from "lucide-react";
import ScanningRadar from "./ScanningRadar";
import type {
  AppDetails,
  AppResidualItem,
  InstalledAppSummary,
  UninstallReport,
} from "./types";

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

function CategoryIcon({
  category,
  className = "w-4 h-4",
}: {
  category: string;
  className?: string;
}) {
  switch (category) {
    case "app_bundle":
      return <AppWindow className={`${className} text-[#06B6D4]`} />;
    case "app_support":
      return <Folder className={`${className} text-[#3B82F6]`} />;
    case "caches":
      return <Zap className={`${className} text-[#F59E0B]`} />;
    case "containers":
      return <Box className={`${className} text-[#8B5CF6]`} />;
    case "preferences":
      return <Sliders className={`${className} text-[#10B981]`} />;
    case "logs":
      return <FileText className={`${className} text-[#EC4899]`} />;
    default:
      return <File className={`${className} text-[#9B9A97]`} />;
  }
}

interface Props {
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
  onRefreshDrives: () => void;
}

export default function UninstallerView({
  onShowToast,
  onShowError,
  onRefreshDrives,
}: Props) {
  const [apps, setApps] = useState<InstalledAppSummary[]>([]);
  const [selectedAppPath, setSelectedAppPath] = useState<string | null>(null);
  const [appDetails, setAppDetails] = useState<AppDetails | null>(null);

  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "large" | "running">(
    "all"
  );

  const [moveToTrash, setMoveToTrash] = useState(true);
  const [confirmUninstallModal, setConfirmUninstallModal] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);

  const loadApps = async () => {
    setIsLoadingList(true);
    try {
      const list = await invoke<InstalledAppSummary[]>("list_installed_apps");
      setApps(list);
      if (!selectedAppPath && list.length > 0) {
        // Default to first non-system app
        const first = list.find((a) => !a.isSystemProtected) || list[0];
        setSelectedAppPath(first.appPath);
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    loadApps();
  }, []);

  const loadDetails = async (path: string) => {
    setIsLoadingDetails(true);
    try {
      const details = await invoke<AppDetails>("get_app_uninstall_details", {
        appPath: path,
      });
      setAppDetails(details);
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (selectedAppPath) {
      loadDetails(selectedAppPath);
    }
  }, [selectedAppPath]);

  const filteredApps = useMemo(() => {
    let list = apps;
    if (filterMode === "large") {
      list = list.filter((a) => a.totalFootprintBytes >= 1024 * 1024 * 1024); // >= 1 GB
    } else if (filterMode === "running") {
      list = list.filter((a) => a.isRunning);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.bundleId.toLowerCase().includes(q)
      );
    }
    return list;
  }, [apps, filterMode, searchQuery]);

  const toggleItemSelection = (path: string) => {
    if (!appDetails) return;
    setAppDetails({
      ...appDetails,
      items: appDetails.items.map((it) =>
        it.path === path ? { ...it, isSelected: !it.isSelected } : it
      ),
    });
  };

  const selectedItems = useMemo(() => {
    if (!appDetails) return [];
    return appDetails.items.filter((it) => it.isSelected);
  }, [appDetails]);

  const selectedBytesToFree = useMemo(() => {
    return selectedItems.reduce((acc, it) => acc + it.sizeBytes, 0);
  }, [selectedItems]);

  const handleQuitApp = async () => {
    if (!selectedAppPath) return;
    try {
      await invoke("quit_app_cmd", { appPath: selectedAppPath });
      onShowToast("Ordre de fermeture envoyé à l'application.");
      await loadDetails(selectedAppPath);
      await loadApps();
    } catch (err) {
      onShowError(String(err));
    }
  };

  const handleExecuteUninstall = async () => {
    if (!appDetails || selectedItems.length === 0) return;
    setIsUninstalling(true);
    try {
      const paths = selectedItems.map((it) => it.path);
      const res = await invoke<UninstallReport>("uninstall_app_cmd", {
        appPath: appDetails.app.appPath,
        pathsToDelete: paths,
        moveToTrash,
      });

      setConfirmUninstallModal(false);
      if (res.errors.length > 0) {
        onShowError(res.errors.join(" • "));
      }
      if (res.deletedItemsCount > 0) {
        onShowToast(
          `« ${res.appName} » et ses résidus nettoyés (${formatBytes(
            res.freedBytes
          )} libérés)`
        );
      }
      onRefreshDrives();
      setSelectedAppPath(null);
      setAppDetails(null);
      await loadApps();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsUninstalling(false);
    }
  };

  const handleRevealFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      onShowError(String(err));
    }
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#191919]">
      {/* ================= LEFT COLUMN: APPS LIST (5 cols) ================= */}
      <div className="w-80 md:w-96 border-r border-[#262626] bg-[#161616] flex flex-col min-h-0 overflow-hidden shrink-0">
        {/* Search & Refresh */}
        <div className="p-3 border-b border-[#242424] space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#787774] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher une application…"
              className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-[#202020] border border-[#2E2E2E] focus:border-[#06B6D4] focus:outline-none text-xs text-[#EDEDEC] placeholder-[#787774]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#787774] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 bg-[#121212] p-0.5 rounded-lg border border-[#262626]">
              <button
                onClick={() => setFilterMode("all")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                  filterMode === "all"
                    ? "bg-[#252525] text-[#EDEDEC]"
                    : "text-[#9B9A97] hover:text-[#EDEDEC]"
                }`}
              >
                Toutes ({apps.length})
              </button>
              <button
                onClick={() => setFilterMode("large")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                  filterMode === "large"
                    ? "bg-[#252525] text-[#EDEDEC]"
                    : "text-[#9B9A97] hover:text-[#EDEDEC]"
                }`}
              >
                &gt; 1 Go
              </button>
              <button
                onClick={() => setFilterMode("running")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                  filterMode === "running"
                    ? "bg-[#252525] text-[#EDEDEC]"
                    : "text-[#9B9A97] hover:text-[#EDEDEC]"
                }`}
              >
                Ouvertes
              </button>
            </div>

            <button
              onClick={loadApps}
              disabled={isLoadingList}
              className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#222222] cursor-pointer"
              title="Actualiser la liste"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isLoadingList ? "animate-spin text-[#06B6D4]" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Scrollable Apps List */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {isLoadingList && apps.length === 0 ? (
            <div className="py-8">
              <ScanningRadar
                icon={<Package className="w-8 h-8 text-[#06B6D4]" />}
                title="Inventaire des applications..."
                color="cyan"
                stages={[
                  "Parcours de /Applications et ~/Applications...",
                  "Extraction des architectures (Apple Silicon / Intel)...",
                  "Calcul de la taille des bundles et binaires...",
                ]}
              />
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="py-16 text-center text-xs text-[#787774]">
              Aucune application trouvée.
            </div>
          ) : (
            filteredApps.map((app) => {
              const isSelected = selectedAppPath === app.appPath;
              return (
                <div
                  key={app.id}
                  onClick={() => setSelectedAppPath(app.appPath)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected
                      ? "bg-[#222222] border-[#06B6D4]/50 shadow-md"
                      : "bg-[#1B1B1B] hover:bg-[#202020] border-[#272727]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-lg bg-[#242424] border border-[#333333] flex items-center justify-center shrink-0 overflow-hidden">
                      {app.iconDataUrl ? (
                        <img
                          src={app.iconDataUrl}
                          alt={app.name}
                          className="w-full h-full object-contain"
                        />
                      ) : app.isSystemProtected ? (
                        <Shield className="w-4 h-4 text-[#FCA5A5]" />
                      ) : (
                        <Package className="w-4 h-4 text-[#9B9A97]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-[#EDEDEC] truncate">
                          {app.name}
                        </span>
                        {app.isRunning && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" title="En cours d'exécution" />
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[#787774] truncate">
                        {app.version} • {app.residualsCount} résidu(s)
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-mono font-semibold text-[#EDEDEC] shrink-0">
                    {formatBytes(app.totalFootprintBytes)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= RIGHT COLUMN: APP INSPECTOR / RESIDUALS CLEANER ================= */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
        {isLoadingDetails ? (
          <ScanningRadar
            icon={<Layers className="w-8 h-8 text-[#06B6D4]" />}
            title="Cartographie des residus associes..."
            color="cyan"
            stages={[
              "Exploration de ~/Library/Application Support...",
              "Detection des conteneurs sandbox et preferences...",
              "Identification des caches et rapports de plantage...",
            ]}
          />
        ) : !appDetails ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-[#787774]">
            Sélectionnez une application à gauche pour inspecter son empreinte et ses résidus.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-5 border-b border-[#262626] bg-[#171717] flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-[#222222] border border-[#353535] flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                  {appDetails.app.iconDataUrl ? (
                    <img
                      src={appDetails.app.iconDataUrl}
                      alt={appDetails.app.name}
                      className="w-10 h-10 object-contain"
                    />
                  ) : appDetails.app.isSystemProtected ? (
                    <Shield className="w-6 h-6 text-[#FCA5A5]" />
                  ) : (
                    <Package className="w-6 h-6 text-[#9B9A97]" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#EDEDEC] truncate">
                      {appDetails.app.name}
                    </h2>
                    <span className="text-xs font-mono text-[#9B9A97]">
                      v{appDetails.app.version}
                    </span>
                    {appDetails.app.isSystemProtected && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] font-medium">
                        Système Apple (Protégée)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-[#787774] truncate mt-0.5">
                    {appDetails.app.bundleId || appDetails.app.appPath}
                  </p>
                </div>
              </div>

              {/* Running alert & quit button */}
              <div className="flex items-center gap-2 shrink-0">
                {appDetails.app.isRunning && (
                  <button
                    onClick={handleQuitApp}
                    className="px-3 py-1.5 rounded-xl bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/35 text-xs font-medium text-[#FBBF24] flex items-center gap-1.5 cursor-pointer"
                    title="Envoyer un signal de fermeture"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>Quitter l&apos;app</span>
                  </button>
                )}

                <button
                  onClick={() => handleRevealFinder(appDetails.app.appPath)}
                  className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-[#2B2B2B] border border-[#333333] text-xs font-medium text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Finder</span>
                </button>
              </div>
            </div>

            {/* System Protected Warning */}
            {appDetails.app.isSystemProtected && (
              <div className="mx-5 mt-4 p-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center gap-2.5 text-xs text-[#FCA5A5] shrink-0">
                <ShieldAlert className="w-4 h-4 text-[#EF4444] shrink-0" />
                <span>
                  Cette application fait partie intégrante de macOS ou du système Apple. Sa désinstallation est verrouillée par sécurité.
                </span>
              </div>
            )}

            {/* Checklist Header */}
            <div className="px-5 py-2.5 border-b border-[#242424] flex items-center justify-between text-xs text-[#9B9A97] shrink-0">
              <span>
                Fichiers &amp; Résidus détectés ({appDetails.items.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setAppDetails({
                      ...appDetails,
                      items: appDetails.items.map((it) => ({
                        ...it,
                        isSelected: true,
                      })),
                    })
                  }
                  className="hover:text-[#EDEDEC] cursor-pointer"
                >
                  Tout cocher
                </button>
                <span>•</span>
                <button
                  onClick={() =>
                    setAppDetails({
                      ...appDetails,
                      items: appDetails.items.map((it) => ({
                        ...it,
                        isSelected: false,
                      })),
                    })
                  }
                  className="hover:text-[#EDEDEC] cursor-pointer"
                >
                  Tout décocher
                </button>
              </div>
            </div>

            {/* Residuals Checklist */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {appDetails.items.map((item) => (
                <div
                  key={item.path}
                  onClick={() =>
                    !appDetails.app.isSystemProtected &&
                    toggleItemSelection(item.path)
                  }
                  className={`p-3 rounded-xl border transition-colors flex items-center justify-between gap-3 ${
                    appDetails.app.isSystemProtected
                      ? "opacity-60 bg-[#1A1A1A] border-[#262626]"
                      : item.isSelected
                      ? "bg-[#222222] border-[#06B6D4]/40 cursor-pointer"
                      : "bg-[#181818] border-[#262626] cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {!appDetails.app.isSystemProtected && (
                      <div className="shrink-0 text-[#9B9A97]">
                        {item.isSelected ? (
                          <CheckSquare className="w-4 h-4 text-[#06B6D4]" />
                        ) : (
                          <Square className="w-4 h-4 text-[#555555]" />
                        )}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <CategoryIcon
                          category={item.category}
                          className="w-4 h-4 shrink-0"
                        />
                        <span className="text-xs font-semibold text-[#EDEDEC] truncate">
                          {item.label}
                        </span>
                        {item.category === "app_bundle" && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#06B6D4]/15 text-[#38BDF8]">
                            Binaire .app
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                        {item.path}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-[#EDEDEC]">
                      {formatBytes(item.sizeBytes)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevealFinder(item.path);
                      }}
                      className="p-1 rounded-lg text-[#787774] hover:text-[#EDEDEC] hover:bg-[#2A2A2A] cursor-pointer"
                      title="Révéler dans le Finder"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Action Bar */}
            {!appDetails.app.isSystemProtected && (
              <div className="px-5 py-3 border-t border-[#2A2A2A] bg-[#161616] flex items-center justify-between gap-4 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#EDEDEC]">
                      {selectedItems.length} élément(s) sélectionné(s)
                    </span>
                    <span className="text-xs font-mono font-bold text-[#38BDF8]">
                      • {formatBytes(selectedBytesToFree)} à libérer
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-[11px] text-[#9B9A97] cursor-pointer mt-0.5">
                    <input
                      type="checkbox"
                      checked={moveToTrash}
                      onChange={(e) => setMoveToTrash(e.target.checked)}
                      className="accent-[#10B981] rounded"
                    />
                    <span>Déplacer dans la Corbeille (récupérable)</span>
                  </label>
                </div>

                <button
                  onClick={() => setConfirmUninstallModal(true)}
                  disabled={selectedItems.length === 0}
                  className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    Désinstaller proprement ({formatBytes(selectedBytesToFree)})
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ================= CONFIRM UNINSTALL MODAL ================= */}
      {confirmUninstallModal && appDetails && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Désinstaller {appDetails.app.name} ?
                </h3>
              </div>
              <button
                onClick={() => setConfirmUninstallModal(false)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#9B9A97]">
                L&apos;application ainsi que tous ses résidus sélectionnés ({selectedItems.length} éléments) seront {moveToTrash ? "déplacés dans la Corbeille" : "supprimés définitivement"} pour libérer{" "}
                <strong className="text-[#38BDF8] font-mono">
                  {formatBytes(selectedBytesToFree)}
                </strong>
                .
              </p>

              <div className="max-h-40 overflow-y-auto space-y-1 p-2 rounded-xl bg-[#161616] border border-[#282828]">
                {selectedItems.map((it) => (
                  <div
                    key={it.path}
                    className="flex items-center justify-between text-xs gap-2 px-1"
                  >
                    <span className="truncate text-[#EDEDEC] font-mono text-[11px]">
                      {it.label}
                    </span>
                    <span className="font-mono text-[#9B9A97] shrink-0 text-[11px]">
                      {formatBytes(it.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmUninstallModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecuteUninstall}
                  disabled={isUninstalling}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isUninstalling
                      ? "Désinstallation…"
                      : `Désinstaller (${formatBytes(selectedBytesToFree)})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

