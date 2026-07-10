"""Liquid Glass drawing primitives for the Break Guard desktop widget."""

from __future__ import annotations

import sys
from dataclasses import dataclass, replace
from tkinter import Canvas


def rounded_rect(canvas: Canvas, x1: int, y1: int, x2: int, y2: int, radius: int, **kwargs) -> int:
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
    a = a.lstrip("#")
    b = b.lstrip("#")
    ar, ag, ab = int(a[0:2], 16), int(a[2:4], 16), int(a[4:6], 16)
    br, bg, bb = int(b[0:2], 16), int(b[2:4], 16), int(b[4:6], 16)
    return f"#{round(ar + (br - ar) * t):02x}{round(ag + (bg - ag) * t):02x}{round(ab + (bb - ab) * t):02x}"


def draw_vertical_gradient(canvas: Canvas, width: int, height: int, top: str, bottom: str) -> None:
    steps = max(1, height)
    for y in range(steps):
        canvas.create_line(0, y, width, y, fill=blend_hex(top, bottom, y / steps))


@dataclass(frozen=True)
class LiquidTokens:
    panel_bg: str = "#eef5ff"
    panel_bg_inner: str = "#f7faff"
    panel_border: str = "#ffffff"
    panel_border_soft: str = "#ccdcf4"
    panel_shadow: str = "#7899c7"
    text_primary: str = "#0b1526"
    text_secondary: str = "#53627a"
    text_tertiary: str = "#7b8ba4"
    accent: str = "#0a84ff"
    accent_hover: str = "#0077ed"
    accent_pressed: str = "#0068ce"
    accent_soft: str = "#dcecff"
    success: str = "#34c759"
    success_text: str = "#16733a"
    success_soft: str = "#e3f7e9"
    warning: str = "#ff9f0a"
    warning_text: str = "#865000"
    warning_soft: str = "#fff1d7"
    danger: str = "#ff453a"
    danger_text: str = "#a52620"
    danger_soft: str = "#ffe3e1"
    violet_text: str = "#6542b8"
    violet_soft: str = "#eee9ff"
    neutral_soft: str = "#edf2f9"
    control_bg: str = "#f8fbff"
    control_hover: str = "#eaf2ff"
    control_pressed: str = "#dce8f8"
    timer_bg: str = "#f9fbff"
    timer_shadow: str = "#9bb6da"
    bg_top: str = "#f6f9ff"
    bg_bottom: str = "#d8e7fb"
    glow_blue: str = "#c5ddff"
    glow_pink: str = "#eadfff"
    glow_green: str = "#d7f3e2"
    radius_lg: int = 22
    radius_xl: int = 28
    radius_2xl: int = 32
    blur_lg: int = 22
    space_1: int = 8
    space_2: int = 12
    space_3: int = 16
    space_4: int = 20
    space_5: int = 24
    space_6: int = 32
    motion_fast_ms: int = 150
    motion_base_ms: int = 220
    motion_slow_ms: int = 320
    motion_curve: str = "cubic-bezier(0.2, 0.8, 0.2, 1)"
    font_title: tuple[str, int, str] = ("Segoe UI Variable Display", 16, "bold")
    font_subtitle: tuple[str, int] = ("Microsoft YaHei UI", 10)
    font_timer: tuple[str, int, str] = ("Segoe UI Variable Display", 58, "bold")
    font_status: tuple[str, int, str] = ("Microsoft YaHei UI", 10, "bold")
    font_button: tuple[str, int, str] = ("Microsoft YaHei UI", 10, "bold")
    font_footer: tuple[str, int] = ("Microsoft YaHei UI", 9)


LIGHT_LIQUID = LiquidTokens()
DARK_LIQUID = replace(
    LIGHT_LIQUID,
    panel_bg="#172236",
    panel_bg_inner="#1d2a40",
    panel_border="#40516a",
    panel_border_soft="#2e3c52",
    panel_shadow="#020617",
    text_primary="#f8fafc",
    text_secondary="#cbd5e1",
    text_tertiary="#94a3b8",
    accent="#5eb0ff",
    accent_hover="#78bdff",
    accent_pressed="#3e99ee",
    accent_soft="#193d68",
    success="#6ee7b7",
    success_text="#bbf7d0",
    success_soft="#12352b",
    warning="#fbbf24",
    warning_text="#fde68a",
    warning_soft="#3a2b12",
    danger="#fb7185",
    danger_text="#fecdd3",
    danger_soft="#3f1720",
    violet_text="#ddd6fe",
    violet_soft="#2f2350",
    neutral_soft="#1f2937",
    control_bg="#26354c",
    control_hover="#30425d",
    control_pressed="#1f2b3e",
    timer_bg="#111d30",
    timer_shadow="#020617",
    bg_top="#0a1220",
    bg_bottom="#111c2e",
    glow_blue="#173a69",
    glow_pink="#39254f",
    glow_green="#164535",
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
        self.canvas.create_oval(width - 154, -82, width + 46, 112, fill=blend_hex(self.t.bg_top, self.t.glow_blue, 0.38), outline="")
        self.canvas.create_oval(-104, height - 126, 96, height + 68, fill=blend_hex(self.t.bg_bottom, self.t.glow_pink, 0.28), outline="")

    def glass_panel(self, x1: int, y1: int, x2: int, y2: int, tags: str | None = None) -> None:
        rounded_rect(self.canvas, x1 + 3, y1 + 7, x2 + 3, y2 + 7, self.t.radius_xl, fill=blend_hex(self.t.bg_bottom, self.t.panel_shadow, 0.22), outline="", tags=tags)
        rounded_rect(self.canvas, x1, y1, x2, y2, self.t.radius_xl, fill=self.t.panel_bg, outline=self.t.panel_border, width=1, tags=tags)
        rounded_rect(self.canvas, x1 + 5, y1 + 5, x2 - 5, y2 - 5, self.t.radius_lg, fill=self.t.panel_bg_inner, outline=self.t.panel_border_soft, width=1, tags=tags)
        self.canvas.create_line(x1 + 30, y1 + 11, x2 - 30, y1 + 11, fill=self.t.panel_border, width=2, tags=tags)

    def timer_well(self, x1: int, y1: int, x2: int, y2: int) -> None:
        rounded_rect(self.canvas, x1 + 1, y1 + 4, x2 + 1, y2 + 4, self.t.radius_lg, fill=blend_hex(self.t.panel_bg, self.t.timer_shadow, 0.25), outline="")
        rounded_rect(self.canvas, x1, y1, x2, y2, self.t.radius_lg, fill=self.t.timer_bg, outline=self.t.panel_border_soft, width=1)
        self.canvas.create_line(x1 + 34, y1 + 9, x2 - 34, y1 + 9, fill=self.t.panel_border, width=2)

    def button(self, x: int, y: int, w: int, h: int, text: str, tag: str, fill: str, fg: str, primary: bool = False) -> dict[str, str]:
        shadow = self.t.timer_shadow if primary else self.t.panel_shadow
        shadow_fill = blend_hex(self.t.panel_bg, shadow, 0.28 if primary else 0.18)
        rounded_rect(self.canvas, x + 1, y + 3, x + w + 1, y + h + 3, h // 2, fill=shadow_fill, outline="", tags=(tag, f"{tag}__shadow"))
        rounded_rect(self.canvas, x, y, x + w, y + h, h // 2, fill=fill, outline=self.t.panel_border, width=1, tags=(tag, f"{tag}__surface"))
        self.canvas.create_text(x + w / 2, y + h / 2, text=text, fill=fg, font=self.t.font_button, tags=(tag, f"{tag}__label"))
        return {"surface": f"{tag}__surface", "label": f"{tag}__label", "shine": "", "normal": fill, "hover": self.t.accent_hover if primary else self.t.control_hover, "pressed": self.t.accent_pressed if primary else self.t.control_pressed}

    def icon_button(self, x: int, y: int, size: int, text: str, tag: str) -> dict[str, str]:
        return self.button(x, y, size, size, text, tag, self.t.control_bg, self.t.text_secondary)

    def status_dot(self, x: int, y: int, color: str, tags: str | None = None) -> int:
        self.canvas.create_oval(x - 2, y - 2, x + 12, y + 12, fill=blend_hex(self.t.panel_bg_inner, color, 0.18), outline="", tags=tags)
        return self.canvas.create_oval(x, y, x + 10, y + 10, fill=color, outline=self.t.panel_border, width=1, tags=tags)
