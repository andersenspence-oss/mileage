"use client";
export default function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" className="btn small secondary noprint" onClick={() => window.print()}>{label}</button>;
}
