import { redirect } from "next/navigation";

/** `/m` has no content of its own — the availability picker is the landing view. */
export default function MobileIndex() {
  redirect("/m/meja");
}
