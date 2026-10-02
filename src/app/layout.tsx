import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cue & Rail — Billiard Booking & Table Management",
  description:
    "Sistem booking dan operasional meja untuk tempat billiard. Ketersediaan real-time, DP wajib via QRIS atau cash, check-in, dan session monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}