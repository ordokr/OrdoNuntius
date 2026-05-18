"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Shared primitive for one-field text-entry modals in the files UI.
 * `NewFolderDialog` and `RenameDialog` were near-duplicates (~60 lines
 * each, identical structure: title + autofocus Input + Cancel/Submit
 * buttons + submit-while-disabled-during-await). Both now thin
 * wrappers over this component.
 *
 * NOT collapsed into a more general dialog primitive: the file-browser
 * variants share a specific UX contract (autofocus, click-outside-to-
 * close, disabled-on-empty/submitting) that's narrower than the
 * generic prompt-dialog at components/ui/prompt-dialog.tsx.
 */
interface TextInputDialogProps {
  /** Initial input value. Pass empty string for create-style dialogs. */
  defaultValue?: string;
  title: string;
  placeholder?: string;
  submitLabel: string;
  cancelLabel: string;
  onConfirm: (value: string) => Promise<void>;
  onCancel: () => void;
}

export function TextInputDialog({
  defaultValue = "",
  title,
  placeholder,
  submitLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: TextInputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-background border border-border rounded-lg shadow-lg p-6 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        <form onSubmit={handleSubmit}>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mb-4"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={!value.trim() || isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
