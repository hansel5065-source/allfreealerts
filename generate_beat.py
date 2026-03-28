"""Generate a TikTok-trending upbeat motivational beat"""
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter
import sys

SAMPLE_RATE = 44100
BPM = 100
DURATION = 20
beat_dur = 60 / BPM

def butter_lowpass(cutoff, order=4):
    nyq = SAMPLE_RATE / 2
    b, a = butter(order, cutoff / nyq, btype='low')
    return b, a

def lowpass(data, cutoff=2000):
    b, a = butter_lowpass(cutoff)
    return lfilter(b, a, data)

def make_kick(length=0.4):
    """Hard-hitting 808 kick with sub"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    # Pitch drops: 300Hz -> 35Hz
    freq = 35 + 265 * np.exp(-t * 20)
    phase = np.cumsum(2 * np.pi * freq / SAMPLE_RATE)
    body = np.sin(phase) * np.exp(-t * 3)
    # Punchy click
    click = np.sin(2 * np.pi * 2500 * t) * np.exp(-t * 100) * 0.5
    # Sub tail
    sub = np.sin(2 * np.pi * 35 * t) * np.exp(-t * 2.5) * 0.4
    kick = body + click + sub
    return kick * 0.85

def make_snare(length=0.25):
    """Modern crispy snare"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    # Noise body
    noise = np.random.randn(len(t))
    noise_env = np.exp(-t * 15)
    # Tone body
    tone = np.sin(2 * np.pi * 200 * t) * np.exp(-t * 25)
    # High freq snap
    snap = np.sin(2 * np.pi * 3000 * t) * np.exp(-t * 80) * 0.3
    snare = noise * noise_env * 0.5 + tone * 0.5 + snap
    return snare * 0.65

def make_clap(length=0.18):
    """Thick layered clap"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    clap = np.zeros(len(t))
    # Multiple micro-bursts for realism
    for d in [0, 0.006, 0.012, 0.018, 0.025]:
        s = int(d * SAMPLE_RATE)
        if s < len(t):
            burst_len = len(t) - s
            burst = np.random.randn(burst_len) * np.exp(-np.linspace(0, 1, burst_len) * 20)
            clap[s:] += burst * 0.25
    # Add some body tone
    clap += np.sin(2 * np.pi * 800 * t) * np.exp(-t * 30) * 0.15
    return clap * 0.7

def make_hihat(length=0.035, open_hat=False):
    """Crispy hi-hat"""
    if open_hat:
        length = 0.12
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    noise = np.random.randn(len(t))
    decay = 8 if open_hat else 50
    env = np.exp(-t * decay)
    # Band-pass feel
    hat = noise * env
    hat = lowpass(hat, 12000)
    # Add metallic ring
    ring = np.sin(2 * np.pi * 9500 * t) * env * 0.2
    hat = hat + ring
    return hat * (0.35 if open_hat else 0.3)

def make_perc(length=0.1):
    """Percussion hit (rim shot / wood block feel)"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    tone = np.sin(2 * np.pi * 800 * t) * np.exp(-t * 40)
    tone += np.sin(2 * np.pi * 1200 * t) * np.exp(-t * 50) * 0.5
    noise = np.random.randn(len(t)) * np.exp(-t * 60) * 0.2
    return (tone + noise) * 0.3

def make_808bass(freq, length=0.6):
    """Warm 808 bass with harmonics"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    f = freq + 8 * np.exp(-t * 10)
    phase = np.cumsum(2 * np.pi * f / SAMPLE_RATE)
    sig = np.sin(phase) * np.exp(-t * 1.5)
    # Warm saturation via soft clipping
    sig += np.tanh(np.sin(phase * 2) * 2) * 0.12 * np.exp(-t * 2)
    sig += np.sin(phase * 3) * 0.06 * np.exp(-t * 3)
    return sig * 0.45

def make_keys(freqs, length=0.5):
    """Soft piano/keys chord"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    chord = np.zeros(len(t))
    for f in freqs:
        # Each note with harmonics
        note = np.sin(2 * np.pi * f * t) * 0.3
        note += np.sin(2 * np.pi * f * 2 * t) * 0.15 * np.exp(-t * 3)
        note += np.sin(2 * np.pi * f * 3 * t) * 0.05 * np.exp(-t * 5)
        chord += note
    chord *= np.exp(-t * 2.5)
    return chord * 0.2

def make_bell(freq, length=0.4):
    """Sparkly bell/chime melody"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    sig = np.sin(2 * np.pi * freq * t) * np.exp(-t * 4)
    sig += np.sin(2 * np.pi * freq * 2.0 * t) * 0.4 * np.exp(-t * 6)
    sig += np.sin(2 * np.pi * freq * 3.0 * t) * 0.15 * np.exp(-t * 8)
    sig += np.sin(2 * np.pi * freq * 5.0 * t) * 0.08 * np.exp(-t * 12)
    return sig * 0.2

def place(track, sound, pos):
    end = min(pos + len(sound), len(track))
    n = end - pos
    if n > 0 and pos >= 0:
        track[pos:end] += sound[:n]

def generate_beat():
    total = int(SAMPLE_RATE * DURATION)
    drums = np.zeros(total)
    bass = np.zeros(total)
    harmony = np.zeros(total)
    melody = np.zeros(total)

    bs = int(beat_dur * SAMPLE_RATE)  # beat samples
    hb = bs // 2  # half beat
    qb = bs // 4  # quarter beat
    tb = bs // 3  # triplet

    # Chord progression: Dm - Bb - F - C (pop/motivational feel)
    bass_freqs = [73.4, 58.3, 87.3, 65.4]  # D2, Bb1, F2, C2
    chord_freqs = [
        [293.7, 349.2, 440.0],   # Dm: D4, F4, A4
        [233.1, 293.7, 349.2],   # Bb: Bb3, D4, F4
        [349.2, 440.0, 523.3],   # F: F4, A4, C5
        [261.6, 329.6, 392.0],   # C: C4, E4, G4
    ]
    mel_notes = [
        [587.3, 523.3, 440.0, 523.3],  # Dm melody
        [466.2, 440.0, 349.2, 440.0],  # Bb melody
        [523.3, 587.3, 698.5, 587.3],  # F melody
        [523.3, 392.0, 440.0, 523.3],  # C melody
    ]

    num_beats = int(DURATION / beat_dur)

    for i in range(num_beats):
        pos = i * bs
        bar = i // 4
        bib = i % 4  # beat in bar
        ci = bar % 4  # chord index

        # === DRUMS ===
        # Kick pattern: boom-bap with variation
        if bib == 0:
            place(drums, make_kick(), pos)
        elif bib == 1 and bar % 2 == 1:
            place(drums, make_kick() * 0.5, pos + hb)  # ghost kick
        elif bib == 2:
            place(drums, make_kick(), pos)
        elif bib == 3 and bar % 4 == 3:
            place(drums, make_kick() * 0.6, pos + hb)  # fill kick

        # Snare + Clap on 2 and 4
        if bib in [1, 3]:
            place(drums, make_snare(), pos)
            place(drums, make_clap(), pos)

        # Hi-hats: bouncy pattern
        for q in range(4):
            qpos = pos + q * qb
            if q == 0:
                place(drums, make_hihat() * 1.0, qpos)
            elif q == 1:
                place(drums, make_hihat() * 0.4, qpos)
            elif q == 2:
                place(drums, make_hihat() * 0.7, qpos)
            elif q == 3:
                place(drums, make_hihat() * 0.3, qpos)

        # Open hat on off-beats for groove
        if bib in [1, 3]:
            place(drums, make_hihat(open_hat=True), pos + hb + qb)

        # Extra percussion hits
        if bib == 0 and bar % 2 == 0:
            place(drums, make_perc(), pos + hb)
        if bib == 3:
            place(drums, make_perc() * 0.6, pos + qb * 3)

        # === BASS ===
        bf = bass_freqs[ci]
        if bib == 0:
            place(bass, make_808bass(bf, beat_dur * 1.8), pos)
        elif bib == 2:
            place(bass, make_808bass(bf * 1.5, beat_dur * 0.7) * 0.6, pos + qb)

        # === HARMONY (keys/chords) ===
        cf = chord_freqs[ci]
        if bib == 0:
            place(harmony, make_keys(cf, beat_dur * 3.5), pos)

        # === MELODY (bell/chime) ===
        mn = mel_notes[ci]
        if bar >= 1:  # melody comes in after first bar
            if bib == 0:
                place(melody, make_bell(mn[0], beat_dur * 0.8), pos)
            elif bib == 1 and bar % 2 == 0:
                place(melody, make_bell(mn[1], beat_dur * 0.5), pos + qb)
            elif bib == 2:
                place(melody, make_bell(mn[2], beat_dur * 0.6), pos)
            elif bib == 3 and bar % 2 == 1:
                place(melody, make_bell(mn[3], beat_dur * 0.4), pos + hb)

    # === MIX ===
    track = drums * 1.1 + bass * 1.0 + harmony * 0.9 + melody * 0.85

    # Fade in/out
    fi = int(SAMPLE_RATE * 1)
    fo = int(SAMPLE_RATE * 2)
    track[:fi] *= np.linspace(0, 1, fi)
    track[-fo:] *= np.linspace(1, 0, fo)

    # Soft compression
    peak = np.max(np.abs(track))
    if peak > 0:
        track = track / peak
    threshold = 0.6
    above = np.abs(track) > threshold
    track[above] = np.sign(track[above]) * (threshold + (np.abs(track[above]) - threshold) * 0.5)

    # Final normalize
    track = track / np.max(np.abs(track)) * 0.9

    track_16 = (track * 32767).astype(np.int16)
    output = sys.argv[1] if len(sys.argv) > 1 else "tmp_videos/beat.wav"
    wavfile.write(output, SAMPLE_RATE, track_16)
    print(f"Beat: {output} ({DURATION}s, {BPM} BPM, motivational pop/trap)")

if __name__ == "__main__":
    generate_beat()
