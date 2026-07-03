from __future__ import annotations

import argparse
import json
import mimetypes
import tempfile
import threading
import sys
import webbrowser
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import filedialog
except Exception:  # pragma: no cover - tkinter availability is environment-specific.
    tk = None
    filedialog = None

from profile_tool import __version__
from profile_tool.core import (
    ProfileGenerationError,
    generate_profiles,
    parse_date,
    summaries_as_dicts,
)


def resource_path(*parts: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return base.joinpath(*parts)


STATIC_DIR = resource_path("profile_tool", "static")


def _choose_windows_folder(title: str) -> str:
    import ctypes
    import uuid
    from ctypes import wintypes

    HRESULT = ctypes.c_long
    SIGDN_FILESYSPATH = 0x80058000
    CLSCTX_INPROC_SERVER = 0x1
    COINIT_APARTMENTTHREADED = 0x2
    RPC_E_CHANGED_MODE = 0x80010106
    HRESULT_CANCELLED = 0x800704C7

    FOS_NOCHANGEDIR = 0x00000008
    FOS_PICKFOLDERS = 0x00000020
    FOS_FORCEFILESYSTEM = 0x00000040
    FOS_PATHMUSTEXIST = 0x00000800

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    def guid(value: str) -> GUID:
        return GUID.from_buffer_copy(uuid.UUID(value).bytes_le)

    def failed(hr: int) -> bool:
        return (hr & 0xFFFFFFFF) >= 0x80000000

    def check(hr: int, message: str) -> None:
        if failed(hr):
            raise OSError(hr, message)

    def com_method(obj: ctypes.c_void_p, index: int, restype, *argtypes):
        vtable = ctypes.cast(
            obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))
        ).contents
        return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(vtable[index])

    ole32 = ctypes.OleDLL("ole32")
    user32 = ctypes.WinDLL("user32")

    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = HRESULT
    ole32.CoCreateInstance.argtypes = [
        ctypes.POINTER(GUID),
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(GUID),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    ole32.CoCreateInstance.restype = HRESULT
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    user32.GetForegroundWindow.restype = wintypes.HWND

    clsid_file_open_dialog = guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")
    iid_file_open_dialog = guid("D57C7288-D4AD-4768-BE02-9D969532D960")

    initialized = False
    dialog = ctypes.c_void_p()
    item = ctypes.c_void_p()
    path_ptr = wintypes.LPWSTR()
    try:
        hr = ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
        if failed(hr) and (hr & 0xFFFFFFFF) != RPC_E_CHANGED_MODE:
            check(hr, "Could not initialize the Windows folder picker.")
        initialized = not failed(hr)

        check(
            ole32.CoCreateInstance(
                ctypes.byref(clsid_file_open_dialog),
                None,
                CLSCTX_INPROC_SERVER,
                ctypes.byref(iid_file_open_dialog),
                ctypes.byref(dialog),
            ),
            "Could not create the Windows folder picker.",
        )

        get_options = com_method(
            dialog, 10, HRESULT, ctypes.POINTER(wintypes.DWORD)
        )
        set_options = com_method(dialog, 9, HRESULT, wintypes.DWORD)
        set_title = com_method(dialog, 17, HRESULT, wintypes.LPCWSTR)
        set_ok_label = com_method(dialog, 18, HRESULT, wintypes.LPCWSTR)
        show = com_method(dialog, 3, HRESULT, wintypes.HWND)
        get_result = com_method(
            dialog, 20, HRESULT, ctypes.POINTER(ctypes.c_void_p)
        )

        options = wintypes.DWORD()
        check(get_options(dialog, ctypes.byref(options)), "Could not read picker options.")
        options.value |= (
            FOS_PICKFOLDERS
            | FOS_FORCEFILESYSTEM
            | FOS_PATHMUSTEXIST
            | FOS_NOCHANGEDIR
        )
        check(set_options(dialog, options), "Could not configure the folder picker.")
        check(set_title(dialog, title), "Could not set the folder picker title.")
        set_ok_label(dialog, "Select Folder")

        owner = user32.GetForegroundWindow()
        hr = show(dialog, owner)
        if (hr & 0xFFFFFFFF) == HRESULT_CANCELLED:
            return ""
        check(hr, "Could not show the Windows folder picker.")

        check(get_result(dialog, ctypes.byref(item)), "Could not read selected folder.")
        get_display_name = com_method(
            item, 5, HRESULT, wintypes.DWORD, ctypes.POINTER(wintypes.LPWSTR)
        )
        check(
            get_display_name(item, SIGDN_FILESYSPATH, ctypes.byref(path_ptr)),
            "Could not read selected folder path.",
        )
        return path_ptr.value or ""
    finally:
        if ctypes.cast(path_ptr, ctypes.c_void_p).value:
            ole32.CoTaskMemFree(ctypes.cast(path_ptr, ctypes.c_void_p))
        if item.value:
            release_item = com_method(item, 2, wintypes.ULONG)
            release_item(item)
        if dialog.value:
            release_dialog = com_method(dialog, 2, wintypes.ULONG)
            release_dialog(dialog)
        if initialized:
            ole32.CoUninitialize()


def _choose_tkinter_folder(title: str) -> str | None:
    if tk is None or filedialog is None:
        return None
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(title=title)
    finally:
        root.destroy()


@dataclass
class UploadedField:
    value: str = ""
    filename: str = ""
    data: bytes = b""


class ProfileToolHandler(SimpleHTTPRequestHandler):
    server_version = "DemandProjectionTool/0.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        if getattr(self.server, "quiet", False) or sys.stderr is None:
            return
        super().log_message(format, *args)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._serve_static("index.html", "text/html; charset=utf-8")
            return
        if self.path == "/app.js":
            self._serve_static("app.js", "application/javascript; charset=utf-8")
            return
        if self.path == "/style.css":
            self._serve_static("style.css", "text/css; charset=utf-8")
            return
        if self.path == "/choose-output-folder":
            self._choose_output_folder()
            return
        if self.path == "/version":
            self._send_json({"version": __version__})
            return
        if self.path == "/shutdown":
            self._send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/generate":
            self._generate()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def _serve_static(self, name: str, content_type: str) -> None:
        path = STATIC_DIR / name
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "Static asset missing")
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _choose_output_folder(self) -> None:
        title = "Choose output folder"
        if sys.platform == "win32":
            try:
                selected = _choose_windows_folder(title)
            except Exception as exc:
                self._send_json(
                    {
                        "ok": False,
                        "error": f"Could not open the Windows folder picker: {exc}",
                    },
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            self._send_json({"ok": True, "path": selected})
            return

        selected = _choose_tkinter_folder(title)
        if selected is None:
            self._send_json(
                {"ok": False, "error": "Native folder picker is unavailable."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self._send_json({"ok": True, "path": selected})

    def _generate(self) -> None:
        try:
            form = self._parse_multipart_form()
            result = self._run_generation(form)
        except ProfileGenerationError as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        except Exception as exc:  # pragma: no cover - defensive UI boundary.
            self._send_json(
                {"ok": False, "error": f"Unexpected error: {exc}"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self._send_json(result)

    def _parse_multipart_form(self) -> dict[str, UploadedField]:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise ProfileGenerationError("Request must be multipart/form-data.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ProfileGenerationError("Invalid upload length.") from exc
        body = self.rfile.read(length)
        header = (
            f"Content-Type: {content_type}\r\n"
            "MIME-Version: 1.0\r\n"
            "\r\n"
        ).encode("utf-8")
        message = BytesParser(policy=policy.default).parsebytes(header + body)
        if not message.is_multipart():
            raise ProfileGenerationError("Could not parse uploaded form data.")

        form: dict[str, UploadedField] = {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            filename = part.get_filename() or ""
            payload = part.get_payload(decode=True) or b""
            if filename:
                form[name] = UploadedField(filename=filename, data=payload)
            else:
                charset = part.get_content_charset() or "utf-8"
                form[name] = UploadedField(value=payload.decode(charset).strip())
        return form

    def _field_text(
        self, form: dict[str, UploadedField], name: str, required: bool = True
    ) -> str:
        item = form.get(name)
        value = ""
        if item is not None and not item.filename:
            value = item.value.strip()
        if required and not value:
            raise ProfileGenerationError(f"Missing required field: {name}.")
        return value

    def _save_upload(
        self, form: dict[str, UploadedField], name: str, temp_dir: Path
    ) -> Path:
        item = form.get(name)
        if item is None or not item.filename:
            raise ProfileGenerationError(f"Missing required file: {name}.")
        filename = Path(item.filename).name or f"{name}.csv"
        if Path(filename).suffix.lower() not in {".csv", ".xlsx"}:
            raise ProfileGenerationError(
                f"{filename} must be a CSV or XLSX file."
            )
        upload_dir = temp_dir / name
        upload_dir.mkdir()
        path = upload_dir / filename
        with path.open("wb") as handle:
            handle.write(item.data)
        return path

    def _run_generation(self, form: dict[str, UploadedField]) -> dict:
        output_folder = self._field_text(form, "output_folder")
        output_dir = Path(output_folder)
        if not output_dir.exists() or not output_dir.is_dir():
            raise ProfileGenerationError("Please choose a valid output folder.")

        with tempfile.TemporaryDirectory(prefix="demand_projection_tool_") as temp:
            temp_dir = Path(temp)
            base_path = self._save_upload(form, "base_profile", temp_dir)
            peak_path = self._save_upload(form, "peak_projection", temp_dir)
            energy_path = self._save_upload(form, "energy_projection", temp_dir)

            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=parse_date(self._field_text(form, "base_start_date")),
                base_end_date=parse_date(self._field_text(form, "base_end_date")),
                projection_start_year=int(
                    self._field_text(form, "projection_start_year")
                ),
                projection_end_year=int(self._field_text(form, "projection_end_year")),
                output_dir=output_dir,
                profile_name=self._field_text(form, "profile_name", required=False),
            )

        return {
            "ok": True,
            "output_path": str(result.output_path),
            "rows_written": result.rows_written,
            "summaries": summaries_as_dicts(result.summaries),
            "graph": result.graph,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Demand Projection Tool")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--version", action="store_true")
    return parser


def run_server(host: str, port: int, open_browser: bool, quiet: bool) -> None:
    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer((host, port), ProfileToolHandler)
    server.quiet = quiet
    actual_port = server.server_address[1]
    url = f"http://{host}:{actual_port}/"
    if not quiet and sys.stdout is not None:
        print(f"Demand Projection Tool running at {url}")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    run_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_browser,
        quiet=args.quiet,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
