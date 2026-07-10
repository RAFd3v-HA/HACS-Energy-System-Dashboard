# Energy System Dashboard V0.5.0

## V0.5.0 – Combined system view, room climate and grouped energy modules

- New combined **SYSTEM** view: electrical flow enters the shared building stack from above; thermal flow enters the same floors from below.
- Floor panels grow with expanded child areas and remain compact while children are collapsed.
- Optional room climate per child from a `climate` entity or separate current/target temperature entities. Parent areas show the recursive average current room temperature only when climate values exist.
- Optional supply and return temperatures per area/floor. Thermal floor ports can show supply temperature; return and calculated delta-T are shown when available.
- PV is rendered as one main frame with summed current production and daily energy; configured PV sources are listed inside the same frame. Grid-operator reduction remains visible as `PRODUCTION / REDUCED`.
- Batteries are rendered as one main frame with summed power, aggregated state of charge, total configured capacity and individual partial stores inside the same frame.
- The **ELEKTRISCHE VERTEILUNG** frame is closed on both sides.
- Existing calculations, generated Home Assistant sensors, parent/child hierarchy, floor ordering and read-only Lovelace card remain compatible.

## V0.4.4

- Netzleistung wird normiert dargestellt: **Bezug positiv, Einspeisung negativ**. Die konfigurierte Vorzeichenrichtung der Quell-Entity bleibt erhalten und dient nur zur Interpretation des Rohwerts.

# Energy System Dashboard V0.4.4

## V0.4.4 – Mobile / Responsive Layout

Bis 640 px nutzt das Panel eine eigene mobile Darstellung. Das Desktop-Einlinienschema bleibt unverändert. Stockwerke werden mobil als vertikaler Stack mit horizontalem Stockwerkskopf gerendert; Parent/Child-Hierarchien bleiben verschachtelt. Modulfelder laufen einspaltig, Navigation bleibt horizontal scrollbar und Formulare erhalten größere Touch-Ziele. Der magnetische 12-Spalten-Editor bleibt technisch maßstabsstabil und wird auf kleinen Displays horizontal scrollbar.

Siehe auch `MOBILE.md`.

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## V0.4.4 – Quellen-Dropdown im Berechnungseditor

- Live-Updates von Home Assistant ersetzen ein gerade aktives Dropdown oder Eingabefeld im Reiter **BERECHNUNGEN** nicht mehr.
- Solange ein Berechnungsfeld fokussiert ist, wird ein Live-Neurendering zurückgestellt.
- Nach dem Verlassen des Feldes wird ein eventuell aufgeschobenes Live-Update einmalig gerendert.
- Die eigentliche Quellenwahl und die Berechnungslogik bleiben unverändert.

## V0.4.0 – Zentrale Berechnungen und echte Home-Assistant-Sensoren

V0.4.0 trennt Berechnungen vollständig vom Gebäudeeditor. Berechnete Messwerte werden zentral im neuen Reiter **BERECHNUNGEN** aufgebaut und können anschließend in der Konfiguration als Messwertquelle verwendet werden.

### Neuer Reiter `BERECHNUNGEN`

Die Oberfläche besteht aus einer Messwertliste links und einem technischen Signal-/Recheneditor rechts:

```text
BERECHNETE MESSWERTE        WOHNUNG OHNE WASCHMASCHINE

Wohnung Rest      408 W     + Wohnung Leistung       415 W
EG Rest          2,31 kW    - Waschmaschine            7 W
Technik gesamt    820 W     ──────────────────────────────
                              ERGEBNIS                 408 W
```

Pro Berechnung wird eine Messgröße festgelegt:

- Elektrische Leistung
- Energie heute
- Thermische Leistung
- Thermische Energie heute

Die Quellenauswahl wird passend zur Messgröße gefiltert. Rechenzeilen unterstützen `+` und `−` und können auf folgende Quellen zugreifen:

- Bereichsmesswerte
- andere kompatible berechnete Messwerte
- Home-Assistant-Entities

Die Live-Berechnung zeigt jeden Einzelwert und das Ergebnis separat an.

### Berechneten Messwert als Home-Assistant-Sensor bereitstellen

Bei jeder Berechnung gibt es:

```text
[✓] ALS HOME ASSISTANT SENSOR BEREITSTELLEN
```

Nach dem Speichern stellt die Integration eine echte Sensor-Entity bereit, zum Beispiel:

```text
sensor.wohnung_ohne_waschmaschine
```

Die technische Zuordnung verwendet eine stabile Calculation-ID beziehungsweise `unique_id`. Eine in Home Assistant später geänderte Entity-ID zerstört deshalb nicht die interne Berechnungsdefinition.

Die Sensortypen werden automatisch passend gesetzt:

```text
Elektrische / thermische Leistung
device_class  power
unit          W
state_class   measurement

Energie heute / thermische Energie heute
device_class  energy
unit          kWh
state_class   total
last_reset    lokaler Tagesbeginn
```

Es werden nur Sensoren angelegt, bei denen die Bereitstellung ausdrücklich aktiviert wurde.

### Berechnete Messwerte in der Konfiguration verwenden

Im Gebäudeeditor besitzt jeder Bereich vier Messwertquellen:

```text
ELEKTRISCHE LEISTUNG
ENERGIE HEUTE
THERMISCHE LEISTUNG
THERMISCHE ENERGIE HEUTE
```

Pro Messwert kann die Quelle gewählt werden:

```text
Nicht konfiguriert
Home Assistant Entity
Berechneter Messwert
```

Beispiel:

```text
Bereich: EG Rest

ELEKTRISCHE LEISTUNG
Quelle: Berechneter Messwert
Messwert: EG Restleistung
```

Berechnete HA-Sensoren werden in normalen Entity-Auswahllisten zusätzlich in der Gruppe **BERECHNETE MESSWERTE** vor den übrigen Home-Assistant-Entities angezeigt.

### Berechnung läuft im Backend

Die zentrale Calculation Engine läuft in der Home-Assistant-Integration. Dashboard, read-only Karte und optionale Sensor-Entities greifen dadurch auf dieselbe Berechnung zurück.

```text
HOME ASSISTANT ENTITIES
          │
          ▼
CALCULATION ENGINE
          │
          ├── Dashboard
          ├── Read-only Lovelace Card
          └── SensorEntity
```

Tagesenergien werden weiterhin aus den Recorder-Statistiken ab lokalem Tagesbeginn gebildet.

## V0.4.0 – Raster Option B

Das globale CAD-artige Kreuzraster ist entfernt.

Außerhalb der Stockwerksflächen verwendet die Oberfläche einen nahezu ruhigen, einfarbigen technischen Hintergrund.

Das Raster erscheint nur innerhalb der tatsächlichen Stockwerksflächen:

```text
ELEKTRISCHE VERTEILUNG
────────────────────────────────────────

       fast rasterfreier Systembereich

┌ OG ┬──────────────────────────────────┐
│    │  │      │      │      │          │
│    │  ─────────────────────────────    │
│    │        STOCKWERKSRASTER           │
└────┴──────────────────────────────────┘

       fast rasterfreier Zwischenbereich
```

Die Stockwerksraster sind zusätzlich etwas zurückhaltender gezeichnet. Parent-/Child-Gruppen erhalten einen garantierten vertikalen Innenabstand und werden weiterhin als gemeinsamer Verbund in der verfügbaren Stockwerksfläche zentriert.

## Bestehende Funktionen

- optionale Netzreferenz
- PV-/Erzeugermodule
- Batteriespeicher
- getrennte Wärmeerzeuger wie Wärmepumpe, Heizkessel, elektrischer Heizstab und Kamin
- elektrische und thermische Verteilungen
- frei benannte Stockwerke beziehungsweise Ebenen
- magnetischer Gebäudeplan mit angedockten und freien Root-Bereichen
- echte Parent-/Child-Hierarchie
- Stockwerksaggregation ohne Doppelzählung von Unterzählern
- Energie heute aus Recorder-Statistiken
- read-only Lovelace-Karte mit zentraler Topologie

## Installation / Update

1. Den bisherigen Ordner `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem → BERECHNUNGEN** öffnen.
5. Berechnete Messwerte anlegen und speichern.
6. Unter **KONFIGURATION → MAGNETISCHER GEBÄUDEPLAN** die berechneten Messwerte als Bereichsquellen auswählen.

Bestehende V0.3.x-Bereichsberechnungen werden beim Laden in zentrale Berechnungen migriert und den bisherigen Bereichen wieder als Messwertquelle zugeordnet.

## Read-only Lovelace-Karte

Die Karte verwendet dieselbe zentrale Topologie und dieselben Berechnungsergebnisse. Es werden keine Entity-IDs in der Karten-YAML benötigt.

### JavaScript-Ressource

```text
/energy_system_dashboard/energy-system-card.js?v=0.5.0
```

Home Assistant:

```text
Einstellungen → Dashboards → Ressourcen
```

```text
URL: /energy_system_dashboard/energy-system-card.js?v=0.5.0
Typ: JavaScript-Modul
```

Bei YAML-verwalteten Ressourcen:

```yaml
lovelace:
  resources:
    - url: /energy_system_dashboard/energy-system-card.js?v=0.5.0
      type: module
```

Minimalbeispiel:

```yaml
type: custom:energy-system-card
view: system
```

Vollständige Karten-YAML-Dokumentation:

- `docs/card-yaml-reference.md`
- `docs/card-examples.yaml`

## Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Es verwendet vorhandene Home-Assistant-Entities. Die zentrale Berechnungsengine kombiniert diese Messwerte und kann ausgewählte Ergebnisse wiederum als Home-Assistant-Sensoren bereitstellen.


## V0.4.4
- Stockwerksreihenfolge per Drag & Drop am seitlichen Stockwerksindikator.
- PV-Begrenzungs-Entity: `PRODUCTION / REDUCED` und grün/orange wechselnder Statuspunkt.
- Parent/Child in Übersichten standardmäßig eingeklappt; Klick auf Parent klappt rekursiv auf. Lovelace: `expand_children`.
- Heizstab: Status wahlweise per Status-Entity oder automatisch aus Leistung mit konfigurierbarem Schwellwert (Standard 100 W).
- Heizstab: optionale Zieltemperatur-Entity.
- Thermische Flows werden nur zu einem tatsächlich sichtbaren Pufferspeicher gerendert.
