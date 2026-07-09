# Energy System Dashboard 0.3.1

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Neu in 0.3.1

- Stockwerke werden in `SYSTEM` und `ELEKTRISCH` als gemeinsamer Gebäudestapel dargestellt
- jedes Stockwerk besitzt die seitliche, vertikale Stockwerksreferenz aus dem Gebäudeeditor
- im **Magnetischen Gebäudeplan** gibt es einen zusätzlichen, gut sichtbaren Button **GEBÄUDEPLAN SPEICHERN**
- echte Parent/Child-Hierarchie für Bereiche über `parent_id`
- jeder Bereich besitzt im Inspektor eine Unterkonfiguration **HIERARCHIE / PARENT & CHILD**
- `+ UNTERBEREICH` legt direkt ein Child unter dem ausgewählten Parent an
- bestehende Bereiche können einem Parent nachträglich zugeordnet werden
- berechnete Bereiche verwenden einen messwertbezogenen GUI-Berechnungseditor
- aktuelle Leistung und Energie heute werden unabhängig voneinander konfiguriert
- Berechnungsquellen können ein Bereichswert oder eine konkrete Home-Assistant-Entity sein
- nicht konfigurierte Module und Bereiche werden in den Live-Übersichten nicht gerendert
- die elektrische Verteilung summiert die konfigurierten Blattbereiche der echten Parent/Child-Hierarchie
- bestehende 0.3.0-Bereichsberechnungen werden automatisch auf das neue Messwertmodell migriert

## Installation / Update

1. Den bisherigen Ordner `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem** in der Seitenleiste öffnen.
5. Unter **KONFIGURATION** die migrierten Bereiche kontrollieren und speichern.

Die zentrale Konfiguration wird beim Laden normalisiert. V0.3.0-Bereiche ohne Parent werden standardmäßig `Haus` zugeordnet.

---

# Bereichshierarchie

Die räumliche Position im Gebäude und die logische Parent/Child-Hierarchie sind getrennt.

Beispiel:

```text
Haus
├── UG
│   ├── Technik
│   └── Heizung
├── EG
│   ├── Küche
│   ├── Wohnen
│   └── EG Rest
└── OG
```

Im Inspektor eines Bereichs gibt es:

```text
HIERARCHIE / PARENT & CHILD

Übergeordneter Bereich
[ Erdgeschoss ▼ ]

UNTERBEREICHE
Küche              KONFIGURIERT
Wohnen              KONFIGURIERT
EG Rest             KONFIGURIERT

[ + UNTERBEREICH ]

[ Bestehenden Bereich auswählen ▼ ] [ ZUORDNEN ]
```

Die Hierarchie ist **nicht automatisch eine Rechenformel**. Ein Child wird nur dann mathematisch einbezogen, wenn es im Berechnungseditor als Messwert ausgewählt wurde.

## Elektrische Gesamtleistung

Für `ELEKTRISCHE VERTEILUNG` werden nur konfigurierte Blattbereiche der Parent/Child-Hierarchie addiert.

```text
EG 5,8 kW
├── Küche     1,4 kW
├── Wohnen    2,1 kW
└── EG Rest   2,3 kW
```

Gezählt wird:

```text
Küche + Wohnen + EG Rest = 5,8 kW
```

`EG` wird nicht zusätzlich addiert.

---

# GUI-Berechnungseditor

Ein berechneter Bereich besitzt zwei unabhängige Berechnungen:

```text
AKTUELLE LEISTUNG
ENERGIE HEUTE
```

Für jede Berechnung werden Messwerte über die GUI ausgewählt.

Beispiel Leistung:

```text
OP   MESSWERT
+    Erdgeschoss · AKTUELLE LEISTUNG
-    Küche · AKTUELLE LEISTUNG
-    Wohnen · AKTUELLE LEISTUNG
```

Beispiel Energie heute:

```text
OP   MESSWERT
+    sensor.shelly_eg_total_energy
-    Küche · ENERGIE HEUTE
-    Wohnen · ENERGIE HEUTE
```

Als Quelle sind möglich:

- **Bereichswerte**: bereits gemessene oder berechnete Bereiche
- **Home Assistant Entities**: konkrete Power- beziehungsweise Energy-Entities

Die Entity-Auswahl wird passend zum Zielwert gefiltert:

- Leistung: `power`, W, kW, MW
- Energie heute: `energy`, Wh, kWh, MWh usw.

Zyklische Bereichsberechnungen werden verhindert beziehungsweise beim Laden einer fehlerhaften importierten Konfiguration entfernt.

## Energie heute

Eine ausgewählte Energie-Entity darf ein Gesamtzähler sein. Das Dashboard verwendet Home Assistants Recorder-Statistik ab lokalem Tagesbeginn und zeigt die Änderung des aktuellen Tages.

---

# Stockwerksdarstellung

Im Panel werden die belegten, konfigurierten Stockwerke gemeinsam übereinander dargestellt:

```text
│ OG │  [ BAD ][ SCHLAFEN ][ KIND ]
│ EG │  [ KÜCHE ][ WOHNEN ][ BÜRO ]
│ UG │  [ TECHNIK ][ HEIZUNG ]
```

Die seitliche Referenz entspricht dem Magnetischen Gebäudeplan.

Nicht konfigurierte Bereiche bleiben ausschließlich im Konfigurator sichtbar und füllen die Live-Ansichten nicht mit `—`-Kacheln.

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
- lückenloser Kachelverbund
- Drag-and-drop im Verbund ändert die Reihenfolge
- Stockwerksfläche wächst dynamisch

## FREE

Eine deutlich außerhalb des Verbunds abgelegte Kachel wird frei positioniert. In der Nähe des Verbunds dockt sie wieder automatisch an.

Eigene Stockwerksnamen können direkt in der Bereichskonfiguration ergänzt werden.

Am unteren Ende des Gebäudeeditors befindet sich zusätzlich:

```text
[ GEBÄUDEPLAN SPEICHERN ]
```

---

# Read-only Lovelace-Karte

Die Lovelace-Karte verwendet dieselbe zentral gespeicherte Topologie. Es werden keine Entity-IDs in der Karten-YAML konfiguriert.

## JavaScript-Ressource

```text
/energy_system_dashboard/energy-system-card.js?v=0.3.1
```

Home Assistant:

```text
Einstellungen → Dashboards → Ressourcen
```

```text
URL: /energy_system_dashboard/energy-system-card.js?v=0.3.1
Typ: JavaScript-Modul
```

Bei YAML-verwalteten Ressourcen:

```yaml
lovelace:
  resources:
    - url: /energy_system_dashboard/energy-system-card.js?v=0.3.1
      type: module
```

## Minimalbeispiel

```yaml
type: custom:energy-system-card
view: system
```

Vollständige Dokumentation:

- `docs/card-yaml-reference.md`
- `docs/card-examples.yaml`

---

# Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV.

Es verwendet vorhandene Home-Assistant-Entities und die Recorder-Statistik.
