import type { Metadata, Viewport } from "next";

import { MobilePicker } from "@/components/mobilePicker.tsx";
import { MobileShell } from "@/components/mobile.tsx";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = {
  title: "Cari Meja — Cue & Rail",
  description: "Cek meja billiard yang kosong dan kunci dengan DP.",
};

export const dynamic = "force-dynamic";

/**
 * Mobile viewport.
 *
 * `viewport-fit=cover` plus the safe-area padding in MobileShell is what keeps the
 * tab bar clear of the iOS home indicator. `maximum-scale=1` matches the Stitch
 * screens — the layout is designed for a fixed scale, and pinch-zoom on the date
 * strip fights the horizontal scroller.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fbf9f5",
};

/** Mobile availability — mobile_table_availability_instant_hold. */
export default async function MobileMejaPage() {
  const settings = await getSettings();
  const today = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);

  return (
    <MobileShell
      active="/m/meja"
      title="Cari Meja"
      subtitle={`${settings.venueName} · DP ${settings.depositPercent}%`}
    >
      <MobilePicker today={today} />
    </MobileShell>
  );
}
