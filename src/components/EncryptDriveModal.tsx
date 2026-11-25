import { Lock, X } from "lucide-react";
import type { StorageDriveInfo } from "../types";

export interface EncryptDriveModalProps {
  drive: StorageDriveInfo | null;
  passphrase: string;
  confirmPassphrase: string;
  isEncrypting: boolean;
  onPassphraseChange: (val: string) => void;
  onConfirmChange: (val: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function EncryptDriveModal({
  drive,
  passphrase,
  confirmPassphrase,
  isEncrypting,
  onPassphraseChange,
  onConfirmChange,
  onConfirm,
  onClose,
}: EncryptDriveModalProps) {
  if (!drive) return null;

  return (
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
                {drive.name} (/dev/{drive.bsdName})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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
                value={passphrase}
                onChange={(e) => onPassphraseChange(e.target.value)}
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
                value={confirmPassphrase}
                onChange={(e) => onConfirmChange(e.target.value)}
                placeholder="Répétez le mot de passe"
                className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-[#2F2F2F] text-sm text-[#EDEDEC] focus:border-[#3B82F6] focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#2F2F2F] text-xs text-[#9B9A97] cursor-pointer"
            >
              Annuler
            </button>

            <button
              onClick={onConfirm}
              disabled={
                isEncrypting ||
                passphrase.length < 4 ||
                passphrase !== confirmPassphrase
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
  );
}
