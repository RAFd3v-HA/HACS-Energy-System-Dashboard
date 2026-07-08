# Energy System Dashboard 0.2.0

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Neu in 0.2.0

### Gebäudelayout statt starrer Bereichsliste

- frei definierbare Ebenen wie UG, EG, OG, Garage oder Nebengebäude
- 12 × 12 Raster je Ebene
- Bereiche per Drag-and-drop im Raster platzieren
- Position und Größe (X, Y, Breite, Höhe) zusätzlich exakt im Inspector einstellbar
- die Übersicht verwendet dieselbe räumliche Anordnung
- Ebenen werden in der Bereichsansicht wie ein Gebäude übereinander dargestellt

### Gemessene und berechnete Bereiche

Jeder Bereich ist entweder:

- **M / Gemessen**: direkte Home-Assistant-Entity für aktuelle Leistung und Energiezähler
- **C / Berechnet**: Wert wird aus anderen Bereichen gebildet

Berechnungsarten:

- **Differenz**: Basisbereich minus ausgewählte Bereiche
- **Summe**: ausgewählte Bereiche addieren
- **Benutzerdefiniert**: frei kombinierbare `+` / `−` Zeilen

Zyklische Berechnungsabhängigkeiten werden beim Speichern verworfen. Die Auswahllisten blenden Bereiche aus, die unmittelbar eine zyklische Abhängigkeit erzeugen würden.

### Leistung der elektrischen Verteilung

Die elektrische Verteilung summiert die Endbereiche der messtechnischen Zerlegung.

Beispiel:

```text
EG = 5,8 kW
EG Rest = EG - Küche - Wohnen

Endbereiche:
Küche + Wohnen + EG Rest = 5,8 kW
```

Die freie Position einer Kachel im Gebäudeplan beeinflusst diese Messlogik nicht.

### Nur Energie HEUTE

Die konfigurierte Energie-Entity darf weiterhin der Gesamtzähler des Shelly/Tasmota/anderen Geräts sein.

Das Dashboard fragt Home Assistants Recorder-Statistik ab lokalem Tagesbeginn ab und zeigt die Änderung des heutigen Tages in kWh. Der Gesamtzählerstand wird in der Übersicht nicht mehr angezeigt.

Bei bereits vorhandenen Tages-Sensoren (`today`, `daily`, `heute`, `tag` im Entity-Namen oder Friendly Name) kann der aktuelle Sensorwert als Fallback verwendet werden.

## Installation / Update

1. `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem → Konfiguration** öffnen.
5. Unter **Gebäudeplan und Bereichsberechnung** Ebenen und Bereiche anordnen.
6. **Speichern**.

Bestehende 0.1.x-Konfigurationen werden auf das neue Datenmodell migriert. Alte Bereiche erscheinen zunächst gemeinsam auf der Standardebene **Gebäude** und können anschließend per GUI auf UG/EG/OG verteilt werden.

## Datenquellen

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Es verwendet vorhandene Home-Assistant-Entities und Home Assistants Recorder-Statistik.
