import type { Metadata, Viewport } from "next";
import { Poppins, Roboto } from "next/font/google";
import "./globals.css";

const body = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const amount = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-amount",
});

export const metadata: Metadata = {
  title: "Umar Distribution Software",
  description:
    "Multi-company distribution, accounts & inventory system for Pakistan market",
  applicationName: "Umar Distribution Software",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Umar Dist",
  },
};

export const viewport: Viewport = {
  themeColor: "#152238",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body
        className={`${body.variable} ${amount.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
