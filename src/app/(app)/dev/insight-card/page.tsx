"use client";

import { notFound } from "next/navigation";
import View from "@/views/dev/InsightCardGallery";

/** A bench for looking at one component on its own — never served in production. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <View />;
}
