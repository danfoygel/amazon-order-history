#!/usr/bin/env python3
"""Local HTTP server with proper caching (ETag + 304 Not Modified).

Drop-in replacement for `python3 -m http.server` that adds:
  - ETag headers derived from file content (MD5 hash)
  - Cache-Control: no-cache (forces browser to revalidate every request)
  - 304 Not Modified responses when the file hasn't changed

Usage:
    python3 server.py [port] [--directory DIR]

Defaults to port 8080 and the current directory.
"""

import argparse
import hashlib
import os
import sys
from email.utils import formatdate
from http.server import HTTPServer, SimpleHTTPRequestHandler


class CachingHTTPRequestHandler(SimpleHTTPRequestHandler):
    """HTTPRequestHandler that supports ETag-based conditional requests."""

    def end_headers(self):
        """Add cache-control headers before sending."""
        # no-cache means "always revalidate with the server" — the browser
        # still stores the response but must check the ETag before using it.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):
        """Serve a GET/HEAD request with ETag support.

        If the client sends an If-None-Match header that matches the
        current ETag, return 304 Not Modified instead of the full body.
        """
        path = self.translate_path(self.path)

        if os.path.isdir(path):
            # For directories, fall back to default behaviour (index.html
            # listing) — no ETag support for directory listings.
            return super().send_head()

        try:
            f = open(path, "rb")  # noqa: SIM115
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            content = f.read()
            etag = _compute_etag(content)

            # Check If-None-Match
            client_etag = self.headers.get("If-None-Match")
            if client_etag and client_etag == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                f.close()
                return None

            # Full 200 response
            ctype = self.guess_type(path)
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("ETag", etag)
            self.send_header(
                "Last-Modified",
                self.date_time_string(os.fstat(f.fileno()).st_mtime),
            )
            self.end_headers()

            # Return a BytesIO so the caller can .read() from it
            import io

            return io.BytesIO(content)
        except Exception:
            f.close()
            raise


def _compute_etag(content: bytes) -> str:
    """Return a quoted ETag string from the MD5 hash of *content*."""
    digest = hashlib.md5(content).hexdigest()  # noqa: S324
    return f'"{digest}"'


def main(argv=None):
    parser = argparse.ArgumentParser(description="HTTP server with ETag caching")
    parser.add_argument("port", nargs="?", type=int, default=8080)
    parser.add_argument("--directory", "-d", default=os.getcwd())
    args = parser.parse_args(argv)

    os.chdir(args.directory)

    server = HTTPServer(("", args.port), CachingHTTPRequestHandler)
    print(f"Serving {args.directory} on http://localhost:{args.port} ...")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
