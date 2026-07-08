# Energy System Dashboard 0.1.0

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Installation zum Testen

1. Den Ordner `custom_components/energy_system_dashboard` nach `/config/custom_components/` kopieren.
2. Home Assistant neu starten.
3. **Einstellungen → Geräte & Dienste → Integration hinzufügen** öffnen.
4. Nach **Energy System Dashboard** suchen und hinzufügen.
5. In der Seitenleiste **Energiesystem** öffnen.
6. Im Tab **Konfiguration** vorhandene Home-Assistant-Entities zuordnen.

## V0.1

- optionale Netzreferenz
- modulare Erzeuger
- Batteriespeicher-Module
- getrennte Wärmepumpe, Heizkessel, Heizstab und Kamin
- optionaler Pufferspeicher mit beliebig vielen Temperaturfühlern
- hierarchische Hausbereiche mit Parent/Child-Zählern
- automatische Restlast pro Bereich: Bereichszähler minus direkte Unterzähler
- technisches Single-Line-/SCADA-Design
- Konfiguration persistent in Home Assistant `.storage`
- Echtzeitwerte direkt aus vorhandenen Home-Assistant-Entities

Die V0.1 kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Sie verwendet ausschließlich die bereits in Home Assistant vorhandenen Entities.
