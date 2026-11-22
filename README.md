# IVE — InvestWatch

System monitoringu internetu dla UKNF (HackNation 2026, zadanie **#InvestWatch — na straży inwestorów!**). Sam wyszukuje materiały o usługach inwestycyjnych, ocenia je trzema modułami i pokazuje analitykowi alerty z dowodami. Działa w całości lokalnie, na Docker Compose.

## Uruchomienie

Wymagany jest tylko Docker z Compose v2 (np. Docker Desktop, uruchomiony).

```bash
git clone https://github.com/FerrisOfficial/hacknation.git
cd hacknation
cp .env.example .env              # Windows PowerShell: copy .env.example .env
docker compose up --build web     # tryb szybki; pierwszy start buduje obrazy, kilkanaście minut
```

Po starcie otwórz **http://localhost:3000/hacknation**. Zatrzymanie: `Ctrl+C`, a potem `docker compose down` (dane zostają) albo `docker compose down -v` (czyści bazę).

| | **Tryb szybki** (zalecany do oceny) | **Tryb pełny** |
|---|---|---|
| Komenda | `cp .env.example .env`<br>`docker compose up --build web` | `cp .env.example .env`<br>`IVE_MODE=full M2_ENGINE=hybrid M3_ENGINE=hybrid docker compose up --build` |
| Co widać | 54 przykładowe materiały M1, M2 i M3 z wynikami, dowodami i decyzjami analityka. Działają wszystkie zakładki, a Kalibracja od razu liczy FP/FN | to samo, a do tego prawdziwe zbieranie: źródła M1 i M3 zakładają się same i harmonogram od razu szuka w YouTube i na stronach WWW |
| Internet | niepotrzebny (harmonogram wstrzymany, włączysz go w zakładce Źródła) | potrzebny (YouTube, rejestr KNF) |
| Model AI | brak, M2 i M3 działają na regułach | Bielik-PL-11B w Ollamie, ok. 12 GB, pobierany raz |
| Sprzęt | bez GPU | zalecane GPU NVIDIA z ok. 12 GB VRAM; bez GPU działa na CPU, wolno |
| Pierwszy start | kilkanaście minut (budowa obrazów), potem kilkanaście sekund | jak w szybkim, plus pobranie modelu; do jego końca M2 i M3 działają na regułach |

Przykładowe materiały dotyczą wymyślonych firm z domenami `.example`. Tryb działa tylko przy pierwszym starcie na pustej bazie, więc baza z danymi zostaje bez zmian. Zmiana trybu: `docker compose down -v`, a potem start od nowa.

<details>
<summary>Windows, GPU, Ollama na hoście, development</summary>

- **Windows** (PowerShell): w `.env` ustaw `IVE_MODE=full`, `M2_ENGINE=hybrid`, `M3_ENGINE=hybrid` i uruchom `docker compose up --build`.
- **GPU NVIDIA:** `docker compose -f compose.yaml -f compose.gpu.yaml up --build`
- **Mac z GPU Apple:** uruchom Ollamę natywnie, a w `.env` ustaw `OLLAMA_URL=http://host.docker.internal:11434`. Mniejszy model Q4_K_M (ok. 7 GB) opisuje [services/ml/README.md](services/ml/README.md).
- **Development:** Node 24, pnpm, [uv](https://docs.astral.sh/uv/), ffmpeg:
  ```bash
  pnpm install && pnpm db:up && pnpm dev   # web :3000, ml :8000, media :8100
  pnpm check                               # lint + typy + testy (TS i Python)
  ```
</details>

## Co robi

**Silnik zbierania:** wyszukiwanie i kanały YouTube (opisy, transkrypcje, klatki), strony WWW z linków pod filmami, rejestr i lista ostrzeżeń KNF. Harmonogram w kolejce pg-boss, deduplikacja po hashu treści, opcjonalne proxy i losowe przerwy.

Każdy moduł daje materiałowi **score 0–1**, czyli ocenę, na ile pewne jest naruszenie. Score ≥ próg modułu (suwak w Kalibracji) → incydent w kolejce. Każda flaga ma dowód: dosłowny cytat z linkiem do miejsca na stronie albo sekundy filmu, albo klatkę.

### Skąd biorą się score'y

**Cechy z fraz (M2, M3).** Każda fraza ma wagę 0–1: na ile pewnie oznacza daną cechę (np. „gwarantowany zysk” mocniej niż samo „zysk”). Score cechy w akapicie to waga najmocniejszej pasującej frazy. Zaprzeczenia („bez ryzyka” to nie ostrzeżenie), pytania z FAQ i cytaty przepisów są pomijane.

**M1 — finfluencerzy.** Działa, gdy materiał po polsku linkuje albo wymienia firmę z rejestru KNF, a autor nie jest tą firmą. Szuka sygnałów reklamy przy tej firmie. Każdy sygnał ma wagę w: etykieta płatnej promocji YouTube 0,6, kod polecający 0,5, link afiliacyjny 0,5 (zwykły link 0,3), fraza reklamowa („z moim kodem”, „załóż konto”) 0,3, sama wzmianka marki 0,2.
- `score = 1 − Π(1 − wᵢ)` (noisy-OR): każdy sygnał osobno może świadczyć o reklamie, więc `1 − wᵢ` to szansa, że ten sygnał nie świadczy. Iloczyn to szansa, że nie świadczy żaden, a 1 minus iloczyn to szansa, że świadczy przynajmniej jeden. Każdy kolejny sygnał podnosi score, ale nigdy ponad 1.
- Przykład: kod polecający i fraza reklamowa dają 1 − 0,5 · 0,7 = 0,65. Od 0,5 materiał dostaje etykietę `reklama`.
- M1 działa bez LLM, bo ma wykryć reklamę, a nie oceniać jej treść. Kanał, w którym znaleziono reklamę, jest potem obserwowany na stałe.

**M2 — informacja o ryzyku.** Działa dla materiałów firm z rejestru KNF: 18 reguł UKNF z art. 44 rozp. 2017/565. Każda reguła to wzór na score'ach cech, który daje P(naruszenie).
- Reguła 14 (wyniki historyczne bez zastrzeżenia): `P = wyniki · (1 − zastrzeżenie)`. P jest wysokie, gdy w materiale są wyniki historyczne, a nie ma zastrzeżenia, że nie gwarantują przyszłych.
- Reguła 3 (ostrzeżenie ma towarzyszyć obietnicy zysku): ostrzeżenie w tym samym akapicie liczy się ×1, w sąsiednim ×0,85, dwa akapity dalej ×0,5, jeszcze dalej ×0,15. Ostrzeżenie tylko w stopce nie „towarzyszy” obietnicy z nagłówka.
- Reguły 4, 5, 6, 8 i 13 liczy OCR z klatek filmu. Naruszenie jest, gdy: czcionka ostrzeżenia ma mniej niż 0,6 wysokości pozostałego tekstu, kontrast jest poniżej 4,5:1 (WCAG), ostrzeżenie jest na ekranie krócej, niż trwa jego przeczytanie (3 słowa/s), na telefonie ma mniej niż 9 px albo wyniki historyczne są eksponowane mocniej niż ostrzeżenie.
- `score reguły = waga × P(naruszenie)`. Waga to 1, a dla reguł formalnych 1 i 2 (nazwa firmy, oznaczenie reklamy) 0,3, żeby same nie przekraczały progu 0,5. Score materiału to najwyższy score reguły, więc incydent powstaje, gdy którakolwiek reguła przekroczy próg.

**M3 — doradztwo bez zezwolenia.** Działa dla każdego materiału. Według art. 76 u.o.o.i.f. doradztwo to oferowana jako usługa rekomendacja instrumentów finansowych dla konkretnego klienta. Z fraz liczone są trzy przesłanki: oferta usługi (O), rekomendacje instrumentów (R) i dopasowanie do klienta (D).
- `P(doradztwo) = min(O, max(R, D))` zapisuje warunek „oferta I (rekomendacje LUB dopasowanie)”. „I” to minimum: wynik jest tak pewny, jak najsłabszy z warunków koniecznych. „LUB” to maksimum: wystarczy najmocniejsza z przesłanek. Wzór nie ma wag, więc analityk widzi, która przesłanka zdecydowała.
- Przykład: O = 0,85, R = 0,6, D = 0, więc P = min(0,85; 0,6) = 0,6. Finfluencer, który pisze „kupuję akcje X”, nie ma oferty, więc P = 0.
- Odpłatność, powoływanie się na licencje i zastrzeżenie „to nie jest doradztwo” przy ofercie indywidualnej to osobne flagi z cytatem. Nie zmieniają P, ale podnoszą risk score.
- Potem rejestr KNF rozstrzyga, czy to naruszenie. Współczynniki 0,2 i 0,4 są ustalone ręcznie:
  - podmiot z zezwoleniem: `score = P × 0,2`, bo usługa jest legalna i materiał spada na koniec kolejki,
  - podmiot z listy ostrzeżeń KNF: `score = 1 − (1 − P) × 0,4`, czyli brakująca do 1 część score'u maleje o 60%. Przykład: P = 0,5 daje 0,8,
  - podmiot bez wpisu: `score = P`, a przy P ≥ 0,3 dochodzi flaga „brak zezwolenia”.

### Jak Bielik daje prawdopodobieństwo (tryb `hybrid`)

1. Regex wskazuje, czy reguła dotyczy materiału i w którym miejscu (cytat). Bielik-PL-11B dostaje fragment wokół cytatu (± 2 akapity) i pytanie o jedną regułę, z odpowiedzią jednym słowem TAK albo NIE.
2. Nie czytamy wygenerowanego słowa, tylko rozkład prawdopodobieństwa pierwszego tokenu (logprobs). Sumujemy prawdopodobieństwa tokenów zaczynających się na T i na N, a potem `P(TAK) = P(T) / (P(T) + P(N))`.
3. Kalibracja: surowe P jest prawie zawsze bliskie 0 albo 1, więc suwak progu niewiele by zmieniał. Dlatego `P' = σ(logit(P) / T)`, gdzie `logit(P) = ln(P / (1 − P))`, `σ(x) = 1 / (1 + e⁻ˣ)` i T = 2. Wzór rozciąga skalę (0,99 → 0,91), ale nie zmienia kolejności ani decyzji przy 0,5. T = 2 wyszło z dopasowania Platta na etykietach (`scripts/eval_m2.py`).
4. W M2 tak oceniana jest każda reguła tekstowa poza 9, 10, 17 i 18. W tych czterech LLM dawał w ewaluacji same fałszywe alarmy, więc zostaje regex. W M3 model jest pytany tylko wtedy, gdy O ≥ 0,3. Dostaje dwa pytania (doradztwo i zarządzanie portfelem), a P to wyższa z dwóch odpowiedzi.
5. Gdy model nie odpowie, wynik liczą same reguły.

### Risk score

Score decyduje, czy materiał jest incydentem. Risk score ustala kolejność w kolejce i jest pokazywany analitykowi. Liczy się go ze score'ów reguł powyżej progu, ustawionych od najwyższego (s1 ≥ s2 ≥ …):

`risk = 1 − (1 − s1) · (1 − s2/2) · (1 − s3/4) · …`

To noisy-OR, w którym każde kolejne naruszenie waży o połowę mniej. Najpoważniejsze naruszenie liczy się w pełni, więc risk nigdy nie spada poniżej niego. Kolejne podnoszą go coraz słabiej, bo reguły nie są niezależne (12a, 12b i 14 dotyczą tych samych wyników historycznych). Przykład: naruszenia 0,8 i 0,6 dają 1 − 0,2 · 0,7 = 0,86. M1 nie ma score'ów reguł, więc jego risk score to po prostu score. Szczegóły: [docs/BACKEND.md](docs/BACKEND.md).

**Dashboard:** kolejka incydentów z filtrami (data, źródło, ryzyko, moduł), zmiana statusu, trend, teczka podmiotu, okno sprawy (film, klatki, kopia HTML), raporty i powiadomienia o wysokim ryzyku na żywo (Socket.io). **Kalibracja:** próg dla każdego modułu, a jego zmiana od razu przelicza FP/FN, precyzję i pełność na decyzjach analityka.

## Wymagania techniczne UKNF

| Wymaganie | Jak spełniamy |
|---|---|
| Lekkie, rozdzielone serwisy | Osobne kontenery: `web` (UI i backend), `ml` (AI i scraping), `media` (filmy), `ollama` (LLM), `db`. `web` woła `ml` przez klient generowany z OpenAPI. Przeglądarka nie woła serwisów AI bezpośrednio. |
| Docker Compose, on-premise | Jedna komenda, obrazy z przypiętymi wersjami. CI w każdym PR buduje stos i sprawdza, czy odpowiada. |
| Tylko open source, bez płatnych API | Bielik w lokalnej Ollamie, OCR w ONNX Runtime, Postgres. Nie ma kluczy do zewnętrznych usług. |
| Bezpieczny łańcuch dostaw | CI uruchamia `pnpm audit` i `pip-audit`, lockfile'y są wymuszane. Sekrety trzymamy tylko w `.env` (poza gitem i obrazami), porty wystawiamy tylko na `127.0.0.1`. |
| README minimalne | Uruchomienie, wymagania sprzętowe i usługi na jednym ekranie. |

## Usługi i stack

| Usługa | Port | Technologie |
|---|---|---|
| `web` | 3000, 3001 (Socket.io) | Next.js 16, React 19, Tailwind 4, shadcn/ui, TanStack Query, Zod, pg-boss, Drizzle |
| `ml` | 8000 (`/docs`) | Python 3.14, FastAPI, pydantic, httpx, selectolax, Playwright, yt-dlp, RapidOCR |
| `media` | 8100 | FastAPI, yt-dlp, ffmpeg |
| `ollama` | 11434 | Ollama + Bielik-PL-11B v3.0 (tylko w trybie pełnym) |
| `db` | 5432 | PostgreSQL 17: metadane, treści, wyniki, decyzje |

Jakość kodu: Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions. Zmienne z opisami: [.env.example](.env.example).

```
apps/web/          Next.js: UI, API (src/app/api), pipeline i kolejka (src/lib)
packages/db/       schemat Drizzle i migracje SQL
packages/api-ml/   klient TS serwisu ML generowany z OpenAPI
services/ml/       FastAPI: scraper, kolektory, M2 (risk*.py), M3 (advisory.py), KNF (knf.py)
services/media/    FastAPI + ffmpeg: filmy i klatki
docs/              wymagania (ZADANIE.md), kontrakt API (KONTRAKT.md), materiały UKNF
```

## Licencja

Kod projektu: [MIT](LICENSE). Wszystkie zależności są open source. Kod linkuje tylko biblioteki na licencjach permisywnych, a ffmpeg (GPL) działa jako osobny program.

<details>
<summary>Licencje zależności</summary>

| Komponent | Licencja |
|---|---|
| Next.js, React, Tailwind CSS, shadcn/ui, Base UI, TanStack Query, React Hook Form, @hookform/resolvers, Zod, Socket.io, pg-boss, sonner, next-themes, fflate, tw-animate-css, cn, openapi-fetch, openapi-typescript | MIT |
| class-variance-authority, Drizzle ORM | Apache 2.0 |
| lucide-react | ISC |
| Inter (@fontsource-variable/inter) | SIL OFL 1.1 |
| postgres (postgres.js), yt-dlp | Unlicense |
| FastAPI, pydantic, selectolax, youtube-transcript-api, ONNX Runtime, Ollama | MIT |
| httpx, Chromium (headless shell w obrazie `ml`) | BSD-3-Clause |
| Playwright, RapidOCR, Bielik-PL-11B v3.0 Instruct (SpeakLeash) | Apache 2.0 |
| ffmpeg (pakiet Debiana w obrazie `media`, osobny proces) | GPL 2+ |
| PostgreSQL | PostgreSQL License |
| Obrazy bazowe `node`, `python`, `postgres`, `ollama/ollama` | licencje projektów + pakiety Debiana |
| Ruff, Pyright, Vitest, pytest | MIT |
| Biome | MIT lub Apache 2.0 |
</details>

Więcej: [docs/ZADANIE.md](docs/ZADANIE.md) (wymagania), [docs/KONTRAKT.md](docs/KONTRAKT.md) (API), [docs/PROCES-AI.md](docs/PROCES-AI.md) (jak pracowaliśmy z agentami AI).
