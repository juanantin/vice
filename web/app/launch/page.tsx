import type { Metadata } from "next";
import Launch from "../../components/Launch";

export const metadata: Metadata = { title: "Launch", robots: { index: false, follow: false } };

export default function LaunchPage() {
  return <Launch />;
}
