import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactionAttachments, useDeleteAttachment, apiErrorMessage } from "@/api/hooks";
import { uploadAttachment, downloadAttachment } from "@/lib/api-helpers/client";

/**
 * One transaction, in full.
 *
 * It renders CONTENT and no container, which is the whole point: on a wide
 * screen it sits in a card pinned beside the ledger, and on a narrow one the
 * same component slides over it in a sheet. Two containers, one card — so the
 * phone never quietly drifts into being a second, worse design.
 */

export const ORIGIN_LABEL: Record<string, string> = {
  manual: "Manual",
  integration: "Integration",
  recurring_engine: "Recurring",
  import: "Import",
};

export function AttachmentsSection({ transactionId }: { transactionId: string }) {
  const attachments = useTransactionAttachments(transactionId);
  const deleteM = useDeleteAttachment();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const items = attachments.data?.items ?? [];

  async function onPick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      await uploadAttachment(transactionId, file);
      toast.success("Receipt attached");
      qc.invalidateQueries({ queryKey: ["attachments", transactionId] });
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not attach the file"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="t-micro font-semibold text-[color:var(--pl-ink-2)]">Receipts & files</span>
        <Button size="sm" variant="ghost" className="t-micro gap-1" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Attach"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </div>
      {items.length === 0 ? (
        <p className="t-micro text-[color:var(--pl-ink-3)]">No receipts attached. Images or PDFs up to 5 MB.</p>
      ) : (
        <div className="space-y-1">
          {items.map((a) => (
            <div key={a.id} className="t-micro flex items-center gap-2 rounded-lg border border-[color:var(--pl-hairline)] px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{a.filename}</span>
              <span className="shrink-0 text-[color:var(--pl-ink-3)]">{(a.sizeBytes / 1024).toFixed(0)} KB</span>
              <button title="Download" className="text-[color:var(--pl-ink-3)] hover:text-[color:var(--pl-ink)]" onClick={() => downloadAttachment(a.id, a.filename).catch(() => toast.error("Download failed"))}>
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                title="Delete"
                className="text-[color:var(--pl-ink-3)] hover:text-[color:var(--pl-red)]"
                onClick={() => {
                  if (!window.confirm(`Delete ${a.filename}?`)) return;
                  deleteM.mutate(a.id, {
                    onSuccess: () => toast.success("Deleted"),
                    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete")),
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="t-secondary shrink-0">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
