# Energy System Dashboard 0.3.0

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Neu in 0.3.0

- neue kombinierte Hauptansicht **SYSTEM**
- Hauptnavigation jetzt: `SYSTEM`, `ELEKTRISCH`, `THERMISCH`, `KONFIGURATION`
- der frühere Hauptreiter `BEREICHE` entfällt
- Gebäudeansicht bleibt Bestandteil von SYSTEM und ELEKTRISCH
- read-only Lovelace-Karte `custom:energy-system-card`
- grafische Kartenkonfiguration in Home Assistant
- vollständig dokumentierte YAML-Schnittstelle
- magnetisches Stockwerkslayout
- angedockte Kacheln werden automatisch lückenlos und zentriert angeordnet
- Drag-and-drop im Verbund ändert die Reihenfolge
- Kacheln können durch Ablegen außerhalb des Verbunds frei gelöst werden
- freie Kacheln docken beim Ablegen nahe am Verbund wieder automatisch an
- Stockwerksflächen wachsen dynamisch mit dem benötigten Layout
- freie Stockwerksnamen können direkt in der Bereichskonfiguration angelegt werden

## Installation / Update

1. `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem** in der Seitenleiste öffnen.
5. Die vorhandene Konfiguration prüfen und speichern.

Bestehende 0.2.x-Konfigurationen werden übernommen. Bisherige Bereichskacheln werden standardmäßig in den magnetisch angedockten Modus migriert.

---

# Read-only Karte im Home-Assistant-Dashboard

Die Lovelace-Karte verwendet dieselbe zentral gespeicherte Topologie wie das Seitenleisten-Panel.

Es werden **keine Entity-IDs in der Karten-YAML konfiguriert**.

## 1. JavaScript-Ressource registrieren

Die Integration stellt die Karten-Datei unter dieser URL bereit:

```text
/energy_system_dashboard/energy-system-card.js?v=0.3.0
```

In Home Assistant unter **Einstellungen → Dashboards → Ressourcen** eine neue JavaScript-Modul-Ressource anlegen:

```text
URL:  /energy_system_dashboard/energy-system-card.js?v=0.3.0
Typ:  JavaScript-Modul
```

Bei YAML-verwalteten Dashboard-Ressourcen:

```yaml
lovelace:
  resources:
    - url: /energy_system_dashboard/energy-system-card.js?v=0.3.0
      type: module
```

Danach die Dashboard-Seite neu laden.

## 2. Einfachste Kartenkonfiguration

```yaml
type: custom:energy-system-card
view: system
```

Die Karte ist read-only. Sie kann die gespeicherte Energy-System-Konfiguration nicht verändern.

## Grafische Konfiguration

Nach dem Laden der Ressource erscheint **Energy System** im Karten-Picker von Home Assistant.

Die grafische Kartenkonfiguration bietet:

- Ansicht
- Darstellung
- eigener Titel
- Stockwerksauswahl
- Standard-Stockwerk
- Energie heute ein-/ausblenden
- Statuswerte ein-/ausblenden

## YAML-Dokumentation

Vollständige Referenz:

- [`docs/card-yaml-reference.md`](docs/card-yaml-reference.md)
- [`docs/card-examples.yaml`](docs/card-examples.yaml)

---

# Ansichten

## SYSTEM

Kombinierte technische Ansicht:

```text
ELEKTRISCH
    ↓
ENERGIEWANDLUNG
    ↓
THERMISCH
    ↓
GEBÄUDE
```

Elektrische Wärmeerzeuger wie Wärmepumpe oder AC ELWA 2 bilden die Brücke zwischen elektrischer und thermischer Ebene.

## ELEKTRISCH

- Netzreferenz
- PV / Erzeuger
- Batteriespeicher
- elektrische Verteilung
- Gebäude- und Stockwerkslayout
- aktuelle Leistung
- Energie heute

## THERMISCH

- Wärmepumpen
- Heizkessel
- elektrische Heizstäbe
- Kamine / sonstige Wärmeerzeuger
- Pufferspeicher
- direkte Raumwärme

## KONFIGURATION

Nur für Home-Assistant-Administratoren.

Hier werden Datenquellen, Wärmeerzeuger, Pufferspeicher, Bereiche, Berechnungen und das Gebäudelayout eingerichtet.

---

# Magnetisches Gebäudelayout

Jeder Bereich besitzt einen Layoutzustand:

```text
DOCKED
oder
FREE
```

## DOCKED

- automatische Zentrierung pro Stockwerk
- Kacheln liegen ohne künstliche Zwischenräume aneinander
- Breite und Höhe der Kachel bleiben konfigurierbar
- Drag-and-drop innerhalb des Verbunds ändert die Reihenfolge
- die Stockwerksfläche wächst mit den benötigten Reihen

## FREE

Wird eine Kachel deutlich außerhalb des angedockten Verbunds abgelegt, wird sie frei positioniert.

Die freie Kachel behält ihre Rasterposition.

Wird sie wieder nahe am angedockten Verbund abgelegt, wechselt sie automatisch zurück zu `DOCKED` und wird an der Drop-Position einsortiert.

Der Modus kann zusätzlich im Bereichsinspektor manuell umgeschaltet werden.

## Eigene Stockwerksnamen

In der Bereichskonfiguration kann direkt unter der Stockwerksauswahl ein eigener Name eingetragen werden, zum Beispiel:

```text
Galerie
Werkstatt
Garage
Technikebene
Nebengebäude
```

Mit **HINZUFÜGEN** wird die Ebene angelegt und der aktuell ausgewählte Bereich sofort zugeordnet.

---

# Energie heute

Die konfigurierte Energie-Entity darf ein Gesamtzähler sein.

Das Dashboard zeigt den Gesamtstand nicht direkt als Tageswert an. Es verwendet Home Assistants Recorder-Statistik ab lokalem Tagesbeginn und wertet die Statistikänderung des aktuellen Tages aus.

Berechnete Bereiche verwenden dieselbe Berechnungstopologie für:

- aktuelle Leistung
- Energie heute

Beispiel:

```text
EG REST = EG - KÜCHE - WOHNEN
```

Dann gilt automatisch auch:

```text
EG REST HEUTE = EG HEUTE - KÜCHE HEUTE - WOHNEN HEUTE
```

## Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV.

Es verwendet vorhandene Home-Assistant-Entities und Home Assistants Recorder-Statistik.
