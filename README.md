# Energy System Dashboard 0.2.2

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Neu in 0.2.2

### Stockwerk direkt am Bereich auswählen

Die separate Stockwerksverwaltung im Gebäude-Editor wurde aus der sichtbaren Oberfläche entfernt.

Jeder Bereich besitzt jetzt direkt im rechten Inspektor das Feld **Stockwerk**. Vorhandene Ebenen und technische Standard-Stockwerke werden im selben Auswahlfeld angeboten:

- 3. UG
- 2. UG
- UG
- EG
- OG
- 2. OG
- 3. OG
- DG

Wird ein Standard-Stockwerk ausgewählt, das bisher noch nicht existiert, legt das Dashboard die Ebene automatisch an. Eine separate Aktion `+ STOCKWERK` ist nicht mehr erforderlich.

### Automatische Gruppierung im Konfigurator

Alle belegten Stockwerke werden im Gebäude-Editor gleichzeitig untereinander dargestellt. Eine Bereichskachel erscheint automatisch in der Gruppe des zugewiesenen Stockwerks.

Beim Wechsel des Stockwerks:

1. wird die Kachel aus der bisherigen Stockwerksgruppe entfernt,
2. dem neuen Stockwerk zugeordnet,
3. auf die nächste freie Rasterposition dieses Stockwerks eingerastet.

Die optische Gruppierung ist sofort sichtbar, noch bevor die Gesamtkonfiguration gespeichert wird.

### Vertikaler Stockwerksindikator

Links neben jeder Stockwerksgruppe befindet sich ein fester vertikaler Indikator mit der Stockwerksbezeichnung, zum Beispiel `DG`, `OG`, `EG` oder `UG`.

Die Bereiche liegen rechts davon im jeweiligen 12-Spalten-Raster. Dadurch entspricht die vertikale Gruppierung im Editor der Lage im Gebäude: obere Stockwerke werden oberhalb von EG und Untergeschossen dargestellt.

### Haus bleibt fester Root-Bereich

`Haus` steht weiterhin ganz oben über die komplette Breite. Die Haus-Kachel ist stockwerksübergreifend, nicht verschiebbar und wird nicht als zusätzliche Ebene behandelt.

### Mess- und Berechnungslogik bleibt getrennt

Die Stockwerkszuordnung beeinflusst nur die räumliche Darstellung. Gemessene und berechnete Bereiche können weiterhin unabhängig davon über Differenz-, Summen- oder benutzerdefinierte Berechnungen verbunden werden.

### Energie HEUTE

Die konfigurierte Energie-Entity darf ein Gesamtzähler sein. Das Dashboard verwendet die Home-Assistant-Recorder-Statistik ab lokalem Tagesbeginn und zeigt die Änderung des heutigen Tages in kWh.

## Installation / Update

1. `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem → Konfiguration** öffnen.
5. Einen Bereich auswählen und das gewünschte **Stockwerk** zuweisen.
6. Gebäudeplan prüfen und speichern.

Bestehende 0.2.x-Konfigurationen bleiben erhalten. Bereits vorhandene Ebenen werden weiterhin angeboten; leere Ebenen werden im Gebäude-Editor nicht als eigene Gruppe dargestellt.

## Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Es verwendet vorhandene Home-Assistant-Entities und Home Assistants Recorder-Statistik.
