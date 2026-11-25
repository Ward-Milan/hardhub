import { CheckCircle2, Unlock, X } from "lucide-react";
import { EjectSvgIcon } from "../Logo";
import type { BlockingProcessInfo, StorageDriveInfo } from "../types";

export interface EjectDoctorModalProps {
  drive: StorageDriveInfo | null;
  blockingProcesses: BlockingProcessInfo[];
  isChecking: boolean;
  isEjecting: boolean;
  onRefresh: (drive: StorageDriveInfo) => void;
  onForceEject: (drive: StorageDriveInfo) => void;
  onClose: () => void;
}

export function EjectDoctorModal({
  drive,
  blockingProcesses,
  isChecking,
  isEjecting,
  onRefresh,
  onForceEject,
  onClose,
}: EjectDoctorModalProps) {
  if (!drive) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Unlock className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-sm font-semibold text-[#EDEDEC]">
              Débloqueur d&apos;Éjection — {drive.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#2C2C2C] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isChecking ? (
            <div className="py-8 text-center text-xs text-[#9B9A97]">
              Inspection des descripteurs ouverts (lsof)…
            </div>
          ) : blockingProcesses.length === 0 ? (
            <div className="p-4 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center gap-3 text-xs text-[#34D399]">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Aucun processus ne retient actuellement « {drive.name} ». Vous pouvez l&apos;éjecter en toute sécurité.
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
              onClick={() => onRefresh(drive)}
              className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] border border-[#383838] text-xs font-medium text-[#EDEDEC] cursor-pointer"
            >
              Revérifier
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#2F2F2F] text-xs text-[#9B9A97] cursor-pointer"
              >
                Annuler
              </button>

              <button
                onClick={() => onForceEject(drive)}
                disabled={isEjecting}
                className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#059669] text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <EjectSvgIcon className="w-3.5 h-3.5" />
                <span>
                  {isEjecting
                    ? "Libération & Éjection…"
                    : "Libérer & Éjecter maintenant"}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
