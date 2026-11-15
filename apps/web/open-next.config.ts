import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Bez R2: cache ('use cache', ISR) żyje tylko w ramach jednej wersji Workera. Na hackathon wystarczy.
export default defineCloudflareConfig();
