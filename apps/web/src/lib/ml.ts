import "server-only";
import { createMlClient } from "@app/api-ml";

// Klient serwisu ML — tylko po stronie serwera. Przeglądarka nigdy nie gada z FastAPI bezpośrednio:
// idzie przez route handlery w src/app/api, gdzie robimy walidację i (później) autoryzację.
// 127.0.0.1, nie localhost: uvicorn słucha na IPv4, a localhost bywa rozwiązywany na ::1.
export const ml = createMlClient(process.env.ML_API_URL ?? "http://127.0.0.1:8000");
