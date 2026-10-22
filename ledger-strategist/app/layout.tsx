import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ledger + Strategist",
  description: "Multi-entity bookkeeping for QuickBooks 2016, reporting, and tax strategy",
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
            <div className="navsec">Bookkeeping</div>
            <Link href="/books">Bookkeeping Home</Link>
            <Link href="/import">Import Bank &amp; Card</Link>
            <Link href="/review">Review Queue</Link>
            <Link href="/payroll">Payroll (ADP)</Link>
            <Link href="/reconcile">Reconcile</Link>
            <Link href="/quickbooks">QuickBooks 2016</Link>
            <div className="navsec">Books &amp; Reports</div>
            <Link href="/">Dashboard</Link>
            <Link href="/reports">Reports</Link>
            <Link href="/flags">Anomaly Flags</Link>
            <Link href="/receipts">Receipts</Link>
            <Link href="/mileage">Mileage &amp; Vehicles</Link>
            <Link href="/travel">Travel &amp; Per Diem</Link>
            <Link href="/entities">Entities</Link>
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
