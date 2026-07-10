# Energy System Dashboard V0.6.1

## V0.6.1 – Responsives Gebäude-Flow-Routing

- Elektrische und thermische Gebäude-Flows orientieren sich an der tatsächlich gerenderten Gebäudegeometrie.
- Geschossanschlüsse werden aus den realen Geschoss-Header-Positionen bestimmt.
- Unterschiedlich hohe Ebenen durch Parent-/Child-Bereiche werden bei der Flow-Geometrie berücksichtigt.
- Größenänderungen des Gebäudestacks lösen eine Neuberechnung der Flow-Routen aus.
- Elektrische Sammelschiene links und thermische Sammelschiene rechts bleiben außerhalb des Gebäudeblocks.
- Abzweige enden an der jeweiligen Geschossframe-Kante.
- Python-Cache-Dateien sind nicht Bestandteil des Repository-Pakets.

## V0.6.0 – Flow-Routing, Parent-Details und Raumklima

- Elektrische Sammelschiene links und thermische Sammelschiene rechts bleiben vollständig außerhalb des Gebäudeblocks.
- Bei genau einer PV-Anlage oder genau einem Batteriespeicher wird keine redundante Quellen-/Teilspeicherliste angezeigt.
- Parent-Namen werden nicht mehr durch den Hierarchiehinweis abgeschnitten.
- Parent-Details lassen sich über einen eigenen Auf-/Zuklapp-Button öffnen.
- Climate-Entities können optional separate IST-/SOLL-Temperatursensoren überschreiben.
- Ist das Thermostat `off`, wird die Solltemperatur nicht angezeigt.

## Installation / Update

1. Den bisherigen Ordner `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Repository nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.

## Read-only Lovelace-Karte

JavaScript-Ressource:

```text
/energy_system_dashboard/energy-system-card.js?v=0.6.1
```

Minimalbeispiel:

```yaml
type: custom:energy-system-card
view: system
```

Weitere Beispiele und Optionen befinden sich unter `docs/`.
