"""Render the sanitized, localized Chrome Web Store screenshot set."""

from pathlib import Path
import subprocess
import sys
from urllib.parse import urlencode

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "store" / "screenshots-source.html"
OUT = ROOT / "store" / "screenshots"
CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main() -> None:
    if not CHROME.is_file():
        raise SystemExit(f"Chrome not found: {CHROME}")

    for lang, folder in (("zh", "zh-CN"), ("en", "en")):
        target = OUT / folder
        target.mkdir(parents=True, exist_ok=True)
        for step in range(1, 5):
            output = target / f"{step:02d}.png"
            url = SOURCE.as_uri() + "?" + urlencode({"lang": lang, "step": step})
            cmd = [
                str(CHROME),
                "--headless=new",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--window-size=1280,800",
                f"--screenshot={output}",
                url,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                raise RuntimeError(f"Chrome failed on {url}: {result.stderr}")
            with Image.open(output) as image:
                if image.size != (1280, 800):
                    raise RuntimeError(f"Wrong size for {output}: {image.size}")
            print(output)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(exc, file=sys.stderr)
        raise
