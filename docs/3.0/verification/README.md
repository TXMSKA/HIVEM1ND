# T064 screen captures

Date: 2026-10-15

Commit: 09585c5e14563f97aec5a6a2574b00d315ac0dbd

Chrome: Chrome/155.0.8059.79

Captured: 186

Unreached: 7

The seven missing files were not saved because the product does not show that state:

- 1.8 es. The state is shown as "Reading the M1ND", not "Leyendo el M1ND": the app has not read the viewer language yet (gui/app/main.mjs:259 and :1000), so the Spanish copy of this state never appears.
- 1.9 es. The state is shown as "The M1ND cannot be read", not "No se puede leer el M1ND": the app has not read the viewer language yet (gui/app/main.mjs:259 and :1000), so the Spanish copy of this state never appears.
- 7.1 es, 7.2 es and 7.3 es. The pairing screen is shown as "Open your M1ND", not "Abrir el M1ND": the phone has no viewer settings until the code is accepted, so this Spanish state never appears.
- start 2.5 en and start 2.5 es. Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select.
