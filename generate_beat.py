"""Generate a cinematic upbeat beat for Reels — 110 BPM, motivational trailer energy"""
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter
import sys

SAMPLE_RATE = 44100
BPM = 110
DURATION = 25
beat_dur = 60 / BPM

def butter_filter(cutoff, btype='low', order=4):
    nyq = SAMPLE_RATE / 2
    b, a = butter(order, cutoff / nyq, btype=btype)
    return b, a

def lowpass(data, cutoff=2000):
    b, a = butter_filter(cutoff, 'low')
    return lfilter(b, a, data)

def highpass(data, cutoff=200):
    b, a = butter_filter(cutoff, 'high')
    return lfilter(b, a, data)

def bandpass(data, low=300, high=3000):
    return lowpass(highpass(data, low), high)

# ── Drums ──

def make_kick(length=0.45):
    """Deep cinematic kick with room"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    freq = 40 + 200 * np.exp(-t * 25)
    phase = np.cumsum(2 * np.pi * freq / SAMPLE_RATE)
    body = np.sin(phase) * np.exp(-t * 4)
    # Layered click
    click = np.sin(2 * np.pi * 3500 * t) * np.exp(-t * 120) * 0.3
    # Sub foundation
    sub = np.sin(2 * np.pi * 40 * t) * np.exp(-t * 2) * 0.5
    # Room reverb tail (noise burst)
    room = np.random.randn(len(t)) * np.exp(-t * 8) * 0.05
    return (body + click + sub + lowpass(room, 400)) * 0.8

def make_snare(length=0.3):
    """Cinematic snare with weight"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    noise = np.random.randn(len(t)) * np.exp(-t * 12)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 20) * 0.6
    crack = np.sin(2 * np.pi * 4000 * t) * np.exp(-t * 100) * 0.25
    # Body
    body = np.sin(2 * np.pi * 250 * t) * np.exp(-t * 30) * 0.3
    snare = noise * 0.5 + tone + crack + body
    return bandpass(snare, 100, 8000) * 0.6

def make_clap(length=0.2):
    """Big stadium clap"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    clap = np.zeros(len(t))
    for d in [0, 0.005, 0.01, 0.016, 0.022, 0.03]:
        s = int(d * SAMPLE_RATE)
        if s < len(t):
            burst = np.random.randn(len(t) - s) * np.exp(-np.linspace(0, 1, len(t) - s) * 18)
            clap[s:] += burst * 0.2
    # Room tail
    tail = np.random.randn(len(t)) * np.exp(-t * 6) * 0.08
    return (clap + lowpass(tail, 2000)) * 0.65

def make_hihat(length=0.04, open_hat=False):
    """Clean hi-hat"""
    if open_hat:
        length = 0.15
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    noise = np.random.randn(len(t))
    decay = 6 if open_hat else 55
    env = np.exp(-t * decay)
    hat = highpass(noise * env, 6000)
    ring = np.sin(2 * np.pi * 10000 * t) * env * 0.15
    return (hat + ring) * (0.3 if open_hat else 0.25)

def make_rim(length=0.08):
    """Tight rim shot"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    tone = np.sin(2 * np.pi * 900 * t) * np.exp(-t * 60)
    click = np.sin(2 * np.pi * 2500 * t) * np.exp(-t * 100) * 0.5
    return (tone + click) * 0.25

# ── Melodic ──

def make_pad(freqs, length=2.0):
    """Warm cinematic string pad with slow attack"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    pad = np.zeros(len(t))
    # Slow attack envelope
    attack = np.minimum(t / 0.4, 1.0)
    release = np.minimum((length - t) / 0.8, 1.0)
    env = attack * release

    for f in freqs:
        # Detuned pairs for width
        note1 = np.sin(2 * np.pi * f * t)
        note2 = np.sin(2 * np.pi * (f * 1.003) * t)  # slight detune
        # Harmonics for warmth
        h2 = np.sin(2 * np.pi * f * 2 * t) * 0.3
        h3 = np.sin(2 * np.pi * f * 3 * t) * 0.1
        pad += (note1 + note2) * 0.5 + h2 + h3

    pad *= env
    return lowpass(pad, 3000) * 0.12

def make_strings(freqs, length=1.5):
    """Sweeping orchestral strings"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    strings = np.zeros(len(t))
    attack = np.minimum(t / 0.3, 1.0)
    sustain = np.exp(-(t - 0.3).clip(0) * 0.5)
    env = attack * sustain

    for f in freqs:
        # Vibrato
        vib = np.sin(2 * np.pi * 5.5 * t) * 3  # 5.5Hz vibrato
        note = np.sin(2 * np.pi * (f + vib) * t)
        note += np.sin(2 * np.pi * (f * 2 + vib * 0.5) * t) * 0.4
        note += np.sin(2 * np.pi * (f * 3) * t) * 0.15
        strings += note

    strings *= env
    return lowpass(strings, 4000) * 0.1

def make_pluck(freq, length=0.5):
    """Bright pluck synth for melody"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    env = np.exp(-t * 5)
    sig = np.sin(2 * np.pi * freq * t) * env
    sig += np.sin(2 * np.pi * freq * 2 * t) * env * 0.5 * np.exp(-t * 8)
    sig += np.sin(2 * np.pi * freq * 3 * t) * env * 0.2 * np.exp(-t * 12)
    sig += np.sin(2 * np.pi * freq * 4 * t) * env * 0.1 * np.exp(-t * 15)
    return sig * 0.18

def make_bass(freq, length=0.6):
    """Clean sub bass"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    f = freq + 5 * np.exp(-t * 8)
    phase = np.cumsum(2 * np.pi * f / SAMPLE_RATE)
    sig = np.sin(phase) * np.exp(-t * 1.8)
    # Subtle harmonics
    sig += np.tanh(np.sin(phase * 2) * 1.5) * 0.1 * np.exp(-t * 2.5)
    return sig * 0.4

def make_riser(length=4.0):
    """Cinematic riser/sweep for transitions"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    freq = 200 + 4000 * (t / length) ** 2  # exponential sweep up
    phase = np.cumsum(2 * np.pi * freq / SAMPLE_RATE)
    sig = np.sin(phase) * 0.1
    noise = np.random.randn(len(t)) * (t / length) * 0.15
    sig += highpass(noise, 1000)
    env = (t / length) ** 2  # builds intensity
    return sig * env * 0.15

def make_impact(length=1.5):
    """Big cinematic impact/hit"""
    t = np.linspace(0, length, int(SAMPLE_RATE * length))
    # Low boom
    boom = np.sin(2 * np.pi * 30 * t) * np.exp(-t * 2) * 0.8
    # Noise burst
    crash = np.random.randn(len(t)) * np.exp(-t * 4) * 0.4
    # Reverse tail feel
    ring = np.sin(2 * np.pi * 150 * t) * np.exp(-t * 3) * 0.3
    return lowpass(boom + crash + ring, 5000) * 0.5

def place(track, sound, pos):
    end = min(pos + len(sound), len(track))
    n = end - pos
    if n > 0 and pos >= 0:
        track[pos:end] += sound[:n]

def generate_beat():
    total = int(SAMPLE_RATE * DURATION)
    drums = np.zeros(total)
    bass_track = np.zeros(total)
    pads = np.zeros(total)
    strings_track = np.zeros(total)
    melody_track = np.zeros(total)
    fx = np.zeros(total)

    bs = int(beat_dur * SAMPLE_RATE)
    hb = bs // 2
    qb = bs // 4

    # Key of D minor — cinematic/emotional
    # Chord progression: Dm - Bb - Gm - A (cinematic minor progression)
    bass_freqs = [73.4, 58.3, 49.0, 55.0]  # D2, Bb1, G1, A1
    pad_chords = [
        [293.7, 349.2, 440.0],       # Dm: D4, F4, A4
        [233.1, 293.7, 349.2],       # Bb: Bb3, D4, F4
        [196.0, 233.1, 293.7],       # Gm: G3, Bb3, D4
        [220.0, 277.2, 329.6],       # A: A3, C#4, E4
    ]
    string_chords = [
        [587.3, 698.5, 880.0],       # Dm high: D5, F5, A5
        [466.2, 587.3, 698.5],       # Bb high
        [392.0, 466.2, 587.3],       # Gm high
        [440.0, 554.4, 659.3],       # A high
    ]
    # Melody: emotional ascending line
    mel_notes = [
        [587.3, 523.3, 440.0, 587.3],   # D5, C5, A4, D5
        [698.5, 587.3, 523.3, 466.2],   # F5, D5, C5, Bb4
        [587.3, 523.3, 466.2, 392.0],   # D5, C5, Bb4, G4
        [440.0, 523.3, 587.3, 659.3],   # A4, C5, D5, E5 (resolve up)
    ]

    num_beats = int(DURATION / beat_dur)

    # Structure:
    # Bars 0-1 (0-8 beats): Ambient intro — pads only, riser building
    # Bars 2-3 (8-16 beats): Beat drops in, pads + light drums
    # Bars 4-7 (16-32 beats): Full energy — drums + bass + strings + melody
    # Bar 8-9 (32-36 beats): Peak energy, all elements
    # Last bar: Outro fade

    for i in range(num_beats):
        pos = i * bs
        bar = i // 4
        bib = i % 4
        ci = bar % 4
        section = 'intro' if bar < 2 else 'build' if bar < 4 else 'peak'

        # === PADS (always present) ===
        if bib == 0:
            pad_len = beat_dur * 3.8
            place(pads, make_pad(pad_chords[ci], pad_len), pos)

        # === STRINGS (from bar 2) ===
        if section in ('build', 'peak') and bib == 0:
            str_vol = 0.7 if section == 'build' else 1.0
            place(strings_track, make_strings(string_chords[ci], beat_dur * 3) * str_vol, pos)

        # === DRUMS ===
        if section == 'build':
            # Light drums: kick + clap, minimal hats
            if bib == 0:
                place(drums, make_kick() * 0.7, pos)
            if bib == 2:
                place(drums, make_kick() * 0.5, pos)
            if bib in [1, 3]:
                place(drums, make_clap() * 0.6, pos)
            # Sparse hats
            if bib % 2 == 0:
                place(drums, make_hihat() * 0.6, pos)
                place(drums, make_hihat() * 0.3, pos + hb)

        elif section == 'peak':
            # Full drums
            if bib == 0:
                place(drums, make_kick(), pos)
            elif bib == 2:
                place(drums, make_kick(), pos)
                if bar % 2 == 1:
                    place(drums, make_kick() * 0.4, pos + hb)  # ghost

            # Snare + clap layered on 2 and 4
            if bib in [1, 3]:
                place(drums, make_snare(), pos)
                place(drums, make_clap(), pos)

            # Driving hi-hats (16th note pattern)
            for q in range(4):
                qpos = pos + q * qb
                vel = [1.0, 0.4, 0.7, 0.35][q]
                place(drums, make_hihat() * vel, qpos)

            # Open hat accents
            if bib in [1, 3]:
                place(drums, make_hihat(open_hat=True), pos + hb + qb)

            # Rim on off-beats for groove
            if bib == 0 and bar % 2 == 0:
                place(drums, make_rim(), pos + hb)

        # === BASS (from bar 2) ===
        if section in ('build', 'peak'):
            bf = bass_freqs[ci]
            bass_vol = 0.6 if section == 'build' else 1.0
            if bib == 0:
                place(bass_track, make_bass(bf, beat_dur * 1.8) * bass_vol, pos)
            elif bib == 2 and section == 'peak':
                place(bass_track, make_bass(bf * 1.5, beat_dur * 0.6) * 0.5, pos + qb)

        # === MELODY (from bar 4, pluck synth) ===
        if section == 'peak':
            mn = mel_notes[ci]
            if bib == 0:
                place(melody_track, make_pluck(mn[0], beat_dur * 0.9), pos)
            elif bib == 1:
                place(melody_track, make_pluck(mn[1], beat_dur * 0.5), pos + qb)
            elif bib == 2:
                place(melody_track, make_pluck(mn[2], beat_dur * 0.7), pos)
            elif bib == 3 and bar % 2 == 0:
                place(melody_track, make_pluck(mn[3], beat_dur * 0.4), pos + hb)

    # === FX: Riser before the drop ===
    # Riser builds during bars 0-1, hits at bar 2
    riser_start = 0
    riser_len = int(beat_dur * 8)  # 8 beats = 2 bars
    riser = make_riser(beat_dur * 8)
    place(fx, riser, riser_start)

    # Impact at the drop (bar 2)
    drop_pos = int(beat_dur * 8 * SAMPLE_RATE)
    place(fx, make_impact(1.5), drop_pos)

    # Second riser before peak (bars 3-4)
    riser2_start = int(beat_dur * 12 * SAMPLE_RATE)
    place(fx, make_riser(beat_dur * 4) * 0.7, riser2_start)

    # Impact at peak (bar 4)
    peak_pos = int(beat_dur * 16 * SAMPLE_RATE)
    place(fx, make_impact(1.2) * 0.8, peak_pos)

    # === MIX ===
    track = (
        drums * 1.0 +
        bass_track * 1.1 +
        pads * 1.0 +
        strings_track * 0.85 +
        melody_track * 0.75 +
        fx * 0.6
    )

    # Fade in (gentle 0.5s)
    fi = int(SAMPLE_RATE * 0.5)
    track[:fi] *= np.linspace(0, 1, fi)

    # Fade out (2s)
    fo = int(SAMPLE_RATE * 2)
    track[-fo:] *= np.linspace(1, 0, fo)

    # Soft compression
    peak_val = np.max(np.abs(track))
    if peak_val > 0:
        track = track / peak_val
    threshold = 0.55
    above = np.abs(track) > threshold
    track[above] = np.sign(track[above]) * (threshold + (np.abs(track[above]) - threshold) * 0.4)

    # Final normalize
    track = track / np.max(np.abs(track)) * 0.92

    track_16 = (track * 32767).astype(np.int16)
    output = sys.argv[1] if len(sys.argv) > 1 else "tmp_videos/beat.wav"
    wavfile.write(output, SAMPLE_RATE, track_16)
    print(f"Beat: {output} ({DURATION}s, {BPM} BPM, cinematic upbeat)")

if __name__ == "__main__":
    generate_beat()
