"""Apple-inspired drawing tokens and primitives for the Break Guard widget."""

from __future__ import annotations

import sys
from dataclasses import dataclass, replace
from tkinter import Canvas


def rounded_rect(canvas: Canvas, x1: float, y1: float, x2: float, y2: float, radius: int, **kwargs) -> int:
    max_radius = max(0, int(min(abs(x2 - x1), abs(y2 - y1)) / 2))
    radius = max(0, min(int(radius), max_radius))
    if radius == 0:
        return canvas.create_rectangle(x1, y1, x2, y2, **kwargs)
    points = [
        x1 + radius, y1,
        x2 - radius, y1,
        x2, y1,
        x2, y1 + radius,
        x2, y2 - radius,
        x2, y2,
        x2 - radius, y2,
        x1 + radius, y2,
        x1, y2,
        x1, y2 - radius,
        x1, y1 + radius,
        x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, **kwargs)


def blend_hex(a: str, b: str, t: float) -> str:
    t = max(0.0, min(1.0, float(t)))
    a = a.lstrip("#")
    b = b.lstrip("#")
    ar, ag, ab = int(a[0:2], 16), int(a[2:4], 16), int(a[4:6], 16)
    br, bg, bb = int(b[0:2], 16), int(b[2:4], 16), int(b[4:6], 16)
    return f"#{round(ar + (br - ar) * t):02x}{round(ag + (bg - ag) * t):02x}{round(ab + (bb - ab) * t):02x}"


def draw_vertical_gradient(canvas: Canvas, width: int, height: int, top: str, bottom: str) -> None:
    """Draw a smooth gradient with a bounded item count for cheap redraws."""
    steps = max(1, min(int(height), 180))
    band_height = height / steps
    for index in range(steps):
        y1 = round(index * band_height)
        y2 = max(y1 + 1, round((index + 1) * band_height))
        canvas.create_rectangle(
            0, y1, width, y2,
            fill=blend_hex(top, bottom, index / max(1, steps - 1)),
            outline="",
        )


@dataclass(frozen=True)
class LiquidTokens:
    panel_bg: str = "#f4f8fe"
    panel_bg_inner: str = "#f8fbff"
    panel_border: str = "#ffffff"
    panel_border_soft: str = "#c7d6e9"
    panel_shadow: str = "#8aa3c2"
    text_primary: str = "#111c2e"
    text_secondary: str = "#52647a"
    text_tertiary: str = "#78899d"
    accent: str = "#0a84ff"
    accent_hover: str = "#0077ed"
    accent_pressed: str = "#006fdc"
    accent_soft: str = "#e2f0ff"
    accent_border: str = "#aed3fb"
    success: str = "#28a866"
    success_text: str = "#167440"
    success_soft: str = "#e4f6eb"
    warning: str = "#e8930c"
    warning_text: str = "#895400"
    warning_soft: str = "#fff1d8"
    danger: str = "#db4661"
    danger_text: str = "#a7253d"
    danger_soft: str = "#ffe7ec"
    violet_text: str = "#6652bd"
    violet_soft: str = "#efebff"
    neutral_soft: str = "#e8eff8"
    control_bg: str = "#f8fbff"
    control_hover: str = "#edf5ff"
    control_pressed: str = "#dfeaf7"
    timer_bg: str = "#fbfdff"
    timer_shadow: str = "#96acc8"
    bg_top: str = "#edf4ff"
    bg_bottom: str = "#dce9f8"
    glow_blue: str = "#d8eaff"
    glow_pink: str = "#eee8ff"
    glow_green: str = "#e3f5ec"
    scrim: str = "#07111f"
    radius_sm: int = 10
    radius_md: int = 14
    radius_lg: int = 20
    radius_xl: int = 26
    radius_2xl: int = 30
    blur_lg: int = 28
    space_1: int = 8
    space_2: int = 12
    space_3: int = 16
    space_4: int = 20
    space_5: int = 24
    space_6: int = 32
    motion_fast_ms: int = 120
    motion_base_ms: int = 220
    motion_slow_ms: int = 340
    motion_curve: str = "cubic-bezier(0.2, 0.78, 0.2, 1)"
    font_title: tuple[str, int, str] = ("Segoe UI Variable Display", 16, "bold")
    font_subtitle: tuple[str, int] = ("Microsoft YaHei UI", 9)
    font_timer: tuple[str, int, str] = ("Segoe UI Variable Display", 56, "bold")
    font_status: tuple[str, int, str] = ("Microsoft YaHei UI", 9, "bold")
    font_button: tuple[str, int, str] = ("Microsoft YaHei UI", 9, "bold")
    font_footer: tuple[str, int] = ("Microsoft YaHei UI", 8)


LIGHT_LIQUID = LiquidTokens()
DARK_LIQUID = replace(
    LIGHT_LIQUID,
    panel_bg="#111e30",
    panel_bg_inner="#16253a",
    panel_border="#33445c",
    panel_border_soft="#2d3d54",
    panel_shadow="#020817",
    text_primary="#f4f8fd",
    text_secondary="#b7c6d8",
    text_tertiary="#8fa2b8",
    accent="#5aaaff",
    accent_hover="#79baff",
    accent_pressed="#4299f2",
    accent_soft="#183b64",
    accent_border="#315f8e",
    success="#62d3aa",
    success_text="#a7efd2",
    success_soft="#15372e",
    warning="#f0b65b",
    warning_text="#f7cf8f",
    warning_soft="#3a2b13",
    danger="#ff8ba3",
    danger_text="#ffc0cd",
    danger_soft="#401b25",
    violet_text="#c3b8ff",
    violet_soft="#2e2850",
    neutral_soft="#213047",
    control_bg="#1a2a40",
    control_hover="#243750",
    control_pressed="#152338",
    timer_bg="#0e1a2b",
    timer_shadow="#020817",
    bg_top="#07101d",
    bg_bottom="#0b1727",
    glow_blue="#173a69",
    glow_pink="#39254f",
    glow_green="#164535",
    scrim="#030812",
)


def windows_prefers_dark() -> bool:
    if not sys.platform.startswith("win"):
        return False
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as key:
            value, _kind = winreg.QueryValueEx(key, "AppsUseLightTheme")
            return int(value) == 0
    except Exception:
        return False


LIQUID = DARK_LIQUID if windows_prefers_dark() else LIGHT_LIQUID


class LiquidPainter:
    def __init__(self, canvas: Canvas, tokens: LiquidTokens = LIQUID):
        self.canvas = canvas
        self.t = tokens

    def background(self, width: int, height: int) -> None:
        draw_vertical_gradient(self.canvas, width, height, self.t.bg_top, self.t.bg_bottom)

    def glass_panel(self, x1: int, y1: int, x2: int, y2: int, tags: str | None = None) -> None:
        rounded_rect(
            self.canvas, x1 + 2, y1 + 5, x2 + 2, y2 + 5, self.t.radius_xl,
            fill=blend_hex(self.t.bg_bottom, self.t.panel_shadow, 0.2), outline="", tags=tags,
        )
        rounded_rect(
            self.canvas, x1, y1, x2, y2, self.t.radius_xl,
            fill=self.t.panel_bg, outline=self.t.panel_border_soft, width=1, tags=tags,
        )

    def timer_well(self, x1: int, y1: int, x2: int, y2: int) -> None:
        rounded_rect(
            self.canvas, x1 + 1, y1 + 3, x2 + 1, y2 + 3, self.t.radius_lg,
            fill=blend_hex(self.t.panel_bg, self.t.timer_shadow, 0.18), outline="",
        )
        rounded_rect(
            self.canvas, x1, y1, x2, y2, self.t.radius_lg,
            fill=self.t.timer_bg, outline=self.t.panel_border_soft, width=1,
        )

    def button(self, x: int, y: int, w: int, h: int, text: str, tag: str, fill: str, fg: str, primary: bool = False) -> dict[str, str]:
        radius = min(self.t.radius_md, max(self.t.radius_sm, h // 2))
        if primary:
            rounded_rect(
                self.canvas, x + 1, y + 3, x + w + 1, y + h + 3, radius,
                fill=blend_hex(self.t.panel_bg, self.t.accent, 0.2), outline="", tags=(tag, f"{tag}__shadow"),
            )
        rounded_rect(
            self.canvas, x, y, x + w, y + h, radius,
            fill=fill,
            outline=self.t.accent_border if primary else self.t.panel_border_soft,
            width=1,
            tags=(tag, f"{tag}__surface"),
        )
        self.canvas.create_text(
            x + w / 2, y + h / 2, text=text, fill=fg,
            font=self.t.font_button, tags=(tag, f"{tag}__label"),
        )
        return {
            "surface": f"{tag}__surface",
            "label": f"{tag}__label",
            "shine": "",
            "normal": fill,
            "hover": self.t.accent_hover if primary else self.t.control_hover,
            "pressed": self.t.accent_pressed if primary else self.t.control_pressed,
        }

    def icon_button(self, x: int, y: int, size: int, text: str, tag: str) -> dict[str, str]:
        return self.button(x, y, size, size, text, tag, self.t.control_bg, self.t.text_secondary)

    def status_dot(self, x: int, y: int, color: str, tags: str | None = None) -> int:
        self.canvas.create_oval(
            x - 3, y - 3, x + 11, y + 11,
            fill=blend_hex(self.t.panel_bg, color, 0.16), outline="", tags=tags,
        )
        return self.canvas.create_oval(
            x, y, x + 8, y + 8,
            fill=color, outline=self.t.panel_border, width=1, tags=tags,
        )
