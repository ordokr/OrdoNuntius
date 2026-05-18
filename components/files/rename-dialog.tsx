"use client";

import { useTranslations } from "next-intl";
import { TextInputDialog } from "./text-input-dialog";

interface RenameDialogProps {
  currentName: string;
  title?: string;
  label?: string;
  onConfirm: (newName: string) => Promise<void>;
  onCancel: () => void;
}

export function RenameDialog({ currentName, title, label, onConfirm, onCancel }: RenameDialogProps) {
  const t = useTranslations("files");
  return (
    <TextInputDialog
      defaultValue={currentName}
      title={title || t("rename_title")}
      placeholder={label || t("new_name")}
      submitLabel={t("save")}
      cancelLabel={t("cancel")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
