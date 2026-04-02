"""Generate beats for AllFreeAlerts Reels — rotates between Pop, Rock, and Cinematic daily"""
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter
import sys, time

SAMPLE_RATE = 44100
DURATION = 25

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

def place(track, sound, pos):
    end = min(pos + len(sound), len(track))
    n = end - pos
    if n > 0 and pos >= 0:
        track[pos:end] += sound[:n]

def finalize(track):
    """Normalize, compress, fade in/out"""
    peak = np.max(np.abs(track))
    if peak > 0:
        track = track / peak
    threshold = 0.55
    above = np.abs(track) > threshold
    track[above] = np.sign(track[above]) * (threshold + (np.abs(track[above]) - threshold) * 0.4)
    track = track / np.max(np.abs(track)) * 0.92
    fi = int(SAMPLE_RATE * 0.5)
    fo = int(SAMPLE_RATE * 2)
    track[:fi] *= np.linspace(0, 1, fi)
    track[-fo:] *= np.linspace(1, 0, fo)
    return (track * 32767).astype(np.int16)


# ═══════════════════════════════════════════════
# CINEMATIC (110 BPM, D minor — epic, dramatic)
# ═══════════════════════════════════════════════
def generate_cinematic():
    BPM = 110
    bd = 60 / BPM
    bs = int(bd * SAMPLE_RATE)
    total = int(SAMPLE_RATE * DURATION)
    drums = np.zeros(total)
    bass_track = np.zeros(total)
    pads = np.zeros(total)
    strings_track = np.zeros(total)
    melody_track = np.zeros(total)
    fx = np.zeros(total)

    hb = bs // 2
    qb = bs // 4

    bass_freqs = [73.4, 58.3, 49.0, 55.0]
    pad_chords = [
        [293.7, 349.2, 440.0], [233.1, 293.7, 349.2],
        [196.0, 233.1, 293.7], [220.0, 277.2, 329.6],
    ]
    string_chords = [
        [587.3, 698.5, 880.0], [466.2, 587.3, 698.5],
        [392.0, 466.2, 587.3], [440.0, 554.4, 659.3],
    ]
    mel_notes = [
        [587.3, 523.3, 440.0, 587.3], [698.5, 587.3, 523.3, 466.2],
        [587.3, 523.3, 466.2, 392.0], [440.0, 523.3, 587.3, 659.3],
    ]

    num_beats = int(DURATION / bd)
    for i in range(num_beats):
        pos = i * bs
        bar = i // 4
        bib = i % 4
        ci = bar % 4
        section = 'intro' if bar < 2 else 'build' if bar < 4 else 'peak'

        # Pads
        if bib == 0:
            t = np.linspace(0, bd * 3.8, int(SAMPLE_RATE * bd * 3.8))
            pad = sum(np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * f * 1.003 * t) for f in pad_chords[ci])
            env = np.minimum(t / 0.4, 1.0) * np.minimum((bd * 3.8 - t) / 0.8, 1.0)
            place(pads, lowpass(pad * env, 3000) * 0.12, pos)

        # Strings
        if section in ('build', 'peak') and bib == 0:
            vol = 0.7 if section == 'build' else 1.0
            t = np.linspace(0, bd * 3, int(SAMPLE_RATE * bd * 3))
            s = np.zeros(len(t))
            env = np.minimum(t / 0.3, 1.0) * np.exp(-(t - 0.3).clip(0) * 0.5)
            for f in string_chords[ci]:
                vib = np.sin(2 * np.pi * 5.5 * t) * 3
                s += np.sin(2 * np.pi * (f + vib) * t) + np.sin(2 * np.pi * (f * 2 + vib * 0.5) * t) * 0.4
            place(strings_track, lowpass(s * env, 4000) * 0.1 * vol, pos)

        # Drums
        if section == 'build':
            if bib == 0:
                t = np.linspace(0, 0.45, int(SAMPLE_RATE * 0.45))
                kick = np.sin(np.cumsum(2 * np.pi * (40 + 200 * np.exp(-t * 25)) / SAMPLE_RATE)) * np.exp(-t * 4) * 0.56
                place(drums, kick, pos)
            if bib == 2:
                t = np.linspace(0, 0.45, int(SAMPLE_RATE * 0.45))
                kick = np.sin(np.cumsum(2 * np.pi * (40 + 200 * np.exp(-t * 25)) / SAMPLE_RATE)) * np.exp(-t * 4) * 0.4
                place(drums, kick, pos)
            if bib in [1, 3]:
                t = np.linspace(0, 0.2, int(SAMPLE_RATE * 0.2))
                clap = np.zeros(len(t))
                for d in [0, 0.005, 0.01, 0.016, 0.022, 0.03]:
                    st = int(d * SAMPLE_RATE)
                    if st < len(t):
                        clap[st:] += np.random.randn(len(t) - st) * np.exp(-np.linspace(0, 1, len(t) - st) * 18) * 0.2
                place(drums, clap * 0.39, pos)
            if bib % 2 == 0:
                t = np.linspace(0, 0.04, int(SAMPLE_RATE * 0.04))
                hat = highpass(np.random.randn(len(t)) * np.exp(-t * 55), 6000) * 0.15
                place(drums, hat, pos)
                place(drums, hat * 0.5, pos + hb)

        elif section == 'peak':
            if bib in [0, 2]:
                t = np.linspace(0, 0.45, int(SAMPLE_RATE * 0.45))
                kick = np.sin(np.cumsum(2 * np.pi * (40 + 200 * np.exp(-t * 25)) / SAMPLE_RATE)) * np.exp(-t * 4) * 0.8
                click = np.sin(2 * np.pi * 3500 * t) * np.exp(-t * 120) * 0.24
                sub = np.sin(2 * np.pi * 40 * t) * np.exp(-t * 2) * 0.4
                place(drums, kick + click + sub, pos)
            if bib in [1, 3]:
                t = np.linspace(0, 0.3, int(SAMPLE_RATE * 0.3))
                snare = np.random.randn(len(t)) * np.exp(-t * 12) * 0.3 + np.sin(2 * np.pi * 185 * t) * np.exp(-t * 20) * 0.36
                clap = np.zeros(len(t))
                for d in [0, 0.005, 0.01, 0.016, 0.022, 0.03]:
                    st = int(d * SAMPLE_RATE)
                    if st < len(t):
                        clap[st:] += np.random.randn(len(t) - st) * np.exp(-np.linspace(0, 1, len(t) - st) * 18) * 0.2
                place(drums, snare + clap * 0.65, pos)
            for q in range(4):
                t = np.linspace(0, 0.04, int(SAMPLE_RATE * 0.04))
                vel = [1.0, 0.4, 0.7, 0.35][q]
                hat = highpass(np.random.randn(len(t)) * np.exp(-t * 55), 6000) * 0.25 * vel
                place(drums, hat, pos + q * qb)

        # Bass
        if section in ('build', 'peak') and bib == 0:
            bf = bass_freqs[ci]
            vol = 0.6 if section == 'build' else 1.0
            t = np.linspace(0, bd * 1.8, int(SAMPLE_RATE * bd * 1.8))
            f = bf + 5 * np.exp(-t * 8)
            bass = np.sin(np.cumsum(2 * np.pi * f / SAMPLE_RATE)) * np.exp(-t * 1.8) * 0.4 * vol
            place(bass_track, bass, pos)

        # Melody
        if section == 'peak':
            mn = mel_notes[ci]
            def pluck(freq, length=0.5):
                t = np.linspace(0, length, int(SAMPLE_RATE * length))
                env = np.exp(-t * 5)
                return (np.sin(2 * np.pi * freq * t) * env +
                        np.sin(2 * np.pi * freq * 2 * t) * env * 0.5 * np.exp(-t * 8) +
                        np.sin(2 * np.pi * freq * 3 * t) * env * 0.2 * np.exp(-t * 12)) * 0.18
            if bib == 0: place(melody_track, pluck(mn[0], bd * 0.9), pos)
            elif bib == 1: place(melody_track, pluck(mn[1], bd * 0.5), pos + qb)
            elif bib == 2: place(melody_track, pluck(mn[2], bd * 0.7), pos)
            elif bib == 3 and bar % 2 == 0: place(melody_track, pluck(mn[3], bd * 0.4), pos + hb)

    # FX: Risers and impacts
    riser_len = int(bd * 8 * SAMPLE_RATE)
    t = np.linspace(0, bd * 8, riser_len)
    freq = 200 + 4000 * (t / (bd * 8)) ** 2
    riser = np.sin(np.cumsum(2 * np.pi * freq / SAMPLE_RATE)) * 0.1 * (t / (bd * 8)) ** 2 * 0.15
    place(fx, riser, 0)

    drop = int(bd * 8 * SAMPLE_RATE)
    t = np.linspace(0, 1.5, int(SAMPLE_RATE * 1.5))
    impact = (np.sin(2 * np.pi * 30 * t) * np.exp(-t * 2) * 0.8 +
              np.random.randn(len(t)) * np.exp(-t * 4) * 0.4) * 0.5
    place(fx, lowpass(impact, 5000), drop)

    track = drums * 1.0 + bass_track * 1.1 + pads * 1.0 + strings_track * 0.85 + melody_track * 0.75 + fx * 0.6
    return finalize(track)


# ═══════════════════════════════════════════════
# POP (120 BPM — bright, catchy, upbeat)
# ═══════════════════════════════════════════════
def generate_pop():
    BPM = 120
    bd = 60 / BPM
    bs = int(bd * SAMPLE_RATE)
    total = int(SAMPLE_RATE * DURATION)
    track = np.zeros(total)

    num_beats = int(DURATION / bd)
    for i in range(num_beats):
        pos = i * bs
        bar = i // 4
        bib = i % 4
        ci = bar % 4
        section = 'intro' if bar < 2 else 'build' if bar < 4 else 'peak'

        # Four-on-the-floor kick
        if section != 'intro':
            t = np.linspace(0, 0.25, int(SAMPLE_RATE * 0.25))
            kick = np.sin(np.cumsum(2 * np.pi * (50 + 250 * np.exp(-t * 35)) / SAMPLE_RATE)) * np.exp(-t * 5) * 0.7
            click = np.sin(2 * np.pi * 4000 * t) * np.exp(-t * 150) * 0.2
            place(track, kick + click, pos)

        # Clap on 2 and 4
        if bib in [1, 3] and section != 'intro':
            t = np.linspace(0, 0.12, int(SAMPLE_RATE * 0.12))
            clap = np.zeros(len(t))
            for d in [0, 0.003, 0.007, 0.012]:
                st = int(d * SAMPLE_RATE)
                if st < len(t):
                    clap[st:] += np.random.randn(len(t) - st) * np.exp(-np.linspace(0, 1, len(t) - st) * 25) * 0.25
            place(track, clap, pos)

        # Bright hats
        if section != 'intro':
            for h in range(2):
                t = np.linspace(0, 0.025, int(SAMPLE_RATE * 0.025))
                hat = highpass(np.random.randn(len(t)) * np.exp(-t * 65), 8000) * [0.22, 0.1][h]
                place(track, hat, pos + h * (bs // 2))
            # Peak: add 16th hats
            if section == 'peak':
                for q in range(4):
                    t = np.linspace(0, 0.02, int(SAMPLE_RATE * 0.02))
                    hat = highpass(np.random.randn(len(t)) * np.exp(-t * 70), 8000) * [0.18, 0.06, 0.12, 0.05][q]
                    place(track, hat, pos + q * (bs // 4))

        # Pop synth chords (C → G → Am → F)
        if bib == 0:
            chords = [
                [523.3, 659.3, 784.0], [392.0, 493.9, 587.3],
                [440.0, 523.3, 659.3], [349.2, 440.0, 523.3],
            ]
            t = np.linspace(0, bd * 3.5, int(SAMPLE_RATE * bd * 3.5))
            synth = np.zeros(len(t))
            for f in chords[ci]:
                synth += np.sin(2 * np.pi * f * t)
                synth += np.sin(2 * np.pi * f * 2 * t) * 0.2
                synth += np.sign(np.sin(2 * np.pi * f * t + 0.3)) * 0.08
            env = np.minimum(t / 0.02, 1.0) * np.exp(-t * 0.6)
            vol = 0.04 if section == 'intro' else 0.06
            place(track, lowpass(synth * env, 5000) * vol, pos)

        # Bouncy bass
        if bib in [0, 2] and section != 'intro':
            bf = [130.8, 98.0, 110.0, 87.3][ci]
            t = np.linspace(0, bd * 0.7, int(SAMPLE_RATE * bd * 0.7))
            bass = np.sin(2 * np.pi * bf * t) * np.exp(-t * 4) * 0.35
            bass += np.sin(2 * np.pi * bf * 2 * t) * np.exp(-t * 6) * 0.1
            place(track, bass, pos)

        # Pluck melody in peak
        if section == 'peak' and bib in [0, 2]:
            mel = [784.0, 698.5, 659.3, 587.3][ci]
            t = np.linspace(0, bd * 0.6, int(SAMPLE_RATE * bd * 0.6))
            plk = np.sin(2 * np.pi * mel * t) * np.exp(-t * 6) * 0.12
            plk += np.sin(2 * np.pi * mel * 2 * t) * np.exp(-t * 10) * 0.05
            place(track, plk, pos)

    return finalize(track)


# ═══════════════════════════════════════════════
# ROCK (135 BPM — driving, power chords, energy)
# ═══════════════════════════════════════════════
def generate_rock():
    BPM = 135
    bd = 60 / BPM
    bs = int(bd * SAMPLE_RATE)
    total = int(SAMPLE_RATE * DURATION)
    track = np.zeros(total)

    num_beats = int(DURATION / bd)
    for i in range(num_beats):
        pos = i * bs
        bar = i // 4
        bib = i % 4
        ci = bar % 4
        section = 'intro' if bar < 2 else 'build' if bar < 4 else 'peak'

        # Hard kick
        if bib in [0, 2]:
            t = np.linspace(0, 0.2, int(SAMPLE_RATE * 0.2))
            kick = np.sin(np.cumsum(2 * np.pi * (55 + 300 * np.exp(-t * 40)) / SAMPLE_RATE)) * np.exp(-t * 6) * 0.8
            if section != 'intro':
                place(track, kick, pos)
        # Double kick fills
        if section == 'peak' and bib == 3 and bar % 2 == 1:
            t = np.linspace(0, 0.15, int(SAMPLE_RATE * 0.15))
            kick = np.sin(np.cumsum(2 * np.pi * (55 + 250 * np.exp(-t * 40)) / SAMPLE_RATE)) * np.exp(-t * 7) * 0.6
            place(track, kick, pos)
            place(track, kick * 0.5, pos + bs // 2)

        # Heavy snare
        if bib in [1, 3] and section != 'intro':
            t = np.linspace(0, 0.25, int(SAMPLE_RATE * 0.25))
            snare = np.random.randn(len(t)) * np.exp(-t * 10) * 0.5
            snare += np.sin(2 * np.pi * 200 * t) * np.exp(-t * 18) * 0.4
            snare += np.sin(2 * np.pi * 350 * t) * np.exp(-t * 12) * 0.15
            place(track, snare, pos)

        # Crash on bar transitions
        if bib == 0 and i % 16 == 0 and section != 'intro':
            t = np.linspace(0, 1.5, int(SAMPLE_RATE * 1.5))
            crash = highpass(np.random.randn(len(t)) * np.exp(-t * 2), 3000) * 0.25
            place(track, crash, pos)

        # Ride cymbal
        if section != 'intro':
            for h in range(2):
                t = np.linspace(0, 0.08, int(SAMPLE_RATE * 0.08))
                ride = highpass(np.random.randn(len(t)) * np.exp(-t * 25), 4000) * [0.18, 0.1][h]
                ride += np.sin(2 * np.pi * 6000 * t) * np.exp(-t * 40) * 0.05
                place(track, ride, pos + h * (bs // 2))

        # Distorted power chords (E5 → A5 → D5 → G5)
        roots = [82.4, 110.0, 73.4, 98.0]
        r = roots[ci]
        if bib == 0:
            t = np.linspace(0, bd * 3.5, int(SAMPLE_RATE * bd * 3.5))
            guitar = np.sin(2 * np.pi * r * t) + np.sin(2 * np.pi * r * 1.5 * t) * 0.8
            guitar += np.sin(2 * np.pi * r * 2 * t) * 0.5 + np.sin(2 * np.pi * r * 3 * t) * 0.25
            guitar = np.tanh(guitar * 3) * 0.3
            env = np.minimum(t / 0.005, 1.0) * np.exp(-t * 0.4)
            vol = 0.12 if section == 'intro' else 0.2
            place(track, lowpass(guitar * env, 4000) * vol, pos)

        # Rock bass
        if bib in [0, 2] and section != 'intro':
            bf = roots[ci]
            t = np.linspace(0, bd * 0.9, int(SAMPLE_RATE * bd * 0.9))
            bass = np.tanh(np.sin(2 * np.pi * bf * t) * 1.5) * np.exp(-t * 2.5) * 0.3
            place(track, bass, pos)

        # Lead riff in peak
        if section == 'peak' and bib == 0:
            mel = [329.6, 440.0, 293.7, 392.0][ci]
            t = np.linspace(0, bd * 0.8, int(SAMPLE_RATE * bd * 0.8))
            lead = np.tanh(np.sin(2 * np.pi * mel * t) * 2) * np.exp(-t * 3) * 0.1
            lead += np.sin(2 * np.pi * mel * 2 * t) * np.exp(-t * 5) * 0.04
            place(track, lead, pos)

    return finalize(track)


# ═══════════════════════════════════════════════
# MAIN — select style by day or argument
# ═══════════════════════════════════════════════
STYLES = ['cinematic', 'pop', 'rock']

def get_today_style():
    day = int(time.time() // 86400)
    return STYLES[day % len(STYLES)]

if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else "tmp_videos/beat.wav"
    # Allow explicit style: python generate_beat.py output.wav rock
    style = sys.argv[2] if len(sys.argv) > 2 else get_today_style()

    generators = {
        'cinematic': generate_cinematic,
        'pop': generate_pop,
        'rock': generate_rock,
    }

    if style not in generators:
        print(f"Unknown style: {style}. Available: {', '.join(STYLES)}")
        sys.exit(1)

    print(f"Beat style: {style} (rotates daily: {', '.join(STYLES)})")
    track = generators[style]()
    wavfile.write(output, SAMPLE_RATE, track)
    print(f"Beat: {output} ({DURATION}s, {style})")
