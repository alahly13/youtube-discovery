import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YouTube Discovery Research Terminal",
  description: "Manifest-first YouTube public metadata discovery, filtering, saving, exporting, and scoped AI analysis.",
  icons: {
    icon: "/browser_tab_icon.png",
  },
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
      className="dark h-full antialiased"
    >
      <body className="min-h-full font-sans">
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
