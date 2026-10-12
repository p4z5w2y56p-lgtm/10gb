"""Synthesise the SFX for the AIVEN STUDIOS video (whoosh, impact, click, keys).

Run: python3 scripts/generate_audio.py  (writes public/audio/*.wav)
The soundtrack is a licensed track, prepared by scripts/prepare_music.sh.
"""

import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audio")
rng = np.random.default_rng(7)


def t(seconds):
    return np.arange(int(SR * seconds)) / SR


def onepole_lowpass(x, cutoff):
    """Time-varying one-pole lowpass; cutoff may be an array (Hz)."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    prev = 0.0
    for i in range(len(x)):
        prev = (1 - a[i]) * x[i] + a[i] * prev
        y[i] = prev
    return y


def write_wav(name, data, stereo=False):
    data = data / (np.max(np.abs(data)) + 1e-9) * 0.89
    pcm = (data * 32767).astype(np.int16)
    if not stereo:
        pcm = np.stack([pcm, pcm], axis=1)
    with wave.open(os.path.join(OUT, name), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())


# ---------- SFX ----------

def whoosh():
    d = 0.55
    tt = t(d)
    env = np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 2
    cutoff = 300 + 5000 * np.sin(np.pi * tt / d)
    noise = rng.standard_normal(len(tt))
    return onepole_lowpass(noise, cutoff) * env


def impact():
    d = 1.6
    tt = t(d)
    freq = 38 + 80 * np.exp(-tt * 9)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-tt * 2.6)
    click = onepole_lowpass(rng.standard_normal(len(tt)), 1800) * np.exp(-tt * 60)
    return np.tanh(1.8 * (body + 0.6 * click))


def click():
    tt = t(0.06)
    noise = np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 400)
    blip = np.sin(2 * np.pi * 2300 * tt) * np.exp(-tt * 250)
    return noise * 0.6 + blip * 0.5


def keys():
    out = np.zeros(int(SR * 0.7))
    pos = 0
    while pos < len(out) - 3000:
        k = click()
        k = k * rng.uniform(0.5, 1.0)
        out[pos:pos + len(k)] += k
        pos += int(SR * rng.uniform(0.06, 0.12))
    return out


# ---------- Music ----------

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_wav("whoosh.wav", whoosh())
    write_wav("impact.wav", impact())
    write_wav("click.wav", click())
    write_wav("keys.wav", keys())
    print("audio written to", os.path.abspath(OUT))
