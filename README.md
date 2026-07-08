# Energy System Dashboard 0.2.1

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Neu in 0.2.1

### Einheitliches technisches Raster

- Elektrisch, Thermisch, Bereiche und Gebäude-Editor verwenden dieselbe 12-Spalten-Layoutsprache.
- Im elektrischen Reiter wird der konfigurierte Gebäudeplan des ausgewählten Stockwerks direkt wiederverwendet.
- Der thermische Reiter verwendet ebenfalls ein geschlossenes Raster statt frei auseinanderlaufender Kartenreihen.

### Haus als fester Root-Bereich

- Der Bereich mit der ID `house` wird als Gesamtbereich behandelt.
- `Haus` steht im Gebäude-Editor immer ganz oben über die komplette Breite.
- Die Haus-Kachel ist nicht verschiebbar und besitzt keine Stockwerksposition.
- Haus wird nicht zusätzlich in die Endbereichssumme der elektrischen Verteilung aufgenommen, solange andere Endbereiche existieren.

### Stockwerksauswahl

- Frei benennbare Stockwerke/Ebenen bleiben erhalten.
- Im Gebäude-Editor werden Stockwerke per Tab ausgewählt.
- Auch die Reiter **Elektrisch** und **Bereiche** besitzen eine Stockwerksauswahl.
- Die Anzeige verwendet auf jedem Stockwerk exakt dieselben gespeicherten X/Y/W/H-Positionen.

### Echtes Einrasten der Bereichskacheln

- Das 12 × 12 Raster hat keine künstlichen Zwischenräume mehr.
- Drag-and-drop rastet exakt auf Rasterzellen ein.
- Kacheln liegen direkt Kante an Kante.
- Eine Kollisionsprüfung sucht beim Ablegen die nächste freie Rasterposition, statt eine andere Kachel zu überdecken.
- Neue Bereiche werden automatisch auf der nächsten freien Position des ausgewählten Stockwerks angelegt.

### Gemessene und berechnete Bereiche

Jeder Bereich ist entweder:

- **M / Gemessen**: direkte Home-Assistant-Entity für aktuelle Leistung und Energiezähler.
- **C / Berechnet**: Wert wird aus anderen Bereichen gebildet.

Berechnungsarten:

- **Differenz**: Basisbereich minus ausgewählte Bereiche.
- **Summe**: ausgewählte Bereiche addieren.
- **Benutzerdefiniert**: kombinierbare `+` / `−` Zeilen.

### Leistung der elektrischen Verteilung

Die elektrische Verteilung summiert weiterhin die Endbereiche der messtechnischen Zerlegung. Der feste Root-Bereich `Haus` wird dabei nicht zusätzlich addiert.

### Nur Energie HEUTE

Die konfigurierte Energie-Entity darf ein Gesamtzähler sein. Das Dashboard verwendet Home Assistants Recorder-Statistik ab lokalem Tagesbeginn und zeigt die Änderung des heutigen Tages in kWh.

## Installation / Update

1. `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem → Konfiguration** öffnen.
5. Gebäudeplan prüfen und speichern.

Bestehende 0.2.0-Konfigurationen bleiben erhalten. Die `Haus`-Kachel wird bei der Migration automatisch auf die feste Root-Position über volle Breite gesetzt.

## Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Es verwendet vorhandene Home-Assistant-Entities und Home Assistants Recorder-Statistik.
