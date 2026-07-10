# Energy System Card – YAML-Referenz

Die Karte ist eine read-only Darstellung der zentralen Energy-System-Konfiguration.

## Minimalbeispiel

```yaml
type: custom:energy-system-card
view: system
```

## Optionen

| Option | Typ | Standard | Bedeutung |
|---|---|---|---|
| `type` | string | erforderlich | `custom:energy-system-card` |
| `view` | string | `system` | `system`, `electrical`, `thermal`, `building` |
| `display` | string | `full` | `full`, `compact` |
| `title` | string | zentraler Name | eigener Kartentitel |
| `floor_selector` | boolean | `true` | Stockwerksumschaltung anzeigen |
| `default_floor` | string | erstes Stockwerk | Start-Stockwerk |
| `show_daily_energy` | boolean | `true` | Tagesenergie anzeigen |
| `show_status` | boolean | `true` | Status anzeigen |
| `expand_children` | boolean | `false` | Unterbereiche standardmäßig öffnen |

Die Karten-YAML beschreibt ausschließlich die Darstellung. Entity-Zuordnungen, Berechnungen, Stockwerksaufbau und Bereichspositionen werden zentral im Energy System Dashboard gepflegt.
