import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: {
    default: "GigaCAD: version control for SolidWorks projects",
    template: "%s | GigaCAD",
  },
  description:
    "Branches, locked releases, and full history for your CAD files, in a drive in File Explorer.",
  metadataBase: new URL("https://gigacad.site"),
};

export const viewport: Viewport = {
  themeColor: "#0A2922",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
