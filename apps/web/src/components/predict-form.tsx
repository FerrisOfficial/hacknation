"use client";

import type { Prediction } from "@app/api-ml";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { withBasePath } from "@/lib/base-path";
import { type PredictInput, predictInputSchema } from "@/lib/schemas";

async function predict(input: PredictInput): Promise<Prediction> {
  const res = await fetch(withBasePath("/api/predict"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Coś poszło nie tak");
  return body;
}

export function PredictForm() {
  const form = useForm({
    resolver: zodResolver(predictInputSchema),
    defaultValues: { text: "" },
  });
  const mutation = useMutation({
    mutationFn: predict,
    onError: (error) => toast.error(error.message),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
      <FieldGroup>
        <Controller
          name="text"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="text">Tekst do analizy</FieldLabel>
              <Input
                {...field}
                id="text"
                aria-invalid={fieldState.invalid}
                placeholder="Ten stack jest świetny"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Analizuję…" : "Analizuj"}
        </Button>
        {mutation.data && (
          <p className="text-muted-foreground text-sm" data-testid="prediction">
            Wynik: <strong className="text-foreground">{mutation.data.label}</strong> (pewność{" "}
            {Math.round(mutation.data.score * 100)}%)
          </p>
        )}
      </FieldGroup>
    </form>
  );
}
