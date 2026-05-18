"""
gui/main.py
===========
Entry point for the Destiny Voyager PyQt6 GUI.

Usage (from repo root):
    pip install PyQt6
    python3 -m gui.main

The window opens with mock data right now so the design can be evaluated.
Real data loading from user_config.json + fetch_inventory.py output
plugs in via gui/data.py once v0.2.0 is verified working.
"""

import sys

from .main_window import launch


if __name__ == "__main__":
    sys.exit(launch())
