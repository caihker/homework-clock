"""Build the fixed Mandarin turtle clips. Requires edge-tts and ffmpeg.

Only the public, fixed lines from voice-pack.mjs are sent for synthesis.
No student plans, custom family text, recordings, or keys are used.
The website plays the resulting MP3 files without a TTS service dependency.
"""
import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
VOICE = "zh-CN-YunxiNeural"
PROFILES = {
    "start": ("+6%", "+12Hz"),
    "break-start": ("-2%", "+8Hz"),
    "break-end": ("+3%", "+10Hz"),
    "complete": ("+10%", "+18Hz"),
    "end": ("+0%", "+8Hz"),
    "ending-soon": ("-2%", "+8Hz"),
    "schedule-start": ("+4%", "+10Hz"),
}


async def main():
    lines = json.loads(subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import {TURTLE_LINES} from './dist/voice-pack.mjs'; console.log(JSON.stringify(TURTLE_LINES));",
    ], cwd=ROOT, text=True))
    semaphore = asyncio.Semaphore(2)
    metadata = {"voice": VOICE, "tool": "edge-tts", "runtime": "static-mp3", "clips": {}}
    with tempfile.TemporaryDirectory(prefix="homework-voice-") as raw_dir:
        async def render(event, line):
            rate, pitch = PROFILES[event]
            raw = Path(raw_dir) / f"{event}.mp3"
            output = ROOT / "dist" / line["src"].removeprefix("./")
            output.parent.mkdir(parents=True, exist_ok=True)
            async with semaphore:
                await edge_tts.Communicate(line["text"], VOICE, rate=rate, pitch=pitch).save(str(raw))
                subprocess.run([
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw),
                    "-af", "loudnorm=I=-18:TP=-2:LRA=7,afade=t=in:d=0.015",
                    "-ar", "24000", "-ac", "1", "-b:a", "64k", str(output),
                ], check=True)
                duration = float(subprocess.check_output([
                    "ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1", str(output),
                ], text=True))
                metadata["clips"][event] = {"text": line["text"], "rate": rate, "pitch": pitch,
                                            "duration": duration, "bytes": output.stat().st_size}
                print(f"{event}: {duration:.2f}s", flush=True)

        await asyncio.gather(*(render(event, line) for event, line in lines.items()))
    destination = ROOT / "dist/assets/voice-pack-v1/metadata.json"
    destination.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
