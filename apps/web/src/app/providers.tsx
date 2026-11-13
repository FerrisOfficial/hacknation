"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  // Jeden QueryClient na sesję przeglądarki (useState, żeby nie tworzyć go przy każdym renderze).
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
