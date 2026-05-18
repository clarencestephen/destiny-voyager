"""
gui/main_window.py
==================
Top-level Destiny Voyager PyQt6 window — Imperial Dossier aesthetic (Order 66 clan flavor).

Renders the three-pane layout (filters | inventory | detail) over a header
and footer. All custom widgets are below MainWindow.

Run from repo root:
    python3 -m gui.main          (recommended — module mode keeps imports clean)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from PyQt6.QtCore import (QEasingCurve, QPoint, QPropertyAnimation, QRect, QSize,
                          Qt, QTimer, pyqtSignal)
from PyQt6.QtGui import (QColor, QFont, QFontDatabase, QGuiApplication, QPainter,
                         QPen)
from PyQt6.QtWidgets import (QApplication, QFrame, QGraphicsDropShadowEffect,
                             QHBoxLayout, QLabel, QLineEdit, QMainWindow,
                             QPushButton, QScrollArea, QSizePolicy, QSpacerItem,
                             QVBoxLayout, QWidget)

from .data import MOCK_CHARACTERS, MOCK_ITEMS, Character, Item

STYLE_PATH = Path(__file__).parent / "style.qss"
FONTS_DIR = Path(__file__).parent / "fonts"

# ============================================================
# Helpers
# ============================================================


def make_label(text: str, obj_name: str = "", role: str = "",
               **props) -> QLabel:
    lbl = QLabel(text)
    if obj_name:
        lbl.setObjectName(obj_name)
    if role:
        lbl.setProperty("role", role)
    for k, v in props.items():
        lbl.setProperty(k, v)
    return lbl


def hsep(color="#1E222C") -> QFrame:
    line = QFrame()
    line.setFrameShape(QFrame.Shape.HLine)
    line.setStyleSheet(f"background: {color}; max-height: 1px;")
    return line


def vsep(color="#1E222C") -> QFrame:
    line = QFrame()
    line.setFixedWidth(1)
    line.setStyleSheet(f"background: {color};")
    return line


def refresh_style(widget: QWidget):
    """Re-evaluate QSS after dynamic properties change."""
    widget.style().unpolish(widget)
    widget.style().polish(widget)
    widget.update()


# ============================================================
# Brand mark — diamond/hex Destiny Voyager emblem
# ============================================================


class BrandMark(QFrame):
    def __init__(self):
        super().__init__()
        self.setFixedSize(38, 38)

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        # Outer hex stroke
        p.setBrush(QColor("#DC0000"))
        p.setPen(Qt.PenStyle.NoPen)
        path_points = [
            (19, 0), (38, 9), (38, 28), (19, 38), (0, 28), (0, 9)
        ]
        from PyQt6.QtGui import QPolygon
        outer = QPolygon([QPoint(*pt) for pt in path_points])
        p.drawPolygon(outer)
        # Inner black hex
        p.setBrush(QColor("#050609"))
        inner_points = [(19, 5), (33, 12), (33, 26), (19, 33), (5, 26), (5, 12)]
        inner = QPolygon([QPoint(*pt) for pt in inner_points])
        p.drawPolygon(inner)
        # "66" label
        p.setPen(QPen(QColor("#DC0000")))
        f = QFont("Saira Stencil One", 11)
        f.setBold(True)
        p.setFont(f)
        p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "66")


# ============================================================
# Header bar — brand · search · status · agent badge
# ============================================================


class HeaderBar(QWidget):
    search_changed = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.setProperty("role", "header")
        self.setFixedHeight(72)

        lay = QHBoxLayout(self)
        lay.setContentsMargins(20, 12, 20, 12)
        lay.setSpacing(20)

        # ---- brand ----
        brand = QHBoxLayout()
        brand.setSpacing(12)
        brand.addWidget(BrandMark())
        brand_text = QVBoxLayout()
        brand_text.setSpacing(2)
        brand_text.setContentsMargins(0, 2, 0, 0)
        brand_text.addWidget(make_label("DESTINY VOYAGER", obj_name="brandName"))
        brand_text.addWidget(make_label("OPTIMIZER · WISHLIST · API STATS",
                                        obj_name="brandTagline"))
        brand.addLayout(brand_text)
        lay.addLayout(brand)
        lay.addStretch(1)

        # ---- search ----
        self.search = QLineEdit()
        self.search.setObjectName("searchInput")
        self.search.setPlaceholderText('QUERY INVENTORY  ·  "crimson"  ·  "void grenade"  ·  #favorite')
        self.search.setMinimumWidth(520)
        self.search.setMaximumWidth(620)
        self.search.textChanged.connect(self.search_changed)
        lay.addWidget(self.search)

        lay.addStretch(1)

        # ---- status ----
        self.status_lbl = make_label("●  SYNCED · 2 MIN AGO", obj_name="statusText")
        self.status_lbl.setStyleSheet("color: #5C6470;")
        # Use a custom pulse for the dot. For QSS we just leave it as a unicode bullet.
        lay.addWidget(self.status_lbl)

        # ---- agent badge ----
        badge = QWidget()
        badge.setObjectName("agentBadge")
        b_lay = QVBoxLayout(badge)
        b_lay.setContentsMargins(14, 8, 18, 8)
        b_lay.setSpacing(2)
        b_lay.addWidget(make_label("AGENT // BUNGIE.NET", obj_name="agentId"))
        b_lay.addWidget(make_label("DARTH_BANKAI", obj_name="agentName"))
        lay.addWidget(badge)


# ============================================================
# Filter rail — left panel
# ============================================================


class FilterPill(QPushButton):
    def __init__(self, label: str, count: int = 0, checked: bool = False):
        super().__init__()
        self.setProperty("role", "filterPill")
        self.setCheckable(True)
        self.setChecked(checked)
        h = QHBoxLayout(self)
        h.setContentsMargins(12, 6, 12, 6)
        h.addWidget(QLabel(label))
        h.addStretch(1)
        self.count_lbl = QLabel(str(count))
        self.count_lbl.setStyleSheet(
            "font-family: 'JetBrains Mono'; font-size: 9pt; color: #5C6470;"
        )
        h.addWidget(self.count_lbl)


class TagChip(QPushButton):
    def __init__(self, tag: str, label: str):
        super().__init__(label)
        self.setProperty("role", "tagChip")
        self.setProperty("tag", tag)
        self.setCheckable(True)
        self.setMinimumHeight(34)


class FilterRail(QScrollArea):
    def __init__(self):
        super().__init__()
        self.setProperty("role", "panel")
        self.setWidgetResizable(True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setFixedWidth(280)

        inner = QWidget()
        inner.setProperty("role", "panel")
        lay = QVBoxLayout(inner)
        lay.setContentsMargins(20, 22, 20, 22)
        lay.setSpacing(22)

        # ---- Tag filter chips ----
        lay.addWidget(make_label("▸ TAG FILTER", role="sectionLabel"))
        tags_row = QHBoxLayout()
        tags_row.setSpacing(6)
        for tag, label in [
            ("favorite", "FAV"), ("keep", "KEP"), ("infuse", "INF"),
            ("junk", "JNK"), ("archive", "ARC"),
        ]:
            tags_row.addWidget(TagChip(tag, label))
        lay.addLayout(tags_row)

        # ---- Class ----
        lay.addWidget(make_label("▸ CLASS", role="sectionLabel"))
        for label, count, checked in [
            ("Any", 847, False),
            ("Warlock", 312, True),
            ("Hunter", 298, False),
            ("Titan", 237, False),
        ]:
            lay.addWidget(FilterPill(label, count, checked))

        # ---- Slot ----
        lay.addWidget(make_label("▸ SLOT", role="sectionLabel"))
        for label, count in [
            ("Kinetic", 42), ("Energy", 68), ("Heavy", 31),
            ("Helmet", 28), ("Gauntlets", 26), ("Chest", 29),
            ("Legs", 31), ("Class Item", 57),
        ]:
            lay.addWidget(FilterPill(label, count))

        # ---- Element ----
        lay.addWidget(make_label("▸ ELEMENT", role="sectionLabel"))
        for label, count in [
            ("Solar", 88), ("Arc", 73), ("Void", 91),
            ("Stasis", 42), ("Strand", 38),
        ]:
            lay.addWidget(FilterPill(label, count))

        lay.addStretch(1)
        self.setWidget(inner)


# ============================================================
# Character card
# ============================================================


class CharCard(QFrame):
    clicked = pyqtSignal(str)

    def __init__(self, char: Character):
        super().__init__()
        self.char = char
        self.setProperty("role", "charCard")
        self.setProperty("active", char.class_name == "warlock")  # default
        self.setFixedHeight(120)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        outer = QHBoxLayout(self)
        outer.setContentsMargins(20, 14, 20, 14)
        outer.setSpacing(12)

        # left text column
        col = QVBoxLayout()
        col.setSpacing(4)
        col.addWidget(make_label(char.tier_label.upper(), obj_name="charLabel"))
        name_lbl = make_label(char.class_name.upper(), obj_name="charName",
                              charClass=char.class_name)
        col.addWidget(name_lbl)
        stats_lbl = make_label(
            f"G {char.grenade}    C {char.class_stat}    S {char.super_stat}",
            obj_name="charStats",
        )
        col.addWidget(stats_lbl)
        outer.addLayout(col)
        outer.addStretch(1)

        # right power readout
        power = QVBoxLayout()
        power.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignRight)
        power.addWidget(make_label(str(char.power), obj_name="charPower"))
        outer.addLayout(power)

    def mouseReleaseEvent(self, ev):
        self.clicked.emit(self.char.class_name)
        super().mouseReleaseEvent(ev)


class CharacterRail(QWidget):
    char_selected = pyqtSignal(str)

    def __init__(self, characters: List[Character]):
        super().__init__()
        self.setProperty("role", "panel")
        self.setFixedHeight(120)
        self.cards: List[CharCard] = []

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(1)
        lay.addWidget(vsep())  # tiny left edge
        for c in characters:
            card = CharCard(c)
            card.clicked.connect(self._on_click)
            self.cards.append(card)
            lay.addWidget(card, 1)
            lay.addWidget(vsep())

    def _on_click(self, class_name: str):
        for c in self.cards:
            c.setProperty("active", c.char.class_name == class_name)
            refresh_style(c)
        self.char_selected.emit(class_name)


# ============================================================
# Item row
# ============================================================


class TagBadge(QLabel):
    def __init__(self, tag: str):
        chars = {"favorite": "F", "keep": "K", "infuse": "I",
                 "junk": "J", "archive": "A", "none": "·"}
        super().__init__(chars.get(tag, "·"))
        self.setProperty("role", "tagBadge")
        self.setProperty("tag", tag)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setFixedSize(28, 28)


class PerkDots(QWidget):
    def __init__(self, perks: List[bool]):
        super().__init__()
        self.setFixedHeight(10)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(4)
        lay.addStretch(1)
        for god in perks:
            dot = QFrame()
            dot.setFixedSize(8, 8)
            color = "#C9A227" if god else "#2A2E3A"
            dot.setStyleSheet(f"background: {color}; border-radius: 4px;")
            lay.addWidget(dot)


class ItemRow(QFrame):
    clicked = pyqtSignal(object)

    def __init__(self, item: Item, index: int):
        super().__init__()
        self.item = item
        self.setProperty("role", "itemRow")
        self.setProperty("selected", False)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(64)

        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 10, 16, 10)
        lay.setSpacing(14)

        # rarity bar
        bar = QFrame()
        bar.setProperty("role", "rarityBar")
        bar.setProperty("tier", item.tier)
        bar.setMinimumSize(3, 44)
        bar.setMaximumSize(3, 44)
        lay.addWidget(bar)

        lay.addSpacing(8)

        # name + meta
        col = QVBoxLayout()
        col.setSpacing(2)
        name_lbl = make_label(item.name, obj_name="itemName", tier=item.tier)
        col.addWidget(name_lbl)
        meta = f"{item.type}   ·   {item.element.title()}   ·   {item.slot}"
        col.addWidget(make_label(meta, obj_name="itemMeta"))
        lay.addLayout(col, 1)

        # location
        loc_lbl = make_label(item.location.upper(), obj_name="itemLocation")
        loc_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        loc_lbl.setMinimumWidth(96)
        lay.addWidget(loc_lbl)

        # perks preview
        lay.addWidget(PerkDots(item.perks_god))

        # power
        power_lbl = make_label(str(item.power), obj_name="itemPower")
        power_lbl.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        power_lbl.setMinimumWidth(56)
        lay.addWidget(power_lbl)

        # tag
        lay.addWidget(TagBadge(item.tag or "none"))

        # subtle drop shadow for depth on hover (set on enter)
        self._shadow = QGraphicsDropShadowEffect()
        self._shadow.setBlurRadius(0)
        self._shadow.setColor(QColor(220, 0, 0, 0))
        self._shadow.setOffset(0, 0)
        self.setGraphicsEffect(self._shadow)

    def enterEvent(self, ev):
        anim = QPropertyAnimation(self._shadow, b"blurRadius", self)
        anim.setDuration(180)
        anim.setEndValue(28)
        anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        anim.start(QPropertyAnimation.DeletionPolicy.DeleteWhenStopped)
        self._shadow.setColor(QColor(220, 0, 0, 90))
        super().enterEvent(ev)

    def leaveEvent(self, ev):
        anim = QPropertyAnimation(self._shadow, b"blurRadius", self)
        anim.setDuration(220)
        anim.setEndValue(0)
        anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        anim.start(QPropertyAnimation.DeletionPolicy.DeleteWhenStopped)
        super().leaveEvent(ev)

    def mouseReleaseEvent(self, ev):
        self.clicked.emit(self.item)
        super().mouseReleaseEvent(ev)

    def set_selected(self, sel: bool):
        self.setProperty("selected", sel)
        refresh_style(self)


# ============================================================
# Inventory panel (center)
# ============================================================


class InventoryPanel(QWidget):
    item_selected = pyqtSignal(object)

    def __init__(self, characters: List[Character], items: List[Item]):
        super().__init__()
        self.setProperty("role", "panel")
        self.items: List[Item] = items
        self.rows: List[ItemRow] = []

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ---- character rail ----
        self.char_rail = CharacterRail(characters)
        lay.addWidget(self.char_rail)
        lay.addWidget(hsep())

        # ---- toolbar ----
        bar = QWidget()
        bar.setObjectName("invToolbar")
        bar.setFixedHeight(48)
        bar_lay = QHBoxLayout(bar)
        bar_lay.setContentsMargins(20, 0, 20, 0)
        self.meta_lbl = QLabel()
        self.meta_lbl.setObjectName("invMeta")
        self._update_meta(len(items))
        bar_lay.addWidget(self.meta_lbl)
        bar_lay.addStretch(1)
        sort_row = QHBoxLayout()
        sort_row.setSpacing(4)
        for label, checked in [("POWER ▼", True), ("NAME", False),
                               ("TAG", False), ("TIER", False)]:
            btn = QPushButton(label)
            btn.setProperty("role", "sortPill")
            btn.setCheckable(True)
            btn.setChecked(checked)
            sort_row.addWidget(btn)
        bar_lay.addLayout(sort_row)
        lay.addWidget(bar)

        # ---- item list (scroll area) ----
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        inner = QWidget()
        inner.setProperty("role", "panel")
        rows_lay = QVBoxLayout(inner)
        rows_lay.setContentsMargins(12, 6, 12, 24)
        rows_lay.setSpacing(2)
        for i, item in enumerate(items):
            row = ItemRow(item, i)
            row.clicked.connect(self._on_row_clicked)
            self.rows.append(row)
            rows_lay.addWidget(row)
        rows_lay.addStretch(1)
        self.scroll.setWidget(inner)
        lay.addWidget(self.scroll, 1)

        # select first by default
        if self.rows:
            self._on_row_clicked(self.rows[0].item)

    def _update_meta(self, n: int):
        self.meta_lbl.setText(
            f'<span style="color:#5C6470">DISPLAYING </span>'
            f'<span style="color:#DC0000; font-weight:700">{n}</span>'
            f'<span style="color:#5C6470"> RECORDS · WARLOCK · ALL SLOTS</span>'
        )

    def _on_row_clicked(self, item: Item):
        for r in self.rows:
            r.set_selected(r.item is item)
        self.item_selected.emit(item)


# ============================================================
# Detail panel (right)
# ============================================================


class DetailCorner(QFrame):
    """Tiny L-bracket in one of 4 corners — Imperial UI signature."""

    def __init__(self, position: str):  # tl / tr / bl / br
        super().__init__()
        self.position = position
        self.setFixedSize(14, 14)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        pen = QPen(QColor("#DC0000"))
        pen.setWidth(2)
        p.setPen(pen)
        if "t" in self.position:
            p.drawLine(0, 1, 14, 1)
        if "b" in self.position:
            p.drawLine(0, 13, 14, 13)
        if "l" in self.position:
            p.drawLine(1, 0, 1, 14)
        if "r" in self.position:
            p.drawLine(13, 0, 13, 14)


class StatCell(QFrame):
    def __init__(self, key: str, val: str, accent: str = ""):
        super().__init__()
        self.setProperty("role", "statCell")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 12, 14, 12)
        lay.setSpacing(4)
        lay.addWidget(make_label(key.upper(), obj_name="statKey"))
        v = make_label(val, obj_name="statVal")
        if accent:
            v.setProperty("accent", accent)
        lay.addWidget(v)


class DetailPanel(QWidget):
    def __init__(self):
        super().__init__()
        self.setProperty("role", "panel")
        self.setFixedWidth(380)

        # corners
        self._corners = [DetailCorner(p) for p in ("tl", "tr", "bl", "br")]
        for c in self._corners:
            c.setParent(self)

        # content
        self._content = QWidget(self)
        self._content_layout = QVBoxLayout(self._content)
        self._content_layout.setContentsMargins(24, 24, 24, 24)
        self._content_layout.setSpacing(16)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(self._content)
        self.update_for_item(None)

    def resizeEvent(self, ev):
        # position corners
        w, h = self.width(), self.height()
        margin = 16
        positions = {
            "tl": (margin, margin),
            "tr": (w - margin - 14, margin),
            "bl": (margin, h - margin - 14),
            "br": (w - margin - 14, h - margin - 14),
        }
        for c in self._corners:
            c.move(*positions[c.position])
        super().resizeEvent(ev)

    def update_for_item(self, item: Optional[Item]):
        # clear
        while self._content_layout.count():
            w = self._content_layout.takeAt(0).widget()
            if w:
                w.deleteLater()

        if item is None:
            self._content_layout.addStretch(1)
            self._content_layout.addWidget(make_label(
                "▸ NO RECORD SELECTED", role="perkRow"
            ))
            self._content_layout.addStretch(1)
            return

        # header
        self._content_layout.addWidget(make_label("▸ ITEM DOSSIER · #1257",
                                                   obj_name="detailLabel"))
        self._content_layout.addWidget(make_label(item.name.upper(),
                                                   obj_name="detailName"))
        self._content_layout.addWidget(make_label(
            f"{item.tier.upper()} · {item.type.upper()} · {item.element.upper()}",
            obj_name="detailSubname",
        ))
        self._content_layout.addSpacing(14)

        # stat grid (2 cols)
        from PyQt6.QtWidgets import QGridLayout
        grid_widget = QWidget()
        grid = QGridLayout(grid_widget)
        grid.setSpacing(1)
        grid.setContentsMargins(0, 0, 0, 0)
        # background of the grid container
        grid_widget.setStyleSheet("background: #1E222C;")
        stats = [
            ("POWER", str(item.power), "gold"),
            ("IMPACT", "90", ""),
            ("RANGE", "62", ""),
            ("STABILITY", "38", ""),
            ("HANDLING", "62", ""),
            ("RELOAD", "52", ""),
        ]
        for i, (k, v, accent) in enumerate(stats):
            grid.addWidget(StatCell(k, v, accent), i // 2, i % 2)
        self._content_layout.addWidget(grid_widget)

        # perks list
        self._content_layout.addSpacing(8)
        self._content_layout.addWidget(make_label("▸ INTRINSIC // PERKS",
                                                   role="sectionLabel"))
        for perk, god in [
            ("Hunter's Trace — Aim down sights summons a Golden Gun shot", True),
            ("Arrowhead Brake", False),
            ("Extended Mag", False),
            ("Triple Tap", True),
            ("Firing Line", True),
        ]:
            lbl = make_label(("◆  " if god else "·  ") + perk, role="perkRow")
            lbl.setProperty("god", god)
            lbl.setWordWrap(True)
            self._content_layout.addWidget(lbl)

        self._content_layout.addStretch(1)

        # actions
        actions = QHBoxLayout()
        actions.setSpacing(8)
        share = QPushButton("SHARE")
        share.setProperty("role", "action")
        actions.addWidget(share)
        execute = QPushButton("EXECUTE LOADOUT")
        execute.setProperty("role", "action")
        execute.setProperty("primary", True)
        actions.addWidget(execute)
        self._content_layout.addLayout(actions)

        for w in self.findChildren(QWidget):
            refresh_style(w)


# ============================================================
# Footer
# ============================================================


class FooterBar(QWidget):
    def __init__(self):
        super().__init__()
        self.setProperty("role", "footer")
        self.setFixedHeight(34)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(20, 0, 20, 0)
        lay.addWidget(make_label("DESTINY VOYAGER · v0.3.0 · ORDER 66 EDITION",
                                  role="footerText"))
        lay.addStretch(1)
        for text in [
            "RECORDS // 847",
            "TAGGED // 62",
            "LIGHT // 1825",
            "▸ TRANSMITTING",
        ]:
            lbl = make_label(text, role="footerText")
            lay.addWidget(lbl)
            lay.addSpacing(20)


# ============================================================
# MainWindow
# ============================================================


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Destiny Voyager — Imperial Dossier")
        self.resize(1480, 900)
        # Center on screen
        screen = QGuiApplication.primaryScreen().geometry()
        self.move(
            screen.center().x() - self.width() // 2,
            screen.center().y() - self.height() // 2,
        )

        central = QWidget()
        central.setObjectName("central")
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # header
        self.header = HeaderBar()
        root.addWidget(self.header)

        # main 3-column
        main_row = QHBoxLayout()
        main_row.setContentsMargins(0, 0, 0, 0)
        main_row.setSpacing(1)
        main_row.addWidget(FilterRail())
        main_row.addWidget(vsep())
        self.inventory = InventoryPanel(MOCK_CHARACTERS, MOCK_ITEMS)
        main_row.addWidget(self.inventory, 1)
        main_row.addWidget(vsep())
        self.detail = DetailPanel()
        main_row.addWidget(self.detail)

        main_widget = QWidget()
        main_widget.setLayout(main_row)
        main_widget.setProperty("role", "panel")
        root.addWidget(main_widget, 1)

        # footer
        root.addWidget(FooterBar())

        # wire signals
        self.inventory.item_selected.connect(self.detail.update_for_item)


# ============================================================
# Bootstrap
# ============================================================


def load_fonts():
    """Load bundled .ttfs if present. Falls back to system fonts silently."""
    if not FONTS_DIR.exists():
        return
    for f in FONTS_DIR.glob("*.ttf"):
        QFontDatabase.addApplicationFont(str(f))


def load_stylesheet() -> str:
    if STYLE_PATH.exists():
        return STYLE_PATH.read_text(encoding="utf-8")
    return ""


def launch():
    app = QApplication.instance() or QApplication([])
    load_fonts()
    app.setStyleSheet(load_stylesheet())
    win = MainWindow()
    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(launch())
