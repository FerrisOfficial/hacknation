import type { Metadata } from "next";
import { KitShowcase } from "./kit-showcase";

export const metadata: Metadata = {
  title: "Kit Gov.pl",
  description: "Podgląd komponentów Gov.pl (tokeny z Figmy)",
};

export default function KitPage() {
  return <KitShowcase />;
}
