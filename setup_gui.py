"""
setup_gui.py
============
Graphical first-run install wizard (tkinter — stdlib, no extra deps).

Same flow as setup.py but in a Windows-friendly dialog. Run it with:
    python3 setup_gui.py

Or, on Windows, download the pre-built .exe from the GitHub Releases page
(built by .github/workflows/build-windows-exe.yml) and double-click it.

Stages:
  1. Welcome
  2. Bungie API key (with "Open portal" button)
  3. Display name + primary class
  4. DIM loadouts (add/remove list)
  5. Confirm + run install
  6. Done

Writes user_config.json (gitignored), scaffolds my_loadouts.xlsx, then
optionally runs decode_dim.py to populate it.
"""

import json
import os
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

BUNGIE_PORTAL_URL = "https://www.bungie.net/en/Application"
DIM_URL_PREFIX = "https://dim.gg/"
CLASSES = ["Warlock", "Hunter", "Titan"]

ARCHETYPES = {
    "Bulwark":    {"stat": "Health",  "desc": "Survivability — recovery, shield regen, DR"},
    "Brawler":    {"stat": "Melee",   "desc": "Melee builds — punch, hammer, Synthoceps stacks"},
    "Grenadier":  {"stat": "Grenade", "desc": "Grenade spam — Vortex / Sunspot / Storm grenades"},
    "Paragon":    {"stat": "Super",   "desc": "Super uptime — boss DPS, super-fueled builds"},
    "Specialist": {"stat": "Class",   "desc": "Class ability uptime — Rift / Barricade / Dodge"},
    "Gunner":     {"stat": "Weapons", "desc": "Weapon stats — reload, handling, airborne"},
}
STATS = ["Health", "Melee", "Grenade", "Super", "Class", "Weapons"]

try:
    from mod_recommender import GOALS
except ImportError:
    GOALS = ["DPS", "Survivability", "PvE", "PvP", "PvP+PvE blend", "Fun / Off-meta", "Weapon-swap only"]
CONFIG_PATH = Path("user_config.json")
DEFAULT_WORKBOOK = "my_loadouts.xlsx"
DEFAULT_CACHE = "./manifest_cache"

WINDOW_W, WINDOW_H = 720, 520
HEADER_BG = "#111827"
ACCENT = "#7C3AED"
LIGHT = "#F3F4F6"


class Wizard(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Destiny Voyager — Install")
        self.geometry(f"{WINDOW_W}x{WINDOW_H}")
        self.minsize(WINDOW_W, WINDOW_H)
        self.configure(bg=LIGHT)

        # ----- state -----
        self.api_key = tk.StringVar()
        self.bungie_name = tk.StringVar()
        self.primary_class = tk.StringVar(value="Warlock")
        self.archetype = tk.StringVar(value="Grenadier")
        self.target_stats = {s: tk.BooleanVar(value=False) for s in STATS}
        self.goals = {g: tk.BooleanVar(value=(g == "PvE")) for g in GOALS}
        self.dim_loadouts = []  # list of dicts

        # ----- header -----
        header = tk.Frame(self, bg=HEADER_BG, height=64)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(header, text="  DESTINY VOYAGER",
                 bg=HEADER_BG, fg="white",
                 font=("Segoe UI", 16, "bold")).pack(side="left", padx=8)
        self.step_label = tk.Label(header, text="", bg=HEADER_BG, fg="#9CA3AF",
                                   font=("Segoe UI", 10))
        self.step_label.pack(side="right", padx=16)

        # ----- body container -----
        self.body = tk.Frame(self, bg=LIGHT)
        self.body.pack(fill="both", expand=True, padx=24, pady=12)

        # ----- footer with nav buttons -----
        footer = tk.Frame(self, bg=LIGHT, height=56)
        footer.pack(fill="x", side="bottom", pady=(0, 12))
        footer.pack_propagate(False)
        self.back_btn = ttk.Button(footer, text="< Back", command=self.go_back)
        self.back_btn.pack(side="left", padx=24)
        self.next_btn = ttk.Button(footer, text="Next >", command=self.go_next)
        self.next_btn.pack(side="right", padx=24)
        self.cancel_btn = ttk.Button(footer, text="Cancel", command=self.confirm_cancel)
        self.cancel_btn.pack(side="right")

        self.steps = [
            self.step_welcome,
            self.step_api_key,
            self.step_name_class,
            self.step_build_focus,
            self.step_loadouts,
            self.step_confirm,
            self.step_running,
            self.step_done,
        ]
        self.step_idx = 0
        self.show_step()

    # ---------- nav ----------
    def clear_body(self):
        for w in self.body.winfo_children():
            w.destroy()

    def show_step(self):
        self.clear_body()
        self.step_label.config(
            text=f"Step {self.step_idx + 1} of {len(self.steps)}"
        )
        self.steps[self.step_idx]()
        self.back_btn.config(state="normal" if self.step_idx > 0 else "disabled")

    def go_next(self):
        if not self.validate_step():
            return
        if self.step_idx < len(self.steps) - 1:
            self.step_idx += 1
            self.show_step()

    def go_back(self):
        if self.step_idx > 0:
            self.step_idx -= 1
            self.show_step()

    def confirm_cancel(self):
        if messagebox.askyesno("Cancel install?",
                               "Quit without finishing setup? "
                               "Nothing has been written to disk yet."):
            self.destroy()

    # ---------- step validation ----------
    def validate_step(self):
        if self.step_idx == 1:
            key = self.api_key.get().strip()
            if len(key) < 16 or " " in key:
                messagebox.showerror("Invalid API key",
                                     "That doesn't look like a Bungie API key. "
                                     "It should be 32 hex characters, no spaces.")
                return False
        if self.step_idx == 2:
            if "#" not in self.bungie_name.get():
                messagebox.showerror("Invalid Bungie name",
                                     "Expected format: DisplayName#1234")
                return False
        return True

    # ---------- step 0: welcome ----------
    def step_welcome(self):
        tk.Label(self.body, text="Welcome", bg=LIGHT,
                 font=("Segoe UI", 22, "bold")).pack(anchor="w", pady=(8, 4))
        tk.Label(self.body,
                 text="This wizard will set up your personal Destiny Voyager workbook.\n"
                      "Takes about 2 minutes. You'll need:",
                 bg=LIGHT, fg="#374151",
                 font=("Segoe UI", 11), justify="left").pack(anchor="w", pady=(0, 12))

        bullets = [
            "✓  A free Bungie API key (we'll get you one in step 2)",
            "✓  Your Bungie display name (e.g. Guardian#1234)",
            "✓  Your DIM share URLs (one per loadout — optional, can add later)",
        ]
        for b in bullets:
            tk.Label(self.body, text=b, bg=LIGHT, fg="#1F2937",
                     font=("Segoe UI", 11)).pack(anchor="w", pady=2)

        tk.Label(self.body, text="", bg=LIGHT).pack(pady=8)
        safety = tk.Frame(self.body, bg="#FEF3C7", padx=12, pady=10)
        safety.pack(fill="x")
        tk.Label(safety,
                 text="🔒  Your API key stays on YOUR computer.\n"
                      "   It's written to user_config.json, which is gitignored.\n"
                      "   Nothing is uploaded, nothing is committed to GitHub.",
                 bg="#FEF3C7", fg="#78350F", justify="left",
                 font=("Segoe UI", 10)).pack(anchor="w")

    # ---------- step 1: API key ----------
    def step_api_key(self):
        tk.Label(self.body, text="Step 1: Bungie API Key", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 6))
        tk.Label(self.body,
                 text="Click the button to open Bungie's developer portal, "
                      "create an app (30 seconds), copy the API Key, and paste it below.",
                 bg=LIGHT, fg="#374151",
                 font=("Segoe UI", 11), wraplength=640, justify="left").pack(anchor="w")

        row = tk.Frame(self.body, bg=LIGHT)
        row.pack(fill="x", pady=12)
        ttk.Button(row, text="🌐  Open Bungie Portal",
                   command=lambda: webbrowser.open(BUNGIE_PORTAL_URL)).pack(side="left")
        tk.Label(row, text=f"   ({BUNGIE_PORTAL_URL})",
                 bg=LIGHT, fg="#6B7280", font=("Segoe UI", 9)).pack(side="left")

        # quick steps
        steps_frame = tk.Frame(self.body, bg=LIGHT)
        steps_frame.pack(fill="x", pady=(0, 8))
        quick = [
            "1. Sign in with your Bungie account",
            "2. Create New App  →  Name: anything",
            "3. OAuth Client Type: Public  →  Redirect URL: https://localhost",
            "4. Agree to terms → Create",
            "5. Copy the 'API Key' value from the top of the new app page",
        ]
        for s in quick:
            tk.Label(steps_frame, text=f"  {s}", bg=LIGHT, fg="#1F2937",
                     font=("Segoe UI", 10)).pack(anchor="w")

        tk.Label(self.body, text="Paste your API key here:",
                 bg=LIGHT, font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(12, 4))
        entry = ttk.Entry(self.body, textvariable=self.api_key, font=("Consolas", 11))
        entry.pack(fill="x")
        entry.focus_set()

    # ---------- step 2: name + class ----------
    def step_name_class(self):
        tk.Label(self.body, text="Step 2: About You", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 12))

        tk.Label(self.body, text="Bungie display name  (e.g. Guardian#1234)",
                 bg=LIGHT, font=("Segoe UI", 11)).pack(anchor="w")
        ttk.Entry(self.body, textvariable=self.bungie_name,
                  font=("Segoe UI", 11)).pack(fill="x", pady=(4, 12))

        tk.Label(self.body, text="Your primary class  (just sets which class tab opens first)",
                 bg=LIGHT, font=("Segoe UI", 11)).pack(anchor="w")
        ttk.Combobox(self.body, textvariable=self.primary_class,
                     values=CLASSES, state="readonly",
                     font=("Segoe UI", 11)).pack(fill="x", pady=4)

    # ---------- step 3: build focus ----------
    def step_build_focus(self):
        tk.Label(self.body, text="Step 3: Build Focus", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 4))
        tk.Label(self.body,
                 text="What kind of build are you building toward? "
                      "We'll use this to recommend mods + write a starter MOD REFERENCE sheet.",
                 bg=LIGHT, fg="#374151", font=("Segoe UI", 10),
                 wraplength=640, justify="left").pack(anchor="w", pady=(0, 12))

        # Archetype
        tk.Label(self.body, text="Armor archetype  (boosts one stat)",
                 bg=LIGHT, font=("Segoe UI", 11, "bold")).pack(anchor="w")
        arch_frame = tk.Frame(self.body, bg=LIGHT)
        arch_frame.pack(fill="x", pady=(4, 12))
        cb = ttk.Combobox(arch_frame, textvariable=self.archetype,
                          values=list(ARCHETYPES.keys()), state="readonly",
                          font=("Segoe UI", 11), width=14)
        cb.pack(side="left")
        self.arch_desc = tk.Label(arch_frame, text="", bg=LIGHT, fg="#6B7280",
                                  font=("Segoe UI", 9))
        self.arch_desc.pack(side="left", padx=12)

        def on_arch_change(*_):
            info = ARCHETYPES.get(self.archetype.get(), {})
            self.arch_desc.config(text=f"→ boosts {info.get('stat','?')} — {info.get('desc','')}")
        self.archetype.trace_add("write", on_arch_change)
        on_arch_change()

        # Goals (multi-select)
        tk.Label(self.body, text="Build goals  (pick 1 or more)",
                 bg=LIGHT, font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=(8, 4))
        goals_frame = tk.Frame(self.body, bg=LIGHT)
        goals_frame.pack(fill="x")
        for i, g in enumerate(GOALS):
            cb = ttk.Checkbutton(goals_frame, text=g, variable=self.goals[g])
            cb.grid(row=i // 2, column=i % 2, sticky="w", padx=8, pady=2)

    # ---------- step 4: DIM loadouts ----------
    def step_loadouts(self):
        tk.Label(self.body, text="Step 3: DIM Loadouts", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 4))
        tk.Label(self.body,
                 text="Add the DIM share URLs for the loadouts you want decoded. "
                      "Get one from DIM → Loadouts → click loadout → Share → Copy URL. "
                      "Add as many as you want — or skip and add them later.",
                 bg=LIGHT, fg="#374151", font=("Segoe UI", 10),
                 wraplength=640, justify="left").pack(anchor="w", pady=(0, 12))

        # listbox of current loadouts
        list_frame = tk.Frame(self.body, bg=LIGHT)
        list_frame.pack(fill="both", expand=True)

        self.loadout_listbox = tk.Listbox(list_frame, font=("Consolas", 10),
                                          height=10)
        self.loadout_listbox.pack(side="left", fill="both", expand=True)
        scroll = ttk.Scrollbar(list_frame, command=self.loadout_listbox.yview)
        scroll.pack(side="left", fill="y")
        self.loadout_listbox.config(yscrollcommand=scroll.set)
        self.refresh_loadout_list()

        btn_row = tk.Frame(self.body, bg=LIGHT)
        btn_row.pack(fill="x", pady=8)
        ttk.Button(btn_row, text="+  Add loadout...",
                   command=self.add_loadout_dialog).pack(side="left")
        ttk.Button(btn_row, text="–  Remove selected",
                   command=self.remove_loadout).pack(side="left", padx=8)

    def refresh_loadout_list(self):
        if not hasattr(self, "loadout_listbox"):
            return
        self.loadout_listbox.delete(0, tk.END)
        for ld in self.dim_loadouts:
            line = f"{ld['class']:8} | {ld['name']:<32} | {ld['activity']:<10} | {ld['url']}"
            self.loadout_listbox.insert(tk.END, line)

    def remove_loadout(self):
        sel = self.loadout_listbox.curselection()
        if not sel:
            return
        del self.dim_loadouts[sel[0]]
        self.refresh_loadout_list()

    def add_loadout_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("Add DIM loadout")
        dlg.geometry("480x280")
        dlg.transient(self)
        dlg.grab_set()
        dlg.configure(bg=LIGHT)

        cls_var = tk.StringVar(value="Warlock")
        name_var = tk.StringVar()
        activity_var = tk.StringVar(value="General")
        url_var = tk.StringVar()

        def field(label, var, combobox_values=None):
            tk.Label(dlg, text=label, bg=LIGHT,
                     font=("Segoe UI", 10)).pack(anchor="w", padx=16, pady=(8, 0))
            if combobox_values:
                w = ttk.Combobox(dlg, textvariable=var, values=combobox_values,
                                 state="readonly", font=("Segoe UI", 10))
            else:
                w = ttk.Entry(dlg, textvariable=var, font=("Segoe UI", 10))
            w.pack(fill="x", padx=16, pady=2)
            return w

        field("Class", cls_var, CLASSES)
        field('Loadout name (e.g. "Still Hunt Raid")', name_var)
        field("Activity (Raid / PvP / GM / etc.)", activity_var)
        field("DIM share URL (https://dim.gg/...)", url_var)

        def confirm():
            url = url_var.get().strip()
            if not url.startswith(DIM_URL_PREFIX):
                messagebox.showerror("Invalid URL", f"Expected a {DIM_URL_PREFIX}... URL")
                return
            if not name_var.get().strip():
                messagebox.showerror("Missing name", "Please name this loadout.")
                return
            self.dim_loadouts.append({
                "class": cls_var.get(),
                "name": name_var.get().strip(),
                "activity": activity_var.get().strip() or "General",
                "url": url,
            })
            self.refresh_loadout_list()
            dlg.destroy()

        btn_row = tk.Frame(dlg, bg=LIGHT)
        btn_row.pack(fill="x", pady=12)
        ttk.Button(btn_row, text="Add", command=confirm).pack(side="right", padx=(0, 16))
        ttk.Button(btn_row, text="Cancel", command=dlg.destroy).pack(side="right", padx=8)

    # ---------- step 4: confirm ----------
    def step_confirm(self):
        tk.Label(self.body, text="Step 4: Confirm", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 6))
        tk.Label(self.body,
                 text="Click 'Install' to write user_config.json, build your workbook, "
                      "and (if you added loadouts) run the DIM decoder.",
                 bg=LIGHT, fg="#374151", font=("Segoe UI", 11),
                 wraplength=640, justify="left").pack(anchor="w", pady=(0, 12))

        summary = tk.Frame(self.body, bg="white", bd=1, relief="solid")
        summary.pack(fill="x", pady=8)

        def row(label, value):
            r = tk.Frame(summary, bg="white")
            r.pack(fill="x", padx=12, pady=4)
            tk.Label(r, text=label, bg="white", fg="#6B7280",
                     font=("Segoe UI", 10), width=18, anchor="w").pack(side="left")
            tk.Label(r, text=value, bg="white", fg="#111827",
                     font=("Segoe UI", 10, "bold"), anchor="w").pack(side="left")

        masked = self.api_key.get()[:6] + "…" + self.api_key.get()[-4:] \
            if len(self.api_key.get()) > 12 else "(set)"
        row("API key:", masked)
        row("Bungie name:", self.bungie_name.get())
        row("Primary class:", self.primary_class.get())
        row("DIM loadouts:", f"{len(self.dim_loadouts)} added")

        self.next_btn.config(text="Install")

    # ---------- step 5: running install ----------
    def step_running(self):
        self.next_btn.config(state="disabled", text="Installing...")
        self.back_btn.config(state="disabled")
        self.cancel_btn.config(state="disabled")

        tk.Label(self.body, text="Installing...", bg=LIGHT,
                 font=("Segoe UI", 18, "bold")).pack(anchor="w", pady=(4, 12))

        self.log = tk.Text(self.body, height=18, font=("Consolas", 9),
                           bg="#111827", fg="#E5E7EB", bd=0)
        self.log.pack(fill="both", expand=True)
        self.log.insert(tk.END, "Starting install...\n")
        self.log.see(tk.END)

        # run in background so UI doesn't freeze
        threading.Thread(target=self._do_install, daemon=True).start()

    def _log(self, msg):
        self.log.insert(tk.END, msg + "\n")
        self.log.see(tk.END)
        self.update_idletasks()

    def _do_install(self):
        try:
            chosen_goals = [g for g, v in self.goals.items() if v.get()]
            if not chosen_goals:
                chosen_goals = ["PvE"]
            primary_stat = ARCHETYPES.get(self.archetype.get(), {}).get("stat", "Grenade")
            cfg = {
                "_comment": "Personal config — gitignored. Generated by setup_gui.py.",
                "api_key": self.api_key.get().strip(),
                "bungie_name": self.bungie_name.get().strip(),
                "primary_class": self.primary_class.get(),
                "build_focus": {
                    "archetype": self.archetype.get(),
                    "target_stats": [primary_stat],
                    "goals": chosen_goals,
                },
                "workbook_path": f"./{DEFAULT_WORKBOOK}",
                "manifest_cache_dir": DEFAULT_CACHE,
                "dim_loadouts": self.dim_loadouts,
            }
            CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
            try:
                CONFIG_PATH.chmod(0o600)
            except Exception:
                pass
            self._log(f"✓ Wrote {CONFIG_PATH}")

            self._log("Building workbook template...")
            try:
                from init_workbook import build_workbook
            except ImportError:
                self._log("ERROR: openpyxl not installed.")
                self._log("Run: pip install -r requirements.txt")
                self._log("Then run setup_gui.py again.")
                return
            build_workbook(cfg["workbook_path"], user_cfg=cfg)
            self._log(f"✓ Built workbook: {cfg['workbook_path']}")

            if self.dim_loadouts:
                self._log("Running DIM decoder (~30-60s on first run)...")
                proc = subprocess.Popen(
                    [sys.executable, "decode_dim.py"],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
                )
                for line in proc.stdout:
                    self._log(line.rstrip())
                proc.wait()
                if proc.returncode == 0:
                    self._log("✓ Decoder finished")
                else:
                    self._log(f"⚠ Decoder exited with code {proc.returncode}")
            else:
                self._log("(no DIM loadouts entered — skipping decoder)")

            self._log("")
            self._log("Install complete. Click Next > to finish.")
        except Exception as e:
            self._log(f"ERROR: {e}")
        finally:
            self.next_btn.config(state="normal", text="Next >")
            self.cancel_btn.config(state="normal")

    # ---------- step 6: done ----------
    def step_done(self):
        self.next_btn.config(text="Finish", command=self.destroy)
        tk.Label(self.body, text="Done! 🎉", bg=LIGHT,
                 font=("Segoe UI", 22, "bold")).pack(anchor="w", pady=(4, 8))
        tk.Label(self.body,
                 text="Your config and workbook are ready.",
                 bg=LIGHT, font=("Segoe UI", 12)).pack(anchor="w", pady=(0, 12))

        paths = [
            ("Config:",   str(CONFIG_PATH.resolve())),
            ("Workbook:", str(Path(DEFAULT_WORKBOOK).resolve())),
        ]
        for label, value in paths:
            r = tk.Frame(self.body, bg=LIGHT)
            r.pack(fill="x", pady=2)
            tk.Label(r, text=label, bg=LIGHT, fg="#6B7280",
                     font=("Segoe UI", 10), width=12, anchor="w").pack(side="left")
            tk.Label(r, text=value, bg=LIGHT, fg="#111827",
                     font=("Consolas", 10), anchor="w").pack(side="left")

        tk.Label(self.body, text="", bg=LIGHT).pack(pady=8)
        tk.Label(self.body, text="Next steps:", bg=LIGHT,
                 font=("Segoe UI", 11, "bold")).pack(anchor="w")
        tips = [
            f"  • Open {DEFAULT_WORKBOOK} and fill in PRIORITIES, WISHLIST, builds",
            "  • Add more DIM URLs anytime:  python add_loadout.py",
            "  • Re-decode after DIM changes:  python decode_dim.py",
        ]
        for t in tips:
            tk.Label(self.body, text=t, bg=LIGHT, fg="#1F2937",
                     font=("Segoe UI", 10)).pack(anchor="w")


def main():
    # Tkinter sometimes can't find its libs when frozen by PyInstaller on Windows.
    # Make sure we're running from the repo dir so relative paths work.
    if getattr(sys, "frozen", False):
        os.chdir(Path(sys.executable).parent)
    app = Wizard()
    app.mainloop()


if __name__ == "__main__":
    main()
