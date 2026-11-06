import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Gauge,
  Zap,
  HardDrive,
  RefreshCw,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  HeartPulse,
  Thermometer,
  Database,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type {
  FlashTestProgress,
  FlashTestResult,
  SpeedTestResult,
  SsdHealthReport,
  StorageDriveInfo,
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

interface Props {
  drives: StorageDriveInfo[];
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
}

export default function DiagnosticsView({
  drives,
  onShowToast,
  onShowError,
}: Props) {
  const [selectedMountPoint, setSelectedMountPoint] = useState<string>("/");

  // SpeedTest state
  const [speedResult, setSpeedResult] = useState<SpeedTestResult | null>(null);
  const [isRunningSpeed, setIsRunningSpeed] = useState(false);

  // SSD Health S.M.A.R.T. state
  const [ssdHealth, setSsdHealth] = useState<SsdHealthReport | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);

  // Flash Test state
  const externalRemovableDrives = useMemo(
    () => drives.filter((d) => d.isRemovable && !d.isCloud && d.mountPoint !== "/"),
    [drives]
  );
  const [flashTargetId, setFlashTargetId] = useState<string>("");
  const [flashTestMb, setFlashTestMb] = useState<number>(512);
  const [isRunningFlashTest, setIsRunningFlashTest] = useState(false);
  const [flashProgress, setFlashProgress] = useState<FlashTestProgress | null>(null);
  const [flashResult, setFlashResult] = useState<FlashTestResult | null>(null);

  const selectedFlashDrive = useMemo(
    () =>
      externalRemovableDrives.find((d) => d.id === flashTargetId) ||
      externalRemovableDrives[0] ||
      null,
    [externalRemovableDrives, flashTargetId]
  );

  const handleLoadSsdHealth = async (mountPoint: string) => {
    setIsLoadingHealth(true);
    try {
      const rep = await invoke<SsdHealthReport>("get_ssd_health_cmd", {
        mountPoint,
      });
      setSsdHealth(rep);
    } catch (err) {
      console.warn("Could not query S.M.A.R.T. health", err);
      setSsdHealth(null);
    } finally {
      setIsLoadingHealth(false);
    }
  };

  const handleRunSpeedTest = async () => {
    setIsRunningSpeed(true);
    try {
      const res = await invoke<SpeedTestResult>("run_hardware_speedtest", {
        targetPath: selectedMountPoint,
      });
      setSpeedResult(res);
      onShowToast(
        `SpeedTest terminé : ${res.writeMbps} Mo/s écriture • ${res.readMbps} Mo/s lecture`
      );
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsRunningSpeed(false);
    }
  };

  const handleRunFlashTest = async () => {
    if (!selectedFlashDrive) {
      onShowError("Veuillez connecter un support externe amovible pour lancer le test flash.");
      return;
    }
    setIsRunningFlashTest(true);
    setFlashResult(null);
    setFlashProgress({
      stage: "writing",
      percent: 0,
      currentMb: 0,
      totalMb: flashTestMb,
      speedMbps: 0,
      message: "Préparation des mires physiques de test…",
    });

    try {
      const res = await invoke<FlashTestResult>("run_flash_test_cmd", {
        mountPoint: selectedFlashDrive.mountPoint,
        targetMb: flashTestMb,
        isRemovable: selectedFlashDrive.isRemovable,
      });
      setFlashResult(res);
      if (res.isCounterfeit) {
        onShowError(res.verdictDescription);
      } else {
        onShowToast(`Test réussi : ${res.verdictTitle}`);
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsRunningFlashTest(false);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<FlashTestProgress>("flash_test_progress", (event) => {
      setFlashProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Run SSD health check only when selected mount point changes (NOT continuously!)
  useEffect(() => {
    handleLoadSsdHealth(selectedMountPoint);
  }, [selectedMountPoint]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-6 bg-[#191919]">
      {/* ================= TARGET DRIVE SELECTOR ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#282828]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#9B9A97] mr-1">
            Support cible :
          </span>
          {drives
            .filter((d) => !d.isCloud)
            .map((d) => {
              const active = selectedMountPoint === d.mountPoint;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedMountPoint(d.mountPoint)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 border transition-colors cursor-pointer ${
                    active
                      ? "bg-[#3B82F6]/20 border-[#3B82F6]/50 text-[#60A5FA]"
                      : "bg-[#202020] hover:bg-[#282828] border-[#2E2E2E] text-[#EDEDEC]"
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>
                    {d.mountPoint === "/" ? `${d.name} (Mac)` : d.name}
                  </span>
                </button>
              );
            })}
        </div>

        <button
          onClick={() => handleLoadSsdHealth(selectedMountPoint)}
          disabled={isLoadingHealth}
          className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-[#2B2B2B] border border-[#323232] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoadingHealth ? "animate-spin text-[#3B82F6]" : ""}`}
          />
          <span>Actualiser S.M.A.R.T.</span>
        </button>
      </div>

      {/* ================= DIAGNOSTICS GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CARD 1 (12 cols): SANTÉ & USURE SSD EXPRESS */}
        <div className="lg:col-span-12 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center">
                <HeartPulse className="w-4 h-4 text-[#34D399]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Santé &amp; Usure SSD (S.M.A.R.T.)
                </h3>
                <p className="text-[11px] text-[#9B9A97]">
                  Surveillance de la longévité des cellules flash, de l&apos;état matériel et du cumul d&apos;écriture (TBW)
                </p>
              </div>
            </div>

            {ssdHealth && (
              <span
                className={`px-3 py-1 rounded-xl text-xs font-medium border flex items-center gap-1.5 ${
                  ssdHealth.healthPercent >= 90
                    ? "bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30"
                    : ssdHealth.healthPercent >= 70
                    ? "bg-[#F59E0B]/15 text-[#FBBF24] border-[#F59E0B]/30"
                    : "bg-[#EF4444]/15 text-[#F87171] border-[#EF4444]/30"
                }`}
              >
                {ssdHealth.healthPercent >= 90 ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5" />
                )}
                <span>
                  {ssdHealth.healthPercent >= 90
                    ? "Santé Optimale"
                    : ssdHealth.healthPercent >= 70
                    ? "État Correct"
                    : "Usure Avancée"}
                </span>
              </span>
            )}
          </div>

          {isLoadingHealth && !ssdHealth ? (
            <div className="py-8 text-center text-xs text-[#9B9A97] flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#10B981]" />
              <span>Interrogation des registres S.M.A.R.T. et du contrôleur flash…</span>
            </div>
          ) : ssdHealth ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Health Score */}
              <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#9B9A97] mb-1">
                    <span>Indicateur de Santé</span>
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#222222] text-[#EDEDEC]">
                      S.M.A.R.T. {ssdHealth.smartStatus}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-2 my-2">
                    <span
                      className={`text-4xl font-extrabold font-mono tracking-tight ${
                        ssdHealth.healthPercent >= 90
                          ? "text-[#34D399]"
                          : ssdHealth.healthPercent >= 70
                          ? "text-[#FBBF24]"
                          : "text-[#F87171]"
                      }`}
                    >
                      {ssdHealth.healthPercent}%
                    </span>
                    <span className="text-xs text-[#9B9A97]">d&apos;espérance de vie</span>
                  </div>

                  <div className="h-2 rounded-full bg-[#262626] overflow-hidden mb-3">
                    <div
                      style={{ width: `${Math.min(100, Math.max(5, ssdHealth.healthPercent))}%` }}
                      className={`h-full transition-all duration-300 ${
                        ssdHealth.healthPercent >= 90
                          ? "bg-[#10B981]"
                          : ssdHealth.healthPercent >= 70
                          ? "bg-[#F59E0B]"
                          : "bg-[#EF4444]"
                      }`}
                    />
                  </div>

                  <div className="text-xs font-semibold text-[#EDEDEC]">
                    {ssdHealth.statusVerdict}
                  </div>
                </div>

                <p className="text-[11px] text-[#9B9A97] leading-relaxed pt-2 border-t border-[#242424]">
                  {ssdHealth.statusAdvice}
                </p>
              </div>

              {/* 2. Cumulative TBW & Wear */}
              <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#9B9A97] mb-1">
                    <span>Endurance Écrite (TBW)</span>
                    <span className="text-[11px] font-mono text-[#EDEDEC]">
                      {ssdHealth.tbwWritten.toFixed(1)} / {ssdHealth.ratedTbw} To
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 my-2">
                    <span className="text-2xl font-bold font-mono text-[#EDEDEC]">
                      {ssdHealth.tbwWritten.toFixed(1)} To
                    </span>
                    <span className="text-xs text-[#787774]">écrits à ce jour</span>
                  </div>

                  <div className="h-2 rounded-full bg-[#262626] overflow-hidden mb-2">
                    <div
                      style={{
                        width: `${Math.min(100, (ssdHealth.tbwWritten / ssdHealth.ratedTbw) * 100)}%`,
                      }}
                      className="h-full bg-[#3B82F6] transition-all duration-300"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#787774]">
                    <span>Usure endurance constructeur</span>
                    <span className="font-mono text-[#EDEDEC]">
                      {((ssdHealth.tbwWritten / ssdHealth.ratedTbw) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#242424] space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#9B9A97]">Données lues :</span>
                    <span className="font-mono text-[#EDEDEC]">{ssdHealth.tbrRead.toFixed(1)} To</span>
                  </div>
                  <p className="text-[10px] text-[#787774] leading-tight">
                    Basé sur la norme d&apos;endurance standard de {ssdHealth.ratedTbw} TBW pour cette capacité.
                  </p>
                </div>
              </div>

              {/* 3. Hardware sensors */}
              <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3 text-xs">
                <div className="space-y-2">
                  <div className="text-xs text-[#9B9A97]">Télémétrie Matérielle Directe</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#202020] border border-[#282828]">
                      <span className="text-[#9B9A97] flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-[#F59E0B]" />
                        <span>Température</span>
                      </span>
                      <span className="font-mono font-bold text-[#EDEDEC]">
                        {ssdHealth.temperatureCelsius !== null && ssdHealth.temperatureCelsius !== undefined ? `${ssdHealth.temperatureCelsius} °C` : "N/A"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#202020] border border-[#282828]">
                      <span className="text-[#9B9A97] flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-[#3B82F6]" />
                        <span>Erreurs de lecture / I/O</span>
                      </span>
                      <span className="font-mono font-bold text-[#EDEDEC]">
                        {ssdHealth.errorsCount} erreur(s)
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#202020] border border-[#282828]">
                      <span className="text-[#9B9A97]">Données lues (cumul)</span>
                      <span className="font-mono text-[#EDEDEC]">
                        {ssdHealth.tbrRead ? `${ssdHealth.tbrRead} To` : formatBytes(ssdHealth.bytesRead)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-[#787774] font-mono truncate pt-2 border-t border-[#242424]">
                  {ssdHealth.modelName || ssdHealth.bsdName}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] text-center">
              Impossible d&apos;interroger les métriques S.M.A.R.T. sur ce support.
            </div>
          )}
        </div>

        {/* CARD 2 (6 cols): SPEEDTEST MATÉRIEL */}
        <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center">
                  <Gauge className="w-4 h-4 text-[#60A5FA]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    SpeedTest Matériel (Direct I/O)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Mesure hors-cache RAM (F_NOCACHE) du support actif
                  </p>
                </div>
              </div>

              <button
                onClick={handleRunSpeedTest}
                disabled={isRunningSpeed}
                className="px-3 py-1.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isRunningSpeed ? "Test…" : "Tester"}</span>
              </button>
            </div>

            {speedResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[#171717] border border-[#2A2A2A]">
                    <span className="text-[11px] text-[#9B9A97] block">
                      Écriture réelle
                    </span>
                    <span className="text-lg font-bold font-mono text-[#10B981]">
                      {speedResult.writeMbps} Mo/s
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#171717] border border-[#2A2A2A]">
                    <span className="text-[11px] text-[#9B9A97] block">
                      Lecture réelle
                    </span>
                    <span className="text-lg font-bold font-mono text-[#60A5FA]">
                      {speedResult.readMbps} Mo/s
                    </span>
                  </div>
                </div>

                <div
                  className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                    speedResult.isUsb2Limited
                      ? "bg-[#EF4444]/15 border-[#EF4444]/40 text-[#FCA5A5]"
                      : "bg-[#161616] border-[#2C2C2C] text-[#EDEDEC]"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                  <span>{speedResult.capabilityVerdict}</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774]">
                Cliquez sur « Tester » pour mesurer le débit réel de lecture et d&apos;écriture du support sélectionné.
              </div>
            )}
          </div>
        </div>

        {/* CARD 3 (6 cols): TEST D'AUTHENTICITÉ FLASH ANTI-CONTREFAÇON */}
        <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#06B6D4]/15 border border-[#06B6D4]/30 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-[#22D3EE]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Test d&apos;Authenticité Flash
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Détecte les clés et cartes SD contrefaites (fausse capacité)
                  </p>
                </div>
              </div>

              {externalRemovableDrives.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={flashTargetId || (selectedFlashDrive ? selectedFlashDrive.id : "")}
                    onChange={(e) => setFlashTargetId(e.target.value)}
                    disabled={isRunningFlashTest}
                    className="px-2.5 py-1 rounded-lg bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                  >
                    {externalRemovableDrives.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({formatBytes(d.totalBytes)})
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleRunFlashTest}
                    disabled={isRunningFlashTest || !selectedFlashDrive}
                    className="px-3 py-1.5 rounded-xl bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{isRunningFlashTest ? "Test…" : "Vérifier"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Test progress or results */}
            {externalRemovableDrives.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] text-center">
                Branchez une clé USB ou carte SD pour tester l&apos;authenticité de la mémoire flash.
              </div>
            ) : isRunningFlashTest && flashProgress ? (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#292929] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#EDEDEC]">
                    {flashProgress.message}
                  </span>
                  <span className="font-mono text-[#22D3EE] font-bold">
                    {Math.round(flashProgress.percent)}% • {flashProgress.speedMbps} Mo/s
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#262626] overflow-hidden">
                  <div
                    style={{ width: `${flashProgress.percent}%` }}
                    className="h-full bg-[#06B6D4] transition-all duration-200"
                  />
                </div>
              </div>
            ) : flashResult ? (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                  flashResult.isCounterfeit
                    ? "bg-[#251515] border-[#EF4444]/40"
                    : "bg-[#15231D] border-[#10B981]/40"
                }`}
              >
                <div className="flex items-center gap-3">
                  {flashResult.isCounterfeit ? (
                    <ShieldAlert className="w-5 h-5 text-[#EF4444] shrink-0" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-[#10B981] shrink-0" />
                  )}
                  <div>
                    <h4
                      className={`text-xs font-bold ${
                        flashResult.isCounterfeit ? "text-[#F87171]" : "text-[#34D399]"
                      }`}
                    >
                      {flashResult.verdictTitle}
                    </h4>
                    <p className="text-[11px] text-[#9B9A97]">
                      {flashResult.verdictDescription}
                    </p>
                  </div>
                </div>

                <span className="text-xs font-mono font-semibold text-[#EDEDEC] shrink-0">
                  {flashResult.writeSpeedMbps} Mo/s
                </span>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774]">
                100% non destructif : écrit des mires de contrôle pour s&apos;assurer que la capacité n&apos;est pas piratée.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
