import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ledger + Strategist",
  description: "Multi-entity bookkeeping, reporting, and tax strategy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar">
            <div className="logo">
              Ledger + Strategist
              <small>Andersen Group of Companies</small>
            </div>
            <div className="navsec">Books</div>
            <Link href="/">Dashboard</Link>
            <Link href="/entities">Entities &amp; QuickBooks</Link>
            <Link href="/review">Review Queue</Link>
            <Link href="/flags">Anomaly Flags</Link>
            <Link href="/reports">Reports</Link>
            <div className="navsec">Tax Strategy</div>
            <Link href="/intake">Situation Intake</Link>
            <Link href="/strategies">Strategy Library</Link>
            <Link href="/plan">Action Plan</Link>
            <div className="navsec">Close</div>
            <Link href="/close">Month-End &amp; CPA Package</Link>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
