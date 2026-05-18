"""
gui/data.py
===========
Data structures + mock data for the PyQt6 GUI preview.

Once OAuth + fetch_inventory.py are wired in, this module loads from the
real user_config.json and workbook instead of the MOCK_ constants below.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class Item:
    name: str
    tier: str        # exotic | legendary | rare | common
    type: str        # Sniper Rifle / Helmet / etc.
    slot: str        # Kinetic / Energy / Heavy / Helmet / ...
    element: str     # solar | arc | void | stasis | strand | kinetic
    power: int
    location: str    # WARLOCK EQUIPPED / VAULT / HUNTER SLOT 2
    tag: Optional[str] = None  # favorite | keep | infuse | junk | archive | None
    perks_god: List[bool] = field(default_factory=lambda: [True, False, True, False])
    instance_id: Optional[str] = None
    char_class: Optional[str] = None  # which class this is for (or None for any)


@dataclass
class Character:
    class_name: str  # warlock / hunter / titan
    tier_label: str  # PRIMARY / SECONDARY / TERTIARY
    power: int
    grenade: int
    class_stat: int
    super_stat: int


# ============================================================
# Mock data — replaced by real fetch_inventory.py output later
# ============================================================

MOCK_CHARACTERS: List[Character] = [
    Character("warlock", "PRIMARY",   1825, 136, 91, 89),
    Character("hunter",  "SECONDARY", 1820,  74, 82, 96),
    Character("titan",   "TERTIARY",  1818,  62, 88, 104),
]

MOCK_ITEMS: List[Item] = [
    Item("Still Hunt",          "exotic",    "Sniper Rifle",  "Energy",  "solar",  1827, "WARLOCK EQUIPPED", "favorite", [True, True, False, True]),
    Item("Crimson",             "exotic",    "Hand Cannon",   "Kinetic", "solar",  1820, "WARLOCK EQUIPPED", "favorite", [True, True, True, False]),
    Item("Conditional Finality","exotic",    "Shotgun",       "Energy",  "stasis", 1815, "VAULT",            "keep",     [True, False, True, False]),
    Item("Imminence",           "legendary", "SMG",           "Kinetic", "arc",    1820, "WARLOCK SLOT 2",   "favorite", [True, True, True, True]),
    Item("Mataiodoxia",         "exotic",    "Chest Armor",   "Chest",   "strand", 1810, "VAULT",            "keep",     [True, True, False, False]),
    Item("Refurbished A499",    "legendary", "Rocket Launcher","Heavy",  "solar",  1820, "WARLOCK SLOT 3",   "keep",     [True, True, False, True]),
    Item("Praxic Blade",        "legendary", "Sword",         "Heavy",   "arc",    1810, "VAULT",            "favorite", [True, False, True, True]),
    Item("Celestial Nighthawk", "exotic",    "Helmet",        "Helmet",  "kinetic",1820, "HUNTER EQUIPPED",  "favorite", [True, True, False, False]),
    Item("Sage Protector Grips","legendary", "Gauntlets",     "Gauntlets","kinetic",1820, "HUNTER EQUIPPED", "keep",     [True, False, True, False]),
    Item("Smite of Merain",     "rare",      "Pulse Rifle",   "Energy",  "arc",    1750, "VAULT",            "junk",     [False, False, False, False]),
    Item("Wolfsbane",           "legendary", "Combat Bow",    "Energy",  "strand", 1818, "TITAN EQUIPPED",   "favorite", [True, True, False, True]),
    Item("Sullen Claw",         "exotic",    "Sword",         "Heavy",   "void",   1810, "VAULT",            None,        [True, True, True, True]),
    Item("Uncivil Discourse",   "legendary", "SMG",           "Energy",  "strand", 1815, "HUNTER SLOT 2",    "keep",     [True, True, False, False]),
    Item("Boots of the Cosmonaut","rare",    "Leg Armor",     "Legs",    "kinetic",1700, "VAULT",            "infuse",   [False, False, False, False]),
    Item("Heart of Inmost Light","exotic",   "Chest Armor",   "Chest",   "kinetic",1820, "TITAN EQUIPPED",   "favorite", [True, True, False, True]),
    Item("Synthoceps",          "exotic",    "Gauntlets",     "Gauntlets","kinetic",1815, "TITAN EQUIPPED",  "keep",     [True, True, False, False]),
    Item("Sunbracers",          "exotic",    "Gauntlets",     "Gauntlets","kinetic",1820, "VAULT",           "favorite", [True, True, True, False]),
    Item("Osmiomancy Gloves",   "exotic",    "Gauntlets",     "Gauntlets","kinetic",1815, "VAULT",           "keep",     [True, False, True, False]),
    Item("Getaway Artist",      "exotic",    "Gauntlets",     "Gauntlets","kinetic",1820, "VAULT",           "favorite", [True, True, True, True]),
    Item("Lucky Pants",         "exotic",    "Leg Armor",     "Legs",    "kinetic",1820, "HUNTER EQUIPPED", "favorite", [True, True, False, True]),
]
