import { Suspense } from "react";
import { Entity } from "./entity";

export default function EntityPage() {
  return (
    <Suspense>
      <Entity />
    </Suspense>
  );
}
