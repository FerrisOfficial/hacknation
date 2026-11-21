"use client";

import { CircleCheckIcon, CircleHelpIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { BipLink, CharCounter, ProductBanner, TextLink } from "@/components/gov/content";
import {
  GovHeader,
  GovPortalFooter,
  HamburgerMenu,
  HorizontalMenu,
  SideMenu,
  SiteFooter,
} from "@/components/gov/layout";
import { Stepper } from "@/components/gov/stepper";
import { Uploader, type UploadItem } from "@/components/gov/uploader";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function Slot({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded border border-dashed border-input bg-muted px-3 text-xs text-muted-foreground ${className ?? "h-12 w-36"}`}
    >
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function KitShowcase() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadItem[]>([]);

  return (
    <div className="flex min-h-full flex-col">
      <GovHeader
        serviceName="Kit Gov.pl – podgląd komponentów"
        logo={<Slot label="Logo instytucji" className="h-10 w-24 md:h-12 md:w-36" />}
        actions={<Button variant="secondary">Zaloguj się</Button>}
        onMenuClick={() => setMenuOpen(true)}
      />
      <HamburgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          { label: "Strona główna", href: "/", active: true },
          {
            label: "Usługi",
            href: "/kit#uslugi",
            children: [{ label: "Dowód osobisty", href: "/kit#dowod" }],
          },
          { label: "Kontakt", href: "/kit#kontakt" },
        ]}
      />
      <HorizontalMenu
        siteName="Nazwa witryny"
        items={[
          { label: "O nas", href: "/kit#o-nas" },
          { label: "Komponenty", href: "/kit", active: true },
          { label: "Kontakt", href: "/kit#kontakt" },
        ]}
      />

      <main className="mx-auto flex w-full max-w-292 flex-1 flex-col gap-14 px-4 py-10 md:px-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Strona główna</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/kit">Design system</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Komponenty</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="text-4xl font-bold">Kit Gov.pl</h1>

        <Stepper
          steps={[
            { label: "Wybór usługi", status: "completed" },
            { label: "Dane wnioskodawcy", status: "completed" },
            { label: "Załączniki", status: "current" },
            { label: "Podsumowanie", status: "disabled" },
            { label: "Wysłanie", status: "disabled" },
          ]}
          onSelect={() => undefined}
        />

        <Section title="Przyciski">
          <div className="flex flex-wrap gap-4">
            <Button>Wyślij wniosek</Button>
            <Button variant="secondary">Dowiedz się więcej</Button>
            <Button variant="ghost">Anuluj</Button>
            <Button variant="destructive">Usuń</Button>
            <Button variant="destructive-secondary">Nie usuwaj</Button>
            <Button disabled>Niedostępne</Button>
          </div>
          <p>
            Odnośnik: <TextLink href="/kit">Sprawdź, jak założyć profil zaufany</TextLink>, w nowym
            oknie:{" "}
            <TextLink href="https://www.gov.pl" external>
              Portal gov.pl
            </TextLink>
          </p>
        </Section>

        <Section title="Formularz">
          <div className="grid max-w-180 gap-6 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="kit-name">Imię i nazwisko</FieldLabel>
              <Input id="kit-name" placeholder="Jan Kowalski" />
              <FieldDescription>Tak jak w dowodzie osobistym.</FieldDescription>
            </Field>
            <Field data-invalid="true">
              <FieldLabel htmlFor="kit-pesel">PESEL</FieldLabel>
              <Input id="kit-pesel" defaultValue="1234" aria-invalid="true" />
              <FieldError>PESEL ma 11 cyfr.</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-date">Data urodzenia</FieldLabel>
              <Input id="kit-date" type="date" />
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-time">Godzina wizyty</FieldLabel>
              <Input id="kit-time" type="time" />
            </Field>
            <Field>
              <FieldLabel>Województwo</FieldLabel>
              <Select>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Wybierz województwo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kp">kujawsko-pomorskie</SelectItem>
                  <SelectItem value="mz">mazowieckie</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="kit-disabled">Pole zablokowane</FieldLabel>
              <Input id="kit-disabled" disabled defaultValue="Nie można edytować" />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="kit-desc">Opis zdarzenia</FieldLabel>
              <Textarea
                id="kit-desc"
                placeholder="Opisz historię zdarzenia"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <CharCounter value={text.length} max={500} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-10">
            <div className="flex items-center gap-3">
              <Checkbox id="kit-agree" defaultChecked />
              <Label htmlFor="kit-agree">Akceptuję regulamin</Label>
            </div>
            <RadioGroup defaultValue="online" className="flex gap-6">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="online" id="kit-online" />
                <Label htmlFor="kit-online">Online</Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="urzad" id="kit-urzad" />
                <Label htmlFor="kit-urzad">W urzędzie</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="max-w-120">
            <Uploader
              items={files}
              onAdd={(added) =>
                setFiles((prev) => [
                  ...prev,
                  ...added.map((file) => ({ id: `${file.name}-${file.lastModified}`, file })),
                ])
              }
              onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
            />
          </div>
        </Section>

        <Section title="Komunikaty">
          <div className="flex max-w-160 flex-col gap-4">
            <Alert variant="info">
              <InfoIcon />
              <AlertTitle>Informacja</AlertTitle>
              <AlertDescription>Wniosek możesz zapisać i dokończyć później.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <CircleCheckIcon />
              <AlertTitle>Wniosek wysłany</AlertTitle>
              <AlertDescription>Potwierdzenie wyślemy na Twój adres e-mail.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <CircleHelpIcon />
              <AlertTitle>Sprawdź dane</AlertTitle>
              <AlertDescription>Adres różni się od tego w rejestrze.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Nie udało się wysłać</AlertTitle>
              <AlertDescription>Spróbuj ponownie za kilka minut.</AlertDescription>
            </Alert>
          </div>
        </Section>

        <Section title="Treść">
          <div className="flex flex-col gap-10 md:flex-row">
            <SideMenu
              items={[
                { label: "Informacje ogólne", href: "/kit", active: true },
                { label: "Wymagane dokumenty", href: "/kit#dokumenty" },
                { label: "Opłaty", href: "/kit#oplaty" },
              ]}
            />
            <div className="flex flex-1 flex-col gap-8">
              <Card>
                <CardHeader className="border-b">
                  <CardTitle>Ramka z nagłówkiem</CardTitle>
                </CardHeader>
                <CardContent>Ramka grupuje powiązane informacje, np. dane sprawy.</CardContent>
              </Card>
              <Tabs defaultValue="opis">
                <TabsList variant="line">
                  <TabsTrigger value="opis">Opis</TabsTrigger>
                  <TabsTrigger value="uzycie">Przypadki użycia</TabsTrigger>
                </TabsList>
                <TabsContent value="opis" className="pt-4">
                  Treść pierwszej zakładki.
                </TabsContent>
                <TabsContent value="uzycie" className="pt-4">
                  Treść drugiej zakładki.
                </TabsContent>
              </Tabs>
              <Accordion>
                <AccordionItem value="kto">
                  <AccordionTrigger>Kto może złożyć wniosek?</AccordionTrigger>
                  <AccordionContent>Osoba pełnoletnia z numerem PESEL.</AccordionContent>
                </AccordionItem>
                <AccordionItem value="ile">
                  <AccordionTrigger>Ile to kosztuje?</AccordionTrigger>
                  <AccordionContent>Złożenie wniosku jest bezpłatne.</AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Numer sprawy</TableHead>
                <TableHead>Data złożenia</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>WN/2026/0142</TableCell>
                <TableCell>12.11.2026</TableCell>
                <TableCell>W trakcie</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>WN/2026/0137</TableCell>
                <TableCell>08.11.2026</TableCell>
                <TableCell>Zakończona</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Separator />
          <div className="flex flex-wrap items-center gap-10">
            <Spinner className="size-10" />
            <div className="w-80">
              <Progress value={60} aria-label="Postęp wysyłania" />
            </div>
            <BipLink
              href="https://www.gov.pl/web/bip"
              logo={<Slot label="Logo BIP" className="h-8 w-24" />}
            />
          </div>
          <ProductBanner
            title="Załatw sprawę online"
            image={
              <div className="flex h-full min-h-48 items-center justify-center bg-border text-sm text-muted-foreground">
                Zdjęcie produktu
              </div>
            }
            action={<Button>Przejdź do usługi</Button>}
          >
            Krótki opis akcji lub produktu: co użytkownik zyska i co ma zrobić.
          </ProductBanner>
        </Section>
      </main>

      <SiteFooter
        serviceName="Nazwa serwisu"
        description="Krótki opis serwisu i instytucji, która go prowadzi."
        owner="Nazwa instytucji"
        links={[
          { label: "Deklaracja dostępności", href: "/kit#dostepnosc" },
          { label: "Polityka prywatności", href: "/kit#prywatnosc" },
        ]}
      />
      <GovPortalFooter
        portalLogo={<Slot label="Logo portalu" className="h-10 w-30" />}
        rodo="Klauzula informacyjna RODO: kto przetwarza dane osobowe i jak się z nim skontaktować."
        license="Informacja o prawach autorskich i licencji treści."
        links={[
          { label: "Polityka cookies", href: "/kit#cookies" },
          { label: "Deklaracja dostępności", href: "/kit#dostepnosc" },
        ]}
        euLogos={
          <>
            <Slot label="Fundusze Europejskie" className="h-12 w-40" />
            <Slot label="Rzeczpospolita Polska" className="h-12 w-40" />
            <Slot label="Unia Europejska" className="h-12 w-40" />
          </>
        }
      />
    </div>
  );
}
