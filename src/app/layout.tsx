import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sora } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { Sidebar } from "@/components/ui/Sidebar";
import { TopBar } from "@/components/ui/TopBar";
import { Footer } from "@/components/ui/Footer";
import { Toaster } from "@/components/ui/Toaster";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { SectionTheme } from "@/components/ui/SectionTheme";
import { SessionKeepalive } from "@/components/ui/SessionKeepalive";
import { tryGetServerIdentity } from "@/auth/session";
import { loadNotifications } from "@/domain/notifications/load";

/**
 * Display face for headings. `variable` exposes it as `--font-display-loaded`,
 * which globals.css reads via `--font-display` (with a system-stack fallback so
 * headings still render if the font fails to load).
 */
const display = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PartnerOS",
  description: "AWS Partner management — program readiness, MDF, compliance.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const identity = await tryGetServerIdentity();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const year = now.getFullYear();
  const notifications = identity
    ? (await loadNotifications(identity, today)).items
    : [];

  return (
    <html lang="en" className={display.variable}>
      <body>
        {/* Apply the saved theme + density before paint to avoid a flash of the
            defaults. Keep the storage keys in sync with TopBar. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement;if(localStorage.getItem('partneros:theme')==='dark'){d.setAttribute('data-theme','dark');}if(localStorage.getItem('partneros:density')==='compact'){d.setAttribute('data-density','compact');}var p=(location.pathname.split('/')[1]||'');if({command:1,ace:1,mdf:1,programs:1,plan:1,reports:1}[p]){d.setAttribute('data-section',p);}}catch(e){}})();",
          }}
        />
        {identity ? (
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar email={identity.email} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <TopBar
                email={identity.email}
                role={identity.role}
                notifications={notifications}
              />
              <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
              <Footer year={year} />
            </div>
            <CommandPalette />
            <SectionTheme />
            <SessionKeepalive />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <MarketingNav />
            <div style={{ flex: 1 }}>{children}</div>
            <Footer year={year} />
          </div>
        )}
        <Toaster />
      </body>
    </html>
  );
}
