import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Bez R2 nie ma trwałego cache'u: strony i dane renderują się przy każdym żądaniu. Na hackathon wystarczy.
export default defineCloudflareConfig();
