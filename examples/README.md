# Example loadouts

`example_loadouts.json` contains **25 community-shared DIM loadouts** across all three classes (13 Warlock, 9 Hunter, 3 Titan), with notes from the build authors.

These are public DIM share URLs collected from community Discord channels. They're meant as a demo / reference so you can see what a populated workbook looks like before adding your own.

## How to use

### Option A — quick demo without touching your own config

```bash
python demo_examples.py
```

That script:
1. Asks for your Bungie API key (one prompt — won't be saved)
2. Builds an `example_workbook.xlsx` next to your current workbook
3. Runs the decoder using `examples/example_loadouts.json`
4. Doesn't touch your `user_config.json` or `my_loadouts.xlsx`

### Option B — merge into your own config

Open `examples/example_loadouts.json` and copy individual entries into the `dim_loadouts` array in your `user_config.json`. Or just use `python add_loadout.py` with each URL.

### Option C — replace your config entirely (testing only)

```bash
cp examples/example_loadouts.json user_config.json
# then edit user_config.json to add your api_key
python decode_dim.py
```

## Credits

Builds shared by community members in Discord:
- **Stubby456#6394** — most of the Warlock + Hunter DPS builds (May 2026)
- **StrawHat Kano#6659** — Strand Hunter, Contraverse, Swarmers, Vespers/Centrifuse (Oct 2025)
- And others — see the `notes` field on each entry

If you authored one of these builds and want to be credited differently (or pulled from this list), open an issue.

## Refresh / re-classify

If DIM changes its page format or the encoded class info, re-run:

```bash
python examples/reclassify.py
```

This re-fetches each URL and updates the `class` field based on the current `classType` in the loadout JSON.
