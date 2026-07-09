# Energy System Dashboard 0.3.5

Technisches, modulares Energie- und Heizungsdashboard für Home Assistant.

## V0.3.5 – Flow-Geometrie und Child-Connector-Cleanup

- Elektrische und thermische Verteilleitungen verwenden jetzt dieselbe durchgehende Leitungsfarbe und dieselbe Animationsdefinition.
- Der Übergang von der mittigen Verteilung in die linke Stockwerksschiene ist geometrisch geschlossen; die zusätzliche linke Fallleitung verhindert die bisherige Unterbrechung.
- Die mittige Fallleitung und der horizontale Verteiler treffen sich pixelgenau auf derselben 2-px-Achse.
- Die Stockwerksschiene wird je Stockwerkskanal gerendert und endet beim letzten Stockwerk auf Höhe des letzten Abgangs.
- Parent/Child-Container verwenden ein festes Spacing-System ohne doppelte 2-px-Rahmen.
- Children werden vertikal unter ihrem Parent angeordnet. Die Hierarchielinie wird nur zwischen tatsächlich vorhandenen Children fortgeführt und endet auf Höhe des letzten Childs.
- Parent-Metadaten liegen kompakt im Kopf der Hauptkachel, damit Parent und gleichartige Root-Bereiche dieselbe Hauptkachelhöhe behalten.
- Die reservierte Rasterhöhe eines Parent-Verbunds wird rekursiv aus allen Children berechnet, damit Child-Inhalte und Formeln nicht in den nächsten Stockwerksrahmen ragen.
- Frontend- und Lovelace-Ressourcen verwenden Version `0.3.5` zur Cache-Trennung.

## V0.3.4 – Layout- und Flow-Korrektur

- Parent/Child-Bereiche erben das Stockwerk des Parents und werden als verschachtelter Verbund gerendert.
- Root-Kacheln behalten ihre konfigurierte Größe; ein Parent wird nicht mehr künstlich breiter als ein gleichartiger Root-Bereich.
- Parent- und Child-Rahmen werden nicht mehr über negative Margins übereinandergelegt.
- Elektrische und thermische Energieflüsse laufen ausschließlich in eigenen Leitungsgassen und nicht durch Bereichskacheln.
- Die Ebenenlast steht direkt am Abgang vor dem jeweiligen Stockwerk.
- Die Gesamtlast ist die Summe aller konfigurierten Ebenen; frei benannte neue Ebenen werden berücksichtigt.
- Panel und Read-only-Karte zeigen die geladene Frontend-Version an.


## Neu in 0.3.3

### Parent und Child werden wirklich hierarchisch dargestellt

Unterbereiche liegen nicht mehr als gleichwertige Kacheln neben ihrem Parent. Der Parent bildet jetzt eine größere Hauptkachel; seine direkten Children werden kompakt unmittelbar darunter gerendert.

```text
┌─────────────────────────────────────┐
│ kl. Wohnung                  417 W  │
│ PARENT · 1 UNTERBEREICH             │
├─────────────────────────────────────┤
│ ┌───────────────────────┐           │
│ │ Waschmaschine      0 W │           │
│ │ ↳ kl. Wohnung          │           │
│ └───────────────────────┘           │
└─────────────────────────────────────┘
```

Die Gruppierung wird im Magnetischen Gebäudeplan und in den Live-Ansichten verwendet. Eine Parent/Child-Zuordnung übernimmt das Stockwerk des Parents für den gesamten Child-Zweig, damit Children nicht versehentlich auf einem anderen Stockwerk dargestellt werden.

Children können im Child-Verbund per Drag-and-drop neu sortiert oder auf einen anderen Parent-Child-Verbund gezogen werden.

### Elektrische Verteilung = Summe der Stockwerkslasten

Die alte Blattbereichs-Summierung ist entfernt. Sie war bei Unterzählern falsch: Ein gemessener Parent wurde durch sein Child ersetzt.

Jetzt wird zuerst je Stockwerk eine Teillast gebildet. Pro Hierarchie-Zweig gilt:

1. Hat der Parent für die Messgröße einen eigenen Messwert oder eine eigene Berechnung, ist dieser Wert die Last des gesamten Zweigs.
2. Hat der Parent keinen eigenen Messwert, werden seine konfigurierten Children rekursiv addiert.

Beispiel:

```text
EG
└── kl. Wohnung       417 W   ← Gesamtzähler des Zweigs
    └── Waschmaschine   0 W   ← Unterzähler, nur Detailwert

UG
└── Garten              7 W
```

Die Anzeige lautet:

```text
EG TEILLAST        417 W
UG TEILLAST          7 W
────────────────────────
ELEKTRISCHE
VERTEILUNG          424 W
```

Neue Stockwerke beziehungsweise frei benannte Ebenen fließen automatisch in diese Summe ein, sobald dort eine elektrische Mess- oder Berechnungskonfiguration vorhanden ist.

### Animierter Fluss in die Stockwerke

Zwischen elektrischer Verteilung und Gebäudestapel gibt es eine gemeinsame animierte Verteilleitung. Jedes Stockwerk besitzt einen Abzweig. Die aktuelle Stockwerkslast wird direkt an der seitlichen Stockwerksreferenz und zusätzlich als `TEILLAST` im Kopf des Stockwerks angezeigt.

Die Animationsphase basiert auf der aktuellen Zeit. Dadurch beginnt der gelbe Marker nach einem Home-Assistant-State-Update nicht mehr mehrfach sichtbar am Leitungsanfang neu.

### Thermische Last analog zur elektrischen Last

Bereiche können jetzt zusätzlich thermische Messwerte besitzen:

- thermische Leistung
- thermische Energie heute

Bei berechneten Bereichen gibt es vier unabhängige GUI-Berechnungen:

```text
AKTUELLE ELEKTRISCHE LEISTUNG
ELEKTRISCHE ENERGIE HEUTE
AKTUELLE THERMISCHE LEISTUNG
THERMISCHE ENERGIE HEUTE
```

Für jede Berechnung werden konkrete Messwerte über die GUI mit `+` oder `−` zusammengestellt.

Die thermische Verteilung verwendet dieselbe Parent/Child- und Stockwerkslogik:

```text
THERMISCHE VERTEILUNG = Summe der thermischen Stockwerkslasten
```

Im Reiter `THERMISCH` führt eine blaue animierte Verteilleitung zu den thermisch konfigurierten Stockwerken. Elektrisch nicht konfigurierte Werte werden dort nicht angezeigt.

Wärmeerzeuger können optional zusätzlich erhalten:

- Thermische Leistung
- Thermische Energie / kWh

Damit kann eine Wärmepumpe beispielsweise elektrische und thermische Leistung getrennt darstellen.

## Installation / Update

1. Den bisherigen Ordner `/config/custom_components/energy_system_dashboard` vollständig löschen beziehungsweise ersetzen.
2. `custom_components/energy_system_dashboard` aus diesem Paket nach `/config/custom_components/` kopieren.
3. Home Assistant vollständig neu starten.
4. **Energiesystem → KONFIGURATION** öffnen.
5. Bei Bedarf thermische Bereichs- und Wärmeerzeuger-Messwerte ergänzen.
6. **GEBÄUDEPLAN SPEICHERN** verwenden.

Die bestehende 0.3.2-Konfiguration wird normalisiert. Neue thermische Felder bleiben zunächst leer. Vorhandene elektrische Zuordnungen, Parent/Child-Beziehungen und Stockwerke bleiben erhalten.

## Read-only Lovelace-Karte

Die Karte verwendet dieselbe zentrale Topologie. Es werden keine Entity-IDs in der Karten-YAML eingetragen.

### JavaScript-Ressource

```text
/energy_system_dashboard/energy-system-card.js?v=0.3.5
```

Home Assistant:

```text
Einstellungen → Dashboards → Ressourcen
```

```text
URL: /energy_system_dashboard/energy-system-card.js?v=0.3.5
Typ: JavaScript-Modul
```

Bei YAML-verwalteten Ressourcen:

```yaml
lovelace:
  resources:
    - url: /energy_system_dashboard/energy-system-card.js?v=0.3.5
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

Das Dashboard kommuniziert nicht direkt mit Tasmota, Shelly, Viessmann oder my-PV. Es verwendet vorhandene Home-Assistant-Entities und für Tagesenergie die Recorder-Statistik.
