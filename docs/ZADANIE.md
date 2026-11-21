# Zadanie: #InvestWatch — na straży inwestorów (UKNF)

Zadanie konkursowe Urzędu Komisji Nadzoru Finansowego na HackNation 2026.
Oryginały (PDF): [folder na Dysku Google](https://drive.google.com/drive/folders/1LPI7gGS_P4n67G6Ch-xd7ziaUFRPH7DR) — „Pełna treść zadania konkursowego” (5 stron) i „Regulamin Zadania Konkursowego” (22 strony).
Ten plik to nasze streszczenie i lista wymagań. W razie wątpliwości rozstrzyga PDF.

## Terminy i zasady

| Co | Kiedy / ile |
|---|---|
| Start | 21.11.2026, 11:00 |
| **Oddanie rozwiązania** | **22.11.2026, 11:00** — przez platformę organizatora; po terminie nie jest oceniane |
| Wyniki | 22.11.2026 ok. 17:15, ceremonia zamknięcia |
| Nagroda | jedna, za I miejsce: 30 000 zł brutto, dzielona po równo w zespole |
| Próg | laureat musi mieć co najmniej 5/10 pkt |
| Zespół | do 6 osób, tylko stacjonarnie (Bydgoszcz) |

## Cel

System monitoringu internetu i social mediów (m.in. Facebook, Instagram, TikTok), który sam wyszukuje, zbiera i analizuje reklamy oraz oferty usług i instrumentów finansowych na polskim rynku. Pomaga UKNF chronić inwestorów.
Budowa: **jeden uniwersalny silnik scrapingu + trzy moduły analityczne**.

## Moduły analityczne

### Moduł 1 — finfluencerzy i podmioty trzecie

- **Szuka:** reklam firm inwestycyjnych zarejestrowanych w Polsce (i ich instrumentów/usług) publikowanych przez *kogoś innego* — osoby prywatne, zwłaszcza finfluencerów, i inne podmioty trzecie. Także polskojęzycznych reklam zagranicznych firm działających w Polsce transgranicznie.
- **Daje:** raport/bazę: dane firmy inwestycyjnej, dane reklamującego, treść reklamy, dokładny URL. Z okresową aktualizacją.

### Moduł 2 — informacja o ryzyku

- **Szuka:** materiałów marketingowych publikowanych *bezpośrednio przez* firmy inwestycyjne zarejestrowane w Polsce (w tym polskie oddziały firm zagranicznych).
- **Analiza (AI / statystyka):** czy informacja o ryzyku jest wystarczająca, wyraźna i proporcjonalna do informacji o zyskach — według listy wymogów z załącznika.
- **Daje:** automatyczne flagowanie materiałów, które tych kryteriów nie spełniają.
- ⚠️ Listy wymogów („załącznik”) nie ma w folderze na Dysku — trzeba ją wziąć od mentorów UKNF.

### Moduł 3 — usługi nieautoryzowane (shadow advisory)

- **Szuka:** ofert wealth management, investment consulting, family office i innych firm doradczych, które *nie są* autoryzowanymi firmami inwestycyjnymi.
- **Analiza:** frazy i treści sugerujące, że w Polsce faktycznie świadczą doradztwo inwestycyjne bez zezwolenia.
- **Daje:** raport: dane podmiotu, treść oferty, URL potencjalnego naruszenia.

## Oczekiwane MVP

### 1. Backend i silnik scrapingu (.NET / Python / Node.js)

- [ ] Kolejka zadań na dowolnym narzędziu open source
- [ ] Crawler/scraper (Playwright, Selenium, httpx, requests itp.)
- [ ] Kolektory API lub parsery treści dla social mediów, z rotacją User-Agent i proxy
- [ ] Ekstrakcja z HTML do formatu wyjściowego (np. JSON)
- [ ] Składowanie: baza metadanych (SQL) i baza treści (SQL + np. object storage)
- [ ] Harmonogram: CronJob albo orkiestrator uruchamiający scrapery

### 2. Moduły analityczne / AI (Python)

- [ ] Preprocessing: usuwanie tagów HTML, normalizacja tekstu, deduplikacja
- [ ] Reprezentacja wektorowa (tokeny, embeddingi)
- [ ] Silnik inferencji: vLLM, llama.cpp albo Ollama
- [ ] Model open source (np. Gemma) albo klasyfikator (np. BERT)
- [ ] Klasyfikacja ryzyka funkcją scoringową na wyjściu modelu → kategoria materiału
- [ ] Agregator łączący wyniki modułów 1, 2 i 3 w jeden ujednolicony obiekt

### 3. Dashboard (React / Vue / Angular)

- [ ] Lista wyników z filtrami: data, źródło, poziom ryzyka, moduł
- [ ] Wykresy trendów, np. liczba incydentów w czasie (Chart.js, Recharts)
- [ ] Zmiana statusu rekordu
- [ ] Powiadomienia w czasie rzeczywistym o wysokim ryzyku przez WebSockety (np. Socket.io)
- [ ] Panel kalibracji: próg (threshold), którego zmiana od razu przesuwa balans false positive / false negative
- [ ] Biblioteki UI open source, komponenty oparte o propsy

## Wymagania techniczne

- [ ] **Lekkie, rozdzielone serwisy:** frontend, backend i silnik AI jako niezależne moduły. Zadanie wprost odradza ciężkie monorepo na rzecz przejrzystego podziału.
- [ ] **Docker + Docker Compose:** cały stos startuje on-premise jedną komendą, powtarzalnie u kilku osób.
- [ ] **Tylko open source i on-premise:** darmowe modele (Ollama, vLLM), otwarte bazy i biblioteki, **żadnych zewnętrznych płatnych API**.
- [ ] **Bezpieczny łańcuch dostaw:** skanowanie zależności npm i pip (Snyk, `npm audit` / `npm audit fix` itp.), sekrety tylko w `.env`.
- [ ] **README minimalne:** Quick Start, wymagania sprzętowe, konfiguracja serwisów. Bez lania wody („bez AI slop”).

## Co oddajemy

Obowiązkowo:

- [ ] tytuł i szczegółowy opis projektu,
- [ ] prezentacja w PDF,
- [ ] opis kodu / README,
- [ ] repozytorium kodu.

Opcjonalnie: film do 3 minut.

Z regulaminu (umowa z laureatem, zał. nr 3): kod źródłowy musi dać się odczytać i zbudować do wersji wykonywalnej, razem z **kompletnym wykazem narzędzi i bibliotek** potrzebnych do budowy.

## Jak ocenia jury

Ocena na prezentacji/demo. Jury patrzy na:

- skuteczność scrapingu (czy dane ze źródeł pobierają się poprawnie),
- trafność klasyfikacji ryzyka i to, jak zmiana progu w panelu kalibracji zmienia wyniki,
- stabilność i płynność UI oraz powiadomień w czasie rzeczywistym,
- użyte biblioteki i ich bezpieczeństwo,
- `console.log` (konsola przeglądarki ma być czysta).

Wiedza ekonomiczna i prawnicza zespołu **nie** jest oceniana. Jury może wziąć pod uwagę opinię mentorów.

### Punktacja (0–10 pkt)

| Kryterium | Waga |
|---|---|
| Aspekt technologiczny — jak ciekawe rozwiązanie i na ile gotowe do demo | 30% |
| Innowacyjność wykonania — proces oparty na standardach, opisany ustandaryzowany proces pracy z asystentami AI | 20% |
| Architektura — kompozycja modułów, skalowalność, otwartość na rozbudowę | 20% |
| Zgodność ze specyfikacją zadania i preferowanymi technologiami | 20% |
| Atrakcyjność — na ile zaskakujące i unikalne | 10% |

20% punktów to opis procesu pracy z AI — nasz `CLAUDE.md`, szablon PR i CI warto pokazać w prezentacji.

## Materiały i kontakt

- Próbki danych UKNF daje na miejscu, w trakcie hackathonu (do pobrania na pendrive przy stoisku UKNF).
- Mentorzy UKNF są przy stoisku przez cały konkurs.
- Discord: kanał `#InvestWatch`.

## Prawa autorskie (regulamin)

- Laureat przenosi na UKNF pełne autorskie prawa majątkowe do kodu, dokumentacji i wcześniejszych wersji, bez dodatkowego wynagrodzenia. Bez podpisania umowy nie ma nagrody.
- Kod nie może naruszać praw osób trzecich. Cudzy kod musi być wyraźnie oznaczony, a jego licencja musi pozwalać UKNF swobodnie z niego korzystać. Przy dodawaniu zależności sprawdzajcie licencję.
- Najlepsze rozwiązania mogą trafić do pilotażu lub produkcji w UKNF.

## Rozbieżności z obecnym repo (do decyzji zespołu)

Repo powstało przed wyborem zadania. Wymagania UKNF kłócą się z nim tutaj:

| Wymaganie UKNF | Stan repo |
|---|---|
| Cały stos przez Docker Compose, on-premise, jedną komendą | ✅ `compose.yaml`: Postgres, migracje, ML, web, Ollama (Gemma 4) — Quick Start w README |
| Bez zewnętrznych usług, tylko otwarte bazy | W Dockerze lokalny Postgres, ale bez logowania (Auth jest tylko w Supabase w chmurze); demo online nadal na Supabase + Cloudflare Workers |
| Lekkie, rozdzielone serwisy zamiast ciężkiego monorepo | pnpm + Turborepo w jednym repo |
| WebSockety do alertów w czasie rzeczywistym | Brak; Cloudflare Workers obsługują WebSockety tylko przez Durable Objects |
| Kolejka zadań + cron dla scraperów | Brak |
| Skanowanie zależności (npm, pip) | Brak w CI |
