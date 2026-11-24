import { redirect } from "next/navigation";
import { googleEnabled } from "@/lib/api/functions/auth/options";
import { currentUserId } from "@/lib/api/functions/session";
import { SignUpForm } from "@/views/auth/AuthForms";

export default async function SignUpPage() {
  if (await currentUserId()) redirect("/dashboard");
  return <SignUpForm googleEnabled={googleEnabled()} />;
}
