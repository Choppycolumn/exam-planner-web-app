from __future__ import annotations

import ctypes
import time
from tkinter import BOTH, Canvas, Toplevel

from breakguard_logging import log_error
from breakguard_widgets import IS_WINDOWS, clamp_window_to_screen, default_geometry, geometry_with_size
from liquid_style import LIQUID


class WindowMixin:
    def enable_acrylic(self) -> None:
        if not IS_WINDOWS:
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id()) or self.root.winfo_id()

            corner = ctypes.c_int(2)
            backdrop = ctypes.c_int(2)
            dark = ctypes.c_int(1 if LIQUID.bg_top.startswith("#0") else 0)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner), ctypes.sizeof(corner))
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 38, ctypes.byref(backdrop), ctypes.sizeof(backdrop))
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark))
            region = ctypes.windll.gdi32.CreateRoundRectRgn(0, 0, self.width + 1, self.height + 1, 34, 34)
            ctypes.windll.user32.SetWindowRgn(hwnd, region, True)
        except Exception as exc:
            log_error("acrylic enable failed", exc)
    def hide_from_taskbar(self) -> None:
        if not IS_WINDOWS:
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            get_long, set_long = ctypes.windll.user32.GetWindowLongPtrW, ctypes.windll.user32.SetWindowLongPtrW
            style = get_long(hwnd, -20)
            set_long(hwnd, -20, (style & ~0x00040000) | 0x00000080)
            self.root.withdraw()
            self.root.after(10, self.root.deiconify)
        except Exception as exc:
            log_error("taskbar style update failed", exc)
    def enter_compact_mode(self) -> None:
        if self.compact_mode:
            return
        self.normal_width, self.normal_height = self.width, self.height
        self.normal_geometry = f"{self.normal_width}x{self.normal_height}+{self.root.winfo_x()}+{self.root.winfo_y()}"
        self.config.window_geometry = self.normal_geometry
        self.config.save()
        right_edge = self.root.winfo_x() + self.normal_width
        top = self.root.winfo_y()
        self.compact_mode = True
        self.width, self.height = 360, 168
        self.root.geometry(f"{self.width}x{self.height}+{max(0, right_edge - self.width)}+{max(0, top)}")
        self.build_ui()
        self.enable_acrylic()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.refresh_view_state()
    def exit_compact_mode(self) -> None:
        if not self.compact_mode:
            return
        self.compact_mode = False
        self.width, self.height = self.normal_width, self.normal_height
        self.root.geometry(geometry_with_size(self.normal_geometry, self.width, self.height))
        self.build_ui()
        self.enable_acrylic()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.refresh_view_state()
    def start_drag(self, event) -> None:
        edge = self.resize_hit_test(event.x, event.y)
        if edge:
            self.resize_edge = edge
            self.resize_origin = (
                event.x_root,
                event.y_root,
                self.root.winfo_x(),
                self.root.winfo_y(),
                self.root.winfo_width(),
                self.root.winfo_height(),
            )
            self.resize_target = None
            self.show_resize_preview()
            return
        header_limit = self.width - (100 if self.compact_mode else 64)
        header_height = 72 if self.compact_mode else 96
        if event.widget is self.canvas and event.y < header_height and event.x < header_limit:
            self.dragging = True
            self.drag_offset = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())
    def drag(self, event) -> None:
        if self.resize_edge and self.resize_origin:
            now = time.monotonic()
            if now - self.last_resize_update >= 0.025:
                self.last_resize_update = now
                self.apply_resize(event.x_root, event.y_root)
        elif self.dragging:
            self.root.geometry(f"+{event.x_root - self.drag_offset[0]}+{event.y_root - self.drag_offset[1]}")
    def apply_resize(self, pointer_x: int, pointer_y: int) -> None:
        if not self.resize_edge or not self.resize_origin:
            return
        start_x, start_y, window_x, window_y, window_width, window_height = self.resize_origin
        delta_x, delta_y = pointer_x - start_x, pointer_y - start_y
        x, y, width, height = window_x, window_y, window_width, window_height
        if "e" in self.resize_edge:
            width = max(self.minimum_width, window_width + delta_x)
        if "s" in self.resize_edge:
            height = max(self.minimum_height, window_height + delta_y)
        if "w" in self.resize_edge:
            width = max(self.minimum_width, window_width - delta_x)
            x = window_x + window_width - width
        if "n" in self.resize_edge:
            height = max(self.minimum_height, window_height - delta_y)
            y = window_y + window_height - height
        self.resize_target = (x, y, width, height)
        if self.resize_preview and self.resize_preview.winfo_exists():
            self.resize_preview.geometry(f"{width}x{height}+{x}+{y}")
            self.resize_preview.update_idletasks()
            if self.resize_preview_canvas is not None and self.resize_preview_border is not None:
                self.resize_preview_canvas.coords(self.resize_preview_border, 2, 2, width - 3, height - 3)
    def show_resize_preview(self) -> None:
        self.close_resize_preview()
        try:
            preview = Toplevel(self.root)
            preview.withdraw()
            preview.overrideredirect(True)
            preview.attributes("-topmost", True)
            preview.configure(bg="#ff00ff")
            if IS_WINDOWS:
                preview.attributes("-transparentcolor", "#ff00ff")
            canvas = Canvas(preview, bg="#ff00ff", highlightthickness=0)
            canvas.pack(fill=BOTH, expand=True)
            border = canvas.create_rectangle(
                2, 2, self.root.winfo_width() - 3, self.root.winfo_height() - 3,
                outline=LIQUID.accent, width=3,
            )
            preview.geometry(
                f"{self.root.winfo_width()}x{self.root.winfo_height()}+{self.root.winfo_x()}+{self.root.winfo_y()}"
            )
            preview.deiconify()
            preview.lift()
            self.resize_preview = preview
            self.resize_preview_canvas = canvas
            self.resize_preview_border = border
        except Exception as exc:
            self.resize_preview = None
            self.resize_preview_canvas = None
            self.resize_preview_border = None
            log_error("resize preview failed", exc)
    def close_resize_preview(self) -> None:
        preview = self.resize_preview
        self.resize_preview = None
        self.resize_preview_canvas = None
        self.resize_preview_border = None
        if preview is not None:
            try:
                if preview.winfo_exists():
                    preview.destroy()
            except Exception:
                pass
    def stop_drag(self, event) -> None:
        if self.resize_edge:
            current_status = self.canvas.itemcget(self.status_item, "text") if self.canvas is not None and self.status_item else ""
            self.apply_resize(event.x_root, event.y_root)
            target = self.resize_target
            self.close_resize_preview()
            self.resize_edge = ""
            self.resize_origin = None
            self.resize_target = None
            if target:
                x, y, width, height = target
                self.root.geometry(f"{width}x{height}+{x}+{y}")
            self.root.update_idletasks()
            self.width = max(self.minimum_width, self.root.winfo_width())
            self.height = max(self.minimum_height, self.root.winfo_height())
            self.normal_width, self.normal_height = self.width, self.height
            self.root.geometry(f"{self.width}x{self.height}+{self.root.winfo_x()}+{self.root.winfo_y()}")
            self.build_ui()
            self.enable_acrylic()
            clamp_window_to_screen(self.root, self.width, self.height)
            self.refresh_view_state()
            if current_status:
                self.set_status(current_status)
            self.persist_window_geometry()
            self.update_resize_cursor(event)
            return
        if not self.dragging:
            return
        self.dragging = False
        clamp_window_to_screen(self.root, self.width, self.height)
        self.persist_window_geometry()
    def resize_hit_test(self, x: int, y: int) -> str:
        if self.compact_mode:
            return ""
        margin = 9
        horizontal = "w" if x <= margin else "e" if x >= self.width - margin else ""
        vertical = "n" if y <= margin else "s" if y >= self.height - margin else ""
        return vertical + horizontal
    def update_resize_cursor(self, event) -> None:
        if self.canvas is None or self.dragging or self.resize_edge:
            return
        edge = self.resize_hit_test(event.x, event.y)
        cursors = {
            "n": "size_ns", "s": "size_ns", "e": "size_we", "w": "size_we",
            "ne": "size_ne_sw", "sw": "size_ne_sw", "nw": "size_nw_se", "se": "size_nw_se",
        }
        try:
            self.canvas.configure(cursor=cursors.get(edge, ""))
        except Exception:
            self.canvas.configure(cursor="sizing" if edge else "")
    def persist_window_geometry(self) -> None:
        if self.compact_mode:
            return
        self.normal_width, self.normal_height = self.width, self.height
        self.normal_geometry = f"{self.width}x{self.height}+{self.root.winfo_x()}+{self.root.winfo_y()}"
        self.config.window_geometry = self.normal_geometry
        self.config.save()
    def hide_to_tray(self) -> None:
        if self.exiting:
            return
        if not self.tray.available:
            self.set_status("托盘不可用，已阻止隐藏以免窗口丢失")
            self.root.lift()
            return
        self.hidden_to_tray = True
        self.root.withdraw()
    def show_window(self) -> None:
        self.hidden_to_tray = False
        self.build_ui()
        self.root.deiconify()
        self.root.lift()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.refresh_view_state()
    def toggle_window(self) -> None:
        if self.hidden_to_tray or not self.root.winfo_viewable():
            self.show_window()
        else:
            self.hide_to_tray()
    def reset_window_position(self) -> None:
        self.compact_mode = False
        self.width = self.minimum_width
        self.height = self.minimum_height
        self.normal_width, self.normal_height = self.width, self.height
        self.config.window_geometry = ""
        self.config.save()
        self.root.geometry(default_geometry(self.width, self.height))
        self.normal_geometry = default_geometry(self.width, self.height)
        self.show_window()
        self.set_status("窗口位置已重置")
