import { PredictForm } from "@/components/predict-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="font-semibold text-3xl tracking-tight">Vibe Stack</h1>
      <Card>
        <CardHeader>
          <CardTitle>Przykład end-to-end</CardTitle>
          <CardDescription>
            Formularz → /api/predict (Next.js) → serwis ML (FastAPI) → wynik.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PredictForm />
        </CardContent>
      </Card>
    </main>
  );
}
