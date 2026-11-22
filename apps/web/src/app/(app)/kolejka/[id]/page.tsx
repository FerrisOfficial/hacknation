import { Suspense } from "react";
import { CaseWindow } from "./case-window";

export default async function CasePage({ params }: PageProps<"/kolejka/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <CaseWindow key={id} id={id} />
    </Suspense>
  );
}
