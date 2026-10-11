"""Synthesise the music bed and SFX for the AIVEN STUDIOS video.

Run: python3 scripts/generate_audio.py  (writes public/audio/*)
Music is locked to the video clock: 120 BPM, one beat = 0.5 s = 30 frames at 60fps.
"""

import os
import wave

import numpy as np

SR = 44100
BEAT = 0.5
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

def kick():
    tt = t(0.45)
    freq = 45 + 110 * np.exp(-tt * 28)
    return np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-tt * 7)


def hat():
    tt = t(0.05)
    return np.diff(rng.standard_normal(len(tt) + 1)) * np.exp(-tt * 90)


def clap():
    tt = t(0.25)
    burst = onepole_lowpass(rng.standard_normal(len(tt)), 3000)
    env = np.exp(-tt * 18)
    for offset in (0.0, 0.012, 0.024):
        env = env + np.where((tt >= offset) & (tt < offset + 0.008), 1.0, 0.0)
    return burst * env * 0.5


def place(track, sound, at, gain=1.0):
    start = int(at * SR)
    end = min(len(track), start + len(sound))
    if start < len(track):
        track[start:end] += sound[: end - start] * gain


def music():
    total_beats = 68
    hard_cut = 66  # outro hard cut to logo: silence from here
    track = np.zeros(int(SR * total_beats * BEAT))
    roots = [55.0, 43.65, 65.41, 49.0]  # A, F, C, G (one bar each)

    # Intro: 40 Hz drone for weight, quiet ticks, riser into the drop on beat 8
    tt = t(8 * BEAT)
    drone = np.sin(2 * np.pi * 40 * tt) * np.minimum(1, tt / 1.5) * 0.35
    place(track, drone, 0)
    for b in range(8):
        place(track, hat(), b * BEAT + BEAT / 2, 0.15)
    rt = t(2 * BEAT)
    riser = onepole_lowpass(rng.standard_normal(len(rt)), 200 + 6000 * (rt / rt[-1]) ** 2) * (rt / rt[-1]) ** 2
    place(track, riser, 6 * BEAT, 0.5)

    # Drop: beats 8..hard_cut
    for b in range(8, hard_cut):
        at = b * BEAT
        place(track, kick(), at, 0.9)
        place(track, hat(), at + BEAT / 2, 0.3)
        if b >= 52 and b % 2 == 1:
            place(track, clap(), at, 0.5)
        bar = (b // 4) % 4
        for half in (0, 1):
            nt = t(BEAT / 2)
            duck = 1 - 0.85 * np.exp(-nt * 30) if half == 0 else np.ones_like(nt)
            note = np.sin(2 * np.pi * roots[bar] * nt) + 0.3 * np.sin(4 * np.pi * roots[bar] * nt)
            place(track, note * duck * np.exp(-nt * 3), at + half * BEAT / 2, 0.45)

    # Pad stabs on every bar, a minor-ish voicing two octaves up
    for bar_start in range(8, hard_cut, 4):
        root = roots[(bar_start // 4) % 4] * 4
        pt = t(4 * BEAT)
        pad = sum(np.sin(2 * np.pi * root * r * pt) for r in (1, 1.189, 1.498))
        place(track, pad * np.exp(-pt * 1.4) * 0.12, bar_start * BEAT)

    # Riser cutting into silence at the hard cut
    rt = t(3 * BEAT)
    riser = onepole_lowpass(rng.standard_normal(len(rt)), 300 + 8000 * (rt / rt[-1]) ** 3) * (rt / rt[-1]) ** 2
    place(track, riser, (hard_cut - 3) * BEAT, 0.6)
    track[int(hard_cut * BEAT * SR):] = 0
    return np.tanh(track * 1.2)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_wav("whoosh.wav", whoosh())
    write_wav("impact.wav", impact())
    write_wav("click.wav", click())
    write_wav("keys.wav", keys())
    write_wav("music.wav", music())
    print("audio written to", os.path.abspath(OUT))
