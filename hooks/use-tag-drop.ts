"use client";

import { useCallback, useState, DragEvent } from "react";
import { useEmailStore } from "@/stores/email-store";
import { useAuthStore } from "@/stores/auth-store";
import { useDragDropContext } from "@/contexts/drag-drop-context";


interface UseTagDropOptions {
  tagId: string;
  onSuccess?: (count: number, tagLabel: string) => void;
  onError?: (error: string) => void;
}

interface UseTagDropReturn {
  dropHandlers: {
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
  };
  isDropTarget: boolean;
  isValidDropTarget: boolean;
}

export function useTagDrop({ tagId, onSuccess, onError }: UseTagDropOptions): UseTagDropReturn {
  const [isOver, setIsOver] = useState(false);
  // Granular selectors instead of whole-store destructure. The previous
  // `{ fetchEmails, fetchTagCounts, selectedMailbox } = useEmailStore()`
  // re-ran every tag-drop hook in the sidebar on every email-store
  // mutation (fetches, mark-as-read, push deltas, selection toggles).
  // With ~10 tag rows this multiplied re-executions during typical
  // inbox usage. Now: subscribe only to selectedMailbox + client; pull
  // stable action refs via getState() at drop time.
  const client = useAuthStore(s => s.client);
  const selectedMailbox = useEmailStore(s => s.selectedMailbox);
  const { isDragging, endDrag } = useDragDropContext();

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isDragging) {
      e.dataTransfer.dropEffect = "copy";
    } else {
      e.dataTransfer.dropEffect = "none";
    }
  }, [isDragging]);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);

    if (!client || !isDragging) {
      endDrag();
      return;
    }

    try {
      const emailIdsJson = e.dataTransfer.getData("application/x-email-ids");
      if (!emailIdsJson) {
        endDrag();
        return;
      }

      const emailIds: string[] = JSON.parse(emailIdsJson);

      // Build id→email Map once instead of `currentEmails.find()` per
      // dropped email (was O(D × E) — quadratic when dragging many
      // emails through a large mailbox).
      const currentEmails = useEmailStore.getState().emails;
      const byId = new Map<string, typeof currentEmails[number]>();
      for (const em of currentEmails) byId.set(em.id, em);
      const labelKey = `$label:${tagId}`;

      // Fire all keyword updates in parallel. Was sequential await in a
      // loop — for N dropped emails that's N round trips. JMAP servers
      // handle each Email/set independently so parallel is safe.
      await Promise.all(emailIds.map(emailId => {
        const email = byId.get(emailId);
        const keywords = { ...(email?.keywords || {}) };
        keywords[labelKey] = true;
        return client.updateEmailKeywords(emailId, keywords);
      }));

      // Refresh the email list + tag counts via stable action refs.
      const { fetchEmails, fetchTagCounts } = useEmailStore.getState();
      await fetchEmails(client, selectedMailbox);
      fetchTagCounts(client);

      onSuccess?.(emailIds.length, tagId);
    } catch (error) {
      console.error("Failed to tag emails:", error);
      onError?.(error instanceof Error ? error.message : "Unknown error");
    } finally {
      endDrag();
    }
  }, [client, isDragging, tagId, selectedMailbox, endDrag, onSuccess, onError]);

  return {
    dropHandlers: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    isDropTarget: isOver && isDragging,
    isValidDropTarget: isOver && isDragging,
  };
}
