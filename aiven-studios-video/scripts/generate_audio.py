"""Synthesise the music bed and SFX for the AIVEN STUDIOS video.

Run: python3 scripts/generate_audio.py  (writes public/audio/*)
Music is locked to the video clock: 168 BPM (design system), one beat = 0.357 s.
Sections (beats): 0-8 build, 8 drop, 50-54 word hits, 54-60 black-hole breakdown,
60-70 final run, 70+ silence for the end card.
"""

import os
import wave

import numpy as np

SR = 44100
BEAT = 60 / 168
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


def riser(beats, top=7000, power=2):
    rt = t(beats * BEAT)
    x = rt / rt[-1]
    return onepole_lowpass(rng.standard_normal(len(rt)), 250 + top * x ** power) * x ** 2


def music():
    total_beats = 78
    hard_cut = 70  # end card: silent hold from here
    track = np.zeros(int(SR * total_beats * BEAT))
    roots = [55.0, 43.65, 65.41, 49.0]  # A, F, C, G (one bar each)

    def groove(b0, b1, bass=True, clap_every=2):
        for bt in range(b0, b1):
            at = bt * BEAT
            place(track, kick(), at, 0.95)
            place(track, hat(), at + BEAT / 2, 0.32)
            place(track, hat(), at + BEAT / 4, 0.12)
            place(track, hat(), at + 3 * BEAT / 4, 0.12)
            if bt % clap_every == 1:
                place(track, clap(), at, 0.5)
            if bass:
                root = roots[(bt // 4) % 4]
                for half in (0, 1):
                    nt = t(BEAT / 2)
                    duck = 1 - 0.85 * np.exp(-nt * 40) if half == 0 else np.ones_like(nt)
                    note = np.sin(2 * np.pi * root * nt) + 0.35 * np.sin(4 * np.pi * root * nt)
                    place(track, note * duck * np.exp(-nt * 4), at + half * BEAT / 2, 0.5)
        for bar in range(b0, b1, 4):
            root = roots[(bar // 4) % 4] * 4
            pt = t(4 * BEAT)
            pad = sum(np.sin(2 * np.pi * root * r * pt) for r in (1, 1.189, 1.498))
            place(track, pad * np.exp(-pt * 1.6) * 0.1, bar * BEAT)

    # 0-8 build: 40 Hz drone, ticking hats, snare roll and riser into the drop
    drone = np.sin(2 * np.pi * 40 * t(8 * BEAT)) * np.minimum(1, t(8 * BEAT) / 1.0) * 0.4
    place(track, drone, 0)
    for bt in range(8):
        place(track, hat(), bt * BEAT + BEAT / 2, 0.18)
    for i in range(16):  # 16th-note clap roll over beats 4-8, getting louder
        place(track, clap(), (4 + i / 4) * BEAT, 0.12 + 0.3 * i / 15)
    place(track, riser(4), 4 * BEAT, 0.5)

    groove(8, 50)
    for bt in (50, 51, 52, 53):  # word hits: kick + clap, no bass
        place(track, kick(), bt * BEAT, 1.0)
        place(track, clap(), bt * BEAT, 0.45)

    # 54-60 black hole: sub swell, reveal on 57, riser back in
    place(track, np.sin(2 * np.pi * 36 * t(6 * BEAT)) * np.minimum(1, t(6 * BEAT) / 0.6) * 0.45, 54 * BEAT)
    place(track, riser(2, top=5000), 58 * BEAT, 0.5)

    groove(60, 68)
    place(track, riser(2, top=9000, power=3), 68 * BEAT, 0.65)
    track[int(hard_cut * BEAT * SR):] = 0
    return np.tanh(track * 1.1)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_wav("whoosh.wav", whoosh())
    write_wav("impact.wav", impact())
    write_wav("click.wav", click())
    write_wav("keys.wav", keys())
    write_wav("music.wav", music())
    print("audio written to", os.path.abspath(OUT))
