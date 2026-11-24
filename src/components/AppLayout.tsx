import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { DUR, EASE_OUT, useMotionPrefs } from "@/lib/motion";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = usePathname();
  const { reduced } = useMotionPrefs();

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      {/* scrollbar-gutter keeps the scrollbar's width reserved even on short
          pages, so the period filter in PageHeader lands on the same pixel
          whether or not the page happens to scroll. */}
      <main
        className="app-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-24 sm:pb-0"
        style={{ scrollbarGutter: "stable" }}
      >
        {/*
          One short fade per navigation, keyed on the route.

          Six pixels and 220ms — just enough to say "this is a different page"
          without making anyone wait to read it. There is no exit animation on
          purpose: waiting for the old page to leave before the new one arrives
          is what makes app transitions feel slow, and this app is a tool.
        */}
        <motion.div
          key={location}
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
