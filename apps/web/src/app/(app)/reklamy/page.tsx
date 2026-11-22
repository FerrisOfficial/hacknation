import { Suspense } from "react";
import { AdRegistry } from "./registry";

export default function AdsPage() {
  return (
    <Suspense>
      <AdRegistry />
    </Suspense>
  );
}
