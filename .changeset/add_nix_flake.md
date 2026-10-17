---
default: minor
---

# Add a Nix flake

The web client can now be built with Nix, using `nix build git+https://git.sable.moe/SableClient/sable-next`. To set your own `config.json`, override the package with `sable.override { conf = { ... }; }`.
