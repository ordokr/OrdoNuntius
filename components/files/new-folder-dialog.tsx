"use client";

import { useTranslations } from "next-intl";
import { TextInputDialog } from "./text-input-dialog";

interface NewFolderDialogProps {
  onConfirm: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function NewFolderDialog({ onConfirm, onCancel }: NewFolderDialogProps) {
  const t = useTranslations("files");
  return (
    <TextInputDialog
      title={t("new_folder")}
      placeholder={t("new_folder_name")}
      submitLabel={t("create")}
      cancelLabel={t("cancel")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
