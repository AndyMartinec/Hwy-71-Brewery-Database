import type { Metadata, Viewport } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Highway 71 Brewing — Ops",
  description: "Inventory, brew logs, fermentation sheets and Brewfather sync for Highway 71 Brewing.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "H71 Ops", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#14110d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable} h-full`}>
      <body className="min-h-full bg-paper font-sans text-stone-900 antialiased">
        <Nav />
        <div className="md:pl-64">
          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-14 md:pt-10 lg:px-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
