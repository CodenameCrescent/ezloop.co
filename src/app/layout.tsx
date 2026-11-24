import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "@/index.css";

export const metadata: Metadata = {
  title: "Profit Loop",
  description: "See your real profit — for any kind of business.",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/app-icon-192.png", type: "image/png" }],
    apple: "/app-icon-192.png",
  },
  manifest: "/site.webmanifest",
  openGraph: { images: "/opengraph.jpg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c11" },
  ],
};

/**
 * Theme, applied BEFORE the first paint. React cannot do this: by the time the
 * app hydrates the browser has already painted, so a dark-mode user would get
 * a white flash on every load. Reads the same key next-themes writes, and falls
 * through to the machine's preference if storage is unavailable.
 */
const themeScript = `(function(){try{var s=localStorage.getItem("profit-loop-theme");var d=s==="dark"||((!s||s==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
