# Energy System Dashboard 0.1.2

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## Installation / Update

1. Den bisherigen Ordner `/config/custom_components/energy_system_dashboard` vollständig ersetzen.
2. Den Ordner `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. In der Seitenleiste **Energiesystem** öffnen.
5. Im Tab **Konfiguration** die zusätzlichen Energie-Entities zuordnen und **Speichern**.

Die bestehende Dashboard-Konfiguration wird weiterverwendet. Neue kWh-Felder starten leer und müssen einmal zugeordnet werden.

## Neu in 0.1.2

- separate Energie-Entities (Wh/kWh) zusätzlich zu W/kW
- Netz: Bezug und Einspeisung jeweils mit eigener Energie-Entity
- PV/Erzeuger: erzeugte Energie
- Batteriespeicher: geladene und entladene Energie
- Wärmeerzeuger: elektrische Energie
- Hausbereiche: eigene Energie-Entity je Bereich
- automatische Umrechnung gängiger Energieeinheiten auf kWh
- keine Browser-Integration von Live-Wattwerten; es werden echte Home-Assistant-Energiezähler verwendet

## Bereits enthalten

- optionale Netzreferenz
- modulare Erzeuger
- Batteriespeicher-Module
- getrennte Wärmepumpe, Heizkessel, Heizstab und Kamin
- optionaler Pufferspeicher mit beliebig vielen Temperaturfühlern
- hierarchische Hausbereiche mit Parent/Child-Zählern
- automatische Restlast pro Bereich für aktuelle Leistung
- technisches Single-Line-/SCADA-Design
- Konfiguration persistent in Home Assistant `.storage`
- Echtzeitwerte direkt aus vorhandenen Home-Assistant-Entities

Die Integration kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Sie verwendet ausschließlich die bereits in Home Assistant vorhandenen Entities.


## V0.1.3 – Leistung der elektrischen Verteilung

Die aktuelle Leistung in der elektrischen Hauptansicht wird aus den Leistungs-Entities aller Blatt-Bereiche summiert. Ein Blatt-Bereich ist ein Bereich ohne untergeordnete Bereiche. Parent-Bereiche werden nicht in diese Summe aufgenommen. Dieselbe Entity-ID wird höchstens einmal berücksichtigt.
