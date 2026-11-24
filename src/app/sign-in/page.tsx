import { Suspense } from "react";
import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/api/functions/auth/options";
import { currentUserId } from "@/lib/api/functions/session";
import { SignInForm } from "@/views/auth/AuthForms";

export default async function SignInPage() {
  if (await currentUserId()) redirect("/dashboard");
  return (
    <Suspense>
      <SignInForm googleEnabled={googleEnabled()} />
    </Suspense>
  );
}
