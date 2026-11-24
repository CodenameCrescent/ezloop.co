import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/api/functions/session";
import Landing from "./landing";

/**
 * The front door. A visitor gets the landing page; anyone signed in goes
 * straight to the app, where the business gate decides which books to open.
 */
export default async function Home() {
  if (await currentUserId()) redirect("/dashboard");
  return <Landing />;
}
