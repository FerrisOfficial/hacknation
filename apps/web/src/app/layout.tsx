import type { Metadata } from "next";
// Inter z paczki npm (OFL), bez Google Fonts: stos działa on-premise, bez usług zewnętrznych.
import "@fontsource-variable/inter";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "IVE",
  description: "Przegląd wykrytych naruszeń w reklamach usług inwestycyjnych",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className="h-full antialiased">
      <body className="h-full">
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
