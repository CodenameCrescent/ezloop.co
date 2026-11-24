import { useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiErrorMessage, useDeleteAccount } from "@/api/hooks";

const CONFIRM_WORD = "DELETE";

/**
 * Close the account for good: every business, every record, the sign-in.
 *
 * Different from "Erase all data" above it, which empties ONE business and
 * keeps you signed in. This one is the way out, and app stores require it to
 * be reachable from inside the app rather than by email.
 *
 * Typing the word is the brake. A click-through dialog is one reflex away from
 * the button that opened it, and there is no undo behind this one.
 */
export function DeleteAccountRow() {
  if (process.env.NEXT_PUBLIC_LOCAL_AUTH_BYPASS === "true") {
    // No session locally: the next load simply starts a fresh, empty account.
    return <DeleteAccount onDeleted={async () => window.location.assign("/")} />;
  }
  return <SessionDeleteAccount />;
}

function SessionDeleteAccount() {
  return (
    <DeleteAccount
      onDeleted={async () => {
        // The server already removed the Supabase user; this clears the cookie.
        // If signOut fails the destination is the same.
        try {
          await signOut({ callbackUrl: "/" });
        } catch {
          window.location.assign("/");
        }
      }}
    />
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const del = useDeleteAccount();
  const confirmed = typed.trim() === CONFIRM_WORD;

  const close = (next: boolean) => {
    if (del.isPending) return;
    setOpen(next);
    if (!next) setTyped("");
  };

  const handleDelete = () => {
    del.mutate(undefined, {
      onSuccess: async () => {
        toast.success("Your account has been deleted.");
        await onDeleted();
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Your account could not be deleted. Please try again.")),
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <Label className="text-sm">Delete account</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Close your account and erase every business and record in it
          </p>
        </div>
        <div className="shrink-0">
          <Button variant="destructive" className="gap-2" onClick={() => setOpen(true)}>
            <UserX className="h-4 w-4" /> Delete account
          </Button>
        </div>
      </div>

      <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This erases every business you have in Profit Loop — all sales, costs, receipts, people and
                  connected stores — and closes your sign-in. It cannot be undone.
                </p>
                <p>
                  Want a copy first?{" "}
                  <Link href="/reports/overview" className="font-medium underline" onClick={() => close(false)}>
                    Download your reports
                  </Link>{" "}
                  before you go.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-account-confirm" className="text-sm">
              Type {CONFIRM_WORD} to confirm
            </Label>
            <Input
              id="delete-account-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={del.isPending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            {/* A plain Button, not AlertDialogAction: that one closes the dialog
                on click, which would hide the spinner and any error. */}
            <Button variant="destructive" disabled={!confirmed || del.isPending} onClick={handleDelete} className="gap-2">
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete my account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
