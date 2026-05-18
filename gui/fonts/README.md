# Bundled fonts

The PyQt6 GUI uses 4 custom fonts loaded via `QFontDatabase.addApplicationFont()`:

| Font | Weight | Use |
|---|---|---|
| Saira Stencil One | 400 | Display headlines, brand mark, power readouts |
| Big Shoulders Stencil Text | 700, 900 | Class names, stat values |
| Sora | 300, 400, 600, 700 | Body text |
| JetBrains Mono | 400, 600 | Technical data, monospace readouts |

All four are open-source (OFL or Apache-2.0). For development, the GUI auto-downloads them from Google Fonts on first launch if they're not present. For .exe distribution they should be bundled into this folder.

## Download for offline use

```bash
cd gui/fonts
# Run from the repo root:
python3 -c "
import urllib.request
fonts = {
    'SairaStencilOne-Regular.ttf':
        'https://github.com/google/fonts/raw/main/ofl/sairastencilone/SairaStencilOne-Regular.ttf',
    'BigShouldersStencilText-Bold.ttf':
        'https://github.com/google/fonts/raw/main/ofl/bigshouldersstenciltext/BigShouldersStencilText%5Bwght%5D.ttf',
    'Sora-Variable.ttf':
        'https://github.com/google/fonts/raw/main/ofl/sora/Sora%5Bwght%5D.ttf',
    'JetBrainsMono-Variable.ttf':
        'https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf',
}
for name, url in fonts.items():
    print(f'Downloading {name}...')
    urllib.request.urlretrieve(url, name)
print('Done.')
"
```

If the fonts are missing at runtime, the GUI falls back to system fonts and prints a warning. The Imperial Dossier aesthetic relies heavily on the stencil fonts — bundle them for proper rendering.
