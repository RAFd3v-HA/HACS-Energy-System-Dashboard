# Energy System Card – YAML-Referenz

Die Karte ist eine read-only Darstellung der zentralen Energy-System-Konfiguration.

## Minimalbeispiel

```yaml
type: custom:energy-system-card
view: system
```

## Vollständiges Beispiel

```yaml
type: custom:energy-system-card

# ------------------------------------------------------------
# ANSICHT
# ------------------------------------------------------------
# system      Elektrisches + thermisches Gesamtsystem
# electrical  Elektrische Detailansicht
# thermal     Thermische Detailansicht
# building    Reine Gebäude- und Bereichsansicht
#
view: system

# ------------------------------------------------------------
# DARSTELLUNG
# ------------------------------------------------------------
# full        Vollständige technische Darstellung
# compact     Gleiche Datenstruktur mit geringerer optischer Dichte
#
display: full

# ------------------------------------------------------------
# TITEL
# ------------------------------------------------------------
# Optional.
# Leer oder nicht angegeben = Name aus der zentralen
# Energy-System-Konfiguration.
#
title: Energiesystem

# ------------------------------------------------------------
# STOCKWERKSAUSWAHL
# ------------------------------------------------------------
# true   Stockwerk kann in der read-only Karte gewechselt werden
# false  Stockwerksauswahl wird ausgeblendet
#
# Die Auswahl ändert ausschließlich die lokale Kartenansicht.
# Die zentrale Konfiguration wird NICHT verändert.
#
floor_selector: true

# ------------------------------------------------------------
# STANDARD-STOCKWERK
# ------------------------------------------------------------
# Optional.
# Muss exakt dem Namen eines konfigurierten Stockwerks entsprechen.
# Groß-/Kleinschreibung wird beim Suchen ignoriert.
#
# Beispiele:
# EG
# OG
# Galerie
# Garage
#
default_floor: EG

# ------------------------------------------------------------
# ENERGIE HEUTE
# ------------------------------------------------------------
# true   Tagesenergie anzeigen
# false  Tagesenergie ausblenden
#
# Die Werte stammen aus der zentralen Konfiguration und den
# Recorder-Statistiken des aktuellen Tages.
#
show_daily_energy: true

# ------------------------------------------------------------
# STATUSWERTE
# ------------------------------------------------------------
# true   Statuskennzeichnungen anzeigen
# false  Statuskennzeichnungen ausblenden
#
# Beispiele:
# IMPORT
# EXPORT
# HEATING
# STANDBY
# CHARGE
# DISCHARGE
#
show_status: true
```

---

## Optionsübersicht

| Option | Typ | Standard | Erlaubte Werte / Bedeutung |
|---|---|---|---|
| `type` | string | erforderlich | `custom:energy-system-card` |
| `view` | string | `system` | `system`, `electrical`, `thermal`, `building` |
| `display` | string | `full` | `full`, `compact` |
| `title` | string | zentraler Name | eigener Kartentitel |
| `floor_selector` | boolean | `true` | Stockwerksumschaltung anzeigen |
| `default_floor` | string | erstes verfügbares Stockwerk | Start-Stockwerk |
| `show_daily_energy` | boolean | `true` | Energie heute anzeigen |
| `show_status` | boolean | `true` | Statuskennzeichnungen anzeigen |

---

# `view`

## `system`

```yaml
type: custom:energy-system-card
view: system
```

Zeigt die kombinierte Systemtopologie:

```text
ELEKTRISCH
→ ENERGIEWANDLUNG
→ THERMISCH
→ GEBÄUDE
```

Geeignet als Hauptansicht.

## `electrical`

```yaml
type: custom:energy-system-card
view: electrical
```

Zeigt Netz, Erzeuger, Speicher, elektrische Verteilung und das ausgewählte Stockwerk.

## `thermal`

```yaml
type: custom:energy-system-card
view: thermal
```

Zeigt Wärmeerzeuger, Pufferspeicher und direkte Wärmesenken.

## `building`

```yaml
type: custom:energy-system-card
view: building
```

Zeigt den Haus-Root-Bereich und die gespeicherte magnetische Bereichsanordnung des ausgewählten Stockwerks.

---

# `display`

## `full`

```yaml
display: full
```

Vollständige technische Darstellung einschließlich Metadaten und Logikhinweisen.

## `compact`

```yaml
display: compact
```

Reduziert die optische Dichte. Die zentrale Topologie und die Messwerte bleiben identisch.

`compact` ist keine andere Datenquelle und keine zweite Konfiguration.

---

# `floor_selector`

```yaml
floor_selector: true
```

Zeigt die Stockwerksauswahl.

```yaml
floor_selector: false
```

Blendet sie aus.

Die Umschaltung ist read-only und speichert keine Änderung im Energy System Dashboard.

---

# `default_floor`

```yaml
default_floor: EG
```

Das Stockwerk wird anhand seines Namens gesucht.

Eigene Stockwerksnamen sind erlaubt:

```yaml
default_floor: Galerie
```

Ist das Stockwerk nicht vorhanden, zeigt die Karte einen verständlichen Fehler und listet die verfügbaren Stockwerke auf.

Für eine fest auf ein Stockwerk begrenzte Gebäudeansicht:

```yaml
type: custom:energy-system-card
view: building
floor_selector: false
default_floor: EG
```

---

# `show_daily_energy`

```yaml
show_daily_energy: true
```

Zeigt `HEUTE`-Werte.

```yaml
show_daily_energy: false
```

Blendet Tagesenergie optisch aus.

Die Berechnung im Energy-System-Backend beziehungsweise Renderer wird dadurch nicht verändert.

---

# `show_status`

```yaml
show_status: true
```

Zeigt Statuskennzeichnungen der technischen Nodes.

```yaml
show_status: false
```

Blendet die Statuskennzeichnungen aus.

---

# Fehlerbehandlung

Ungültige Ansicht:

```yaml
view: house
```

Erzeugt einen Karten-Konfigurationsfehler mit den erlaubten Werten:

```text
system, electrical, thermal, building
```

Ungültige Darstellung:

```yaml
display: tiny
```

Erzeugt einen Karten-Konfigurationsfehler mit:

```text
full, compact
```

Nicht vorhandenes Stockwerk:

```yaml
default_floor: Keller
```

Die Karte zeigt:

```text
Stockwerk „Keller“ wurde nicht gefunden.
Verfügbar: UG, EG, OG, DG
```

---

# Bewusste Trennung

Die Karten-YAML beschreibt ausschließlich die Darstellung.

```text
KONFIGURATOR
= Was ist mein Energiesystem?

KARTEN-YAML
= Wie soll dieses Energiesystem hier angezeigt werden?
```

Folgende Daten gehören daher NICHT in die Karten-YAML:

- Shelly Entity-IDs
- Tasmota Entity-IDs
- Viessmann Entity-IDs
- my-PV Entity-IDs
- Bereichsberechnungen
- Pufferspeicherfühler
- Stockwerksaufbau
- Kachelpositionen

Diese Daten werden einmal zentral im Energy System Dashboard konfiguriert.
