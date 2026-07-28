import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JobFinder",
  description: "Personal AI job finder",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/autoapply", label: "Auto Apply LinkedIn" },
  { href: "/autoapply-indeed", label: "Auto Apply Indeed" },
  { href: "/applications", label: "Applied" },
  { href: "/settings", label: "Settings" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-[var(--surface)]/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-6">
            <Link
              href="/"
              className="text-[15px] font-semibold tracking-tight text-slate-100"
            >
              JobFinder
            </Link>
            <nav className="flex items-center gap-1 sm:gap-2">
              {nav.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-slate-100 sm:px-3"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-5 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
