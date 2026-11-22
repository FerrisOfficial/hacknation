---
name: demo
description: Przygotowanie stosu i danych do demo przed jury UKNF — świeże kontenery, źródła M1/M3, progi, decyzje analityka do kalibracji, scenariusz z powiadomieniem na żywo. Użyj przed prezentacją albo gdy dashboard jest pusty lub ma nienaturalne progi.
---

# Demo dla jury

Jury ocenia: skuteczność scrapingu, trafność klasyfikacji i **to, jak zmiana progu w Kalibracji zmienia wyniki**, płynność UI i powiadomień, bezpieczeństwo bibliotek oraz czystą konsolę przeglądarki (`docs/ZADANIE.md`, „Jak ocenia jury”).
Dane są w lokalnej bazie, więc zbieramy je **na komputerze, z którego robimy demo**.

## 1. Stos

```bash
git pull && docker compose up --build --detach
docker compose ps        # wszystkie usługi healthy
```
Nigdy `docker compose down -v` — kasuje zebrane materiały (hook to blokuje).

## 2. Źródła

`COLLECTOR_TOKEN` z `.env`. Adres bazowy: `http://localhost:3000/hacknation`.
```bash
curl -X POST -H "Authorization: Bearer $COLLECTOR_TOKEN" http://localhost:3000/hacknation/api/sources/m1
curl -X POST -H "Authorization: Bearer $COLLECTOR_TOKEN" http://localhost:3000/hacknation/api/sources/m3
```
Harmonogram (cron pg-boss co minutę) zbiera dalej sam. Postęp: zakładka **Źródła** i `GET /api/jobs`.

## 3. Progi

Sprawdź `GET /api/settings/threshold`. Progi `flag` ok. 0,5, `alert` ok. 0,85. Próg bliski 0 albo 1 to ślad po testach — przywróć go w Kalibracji („Zapisz próg”).

## 4. Decyzje do kalibracji

Panel liczy FP/FN, precyzję i pełność dopiero od 10 decyzji na moduł. W **Kolejce** oznacz po 15–20 materiałów w każdym module (M1, M2, M3): „Potwierdź naruszenie” albo „Fałszywy alarm” — także kilka poniżej progu, żeby było widać FN. Zacznij od pozycji z góry listy: jury kliknie je pierwsze.

## 5. Kontrola

- Każda zakładka (Przegląd, Kolejka, Reklamy, Kalibracja, Źródła, okno sprawy) bez błędów w konsoli przeglądarki.
- Wykres trendu ma punkty z kilku godzin.
- Wskaźnik „Na żywo” w pasku bocznym jest zielony (Socket.io połączony).

## 6. Scenariusz (ok. 5 min)

1. Przegląd: trzy moduły, trend, licznik nowych naruszeń.
2. Źródła: „Nowe źródło” → fraza w YouTube; zbieranie rusza od razu („Ponów” wymusza kolejne).
3. Po chwili powiadomienie o wysokim ryzyku → okno sprawy: cytat, reguła z podstawą prawną, sekunda filmu, klatka.
4. Kalibracja: przesuń próg i pokaż, jak zmieniają się FP/FN, precyzja i lista materiałów.
5. Reklamy (M1): rejestr reklam firm z KNF i eksport CSV.
6. Na koniec repo: `docs/PROCES-AI.md` — jak pracowaliśmy z agentami AI.
