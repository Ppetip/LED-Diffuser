# Web rollback note

The hosted GitHub Pages site was reported to still throw web-side invalid JSON errors after the JSON repair and BLE shim changes.

Rollback target: `cd8d783f7feee6b729f7638029774c88f49eda7e`

Reason: this is the last known website commit before the later power/status probe changes, JSON repair changes, and added BLE shim files.

A backup branch should be kept before moving `main` so the newer work is not lost.
