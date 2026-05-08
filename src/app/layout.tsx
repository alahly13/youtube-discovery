import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "YouTube Discovery Research Terminal",
  description: "Manifest-first YouTube public metadata discovery, filtering, saving, exporting, and scoped AI analysis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{const t=localStorage.getItem('youtube-discovery-theme');const d=t?t==='dark':true;document.documentElement.classList.toggle('dark',d)}catch{document.documentElement.classList.add('dark')}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
