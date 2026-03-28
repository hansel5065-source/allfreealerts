/**
 * AllFreeAlerts — TikTok Video Generator
 * Converts branded images into short videos with voiceover + music
 *
 * Usage: node generate_tiktok_video.js [input.json or JSON string]
 * Output: MP4 videos in tmp_videos/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TMP_DIR = path.join(__dirname, 'tmp_videos');
const IMG_DIR = path.join(__dirname, 'tmp_images');

// Voice scripts per category — conversational TikTok style
function getVoiceScript(post) {
  const title = post.title || '';

  if (post.category === 'Sweepstakes') {
    return `Guys, check this out! ${title}. This is completely free to enter. Head to allfreealerts.com to find it. Link in bio!`;
  }

  if (post.category === 'Freebies') {
    return `Free stuff alert! ${title}. No purchase necessary, no credit card needed. Go to allfreealerts.com before it's gone!`;
  }

  if (post.category === 'Settlements') {
    const payout = post.payout ? `You could get up to ${post.payout}.` : 'You could be owed money.';
    const proof = post.proofStatus === 'NO PROOF NEEDED' ? 'And the best part? No proof of purchase needed!' : '';
    return `Stop scrolling! ${title}. ${payout} ${proof} File your claim at allfreealerts.com. Link in bio!`;
  }

  return `Check out ${title} on allfreealerts.com!`;
}

// Generate TTS audio using edge-tts
async function generateVoice(text, outputPath) {
  const EdgeTTS = require('edge-tts');
  const tts = new EdgeTTS();
  // Use a clear, engaging voice
  await tts.synthesize(text, 'en-US-AriaNeural', {
    rate: '+5%',
    pitch: '+0Hz'
  });
  await tts.toFile(outputPath);
  console.log(`  🗣️  Voice generated: ${path.basename(outputPath)}`);
}

// Generate a simple background music beat using FFmpeg
function generateMusic(durationSec, outputPath) {
  // Create a chill lo-fi style background tone using FFmpeg's audio synthesis
  // Layer a soft pad with a subtle beat
  const cmd = `ffmpeg -y -f lavfi -i "sine=frequency=220:duration=${durationSec}" -f lavfi -i "sine=frequency=330:duration=${durationSec}" -f lavfi -i "sine=frequency=440:duration=${durationSec}" -filter_complex "[0:a]volume=0.03[a1];[1:a]volume=0.02[a2];[2:a]volume=0.015[a3];[a1][a2][a3]amix=inputs=3:duration=longest,lowpass=f=800,afade=t=in:st=0:d=1,afade=t=out:st=${durationSec - 2}:d=2[out]" -map "[out]" -t ${durationSec} "${outputPath}" 2>nul`;
  execSync(cmd, { timeout: 15000 });
  console.log(`  🎵 Background music generated`);
}

// Combine image + voice + music into video
function createVideo(imagePath, voicePath, musicPath, outputPath, durationSec) {
  // Get voice duration
  const probeCmd = `ffprobe -v error -show_entries format=duration -of csv=p=0 "${voicePath}"`;
  const voiceDuration = parseFloat(execSync(probeCmd, { encoding: 'utf8' }).trim());
  const totalDuration = Math.max(voiceDuration + 3, 10); // At least 10 seconds, voice + 3s buffer

  // Create video: image with slow zoom + voice + music
  // zoompan creates a slow Ken Burns zoom effect
  const cmd = `ffmpeg -y -loop 1 -i "${imagePath}" -i "${voicePath}" -i "${musicPath}" -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+0.0008,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(totalDuration * 25)}:s=1080x1920:fps=25[v];[1:a]adelay=1500|1500,volume=1.2[voice];[2:a]volume=0.15[music];[voice][music]amix=inputs=2:duration=first[aout]" -map "[v]" -map "[aout]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -t ${totalDuration} -shortest "${outputPath}" 2>nul`;

  execSync(cmd, { timeout: 60000 });
  console.log(`  🎬 Video created: ${path.basename(outputPath)} (${Math.round(totalDuration)}s)`);
}

async function main() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  // Read input
  const arg = process.argv[2];
  let posts;
  if (arg && arg.endsWith('.json') && fs.existsSync(arg)) {
    posts = JSON.parse(fs.readFileSync(arg, 'utf8'));
  } else if (arg) {
    posts = JSON.parse(arg);
  } else {
    // Default: read from the last generated images input
    const inputPath = path.join(IMG_DIR, 'input.json');
    posts = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  }

  if (!Array.isArray(posts)) posts = [posts];

  console.log(`\n🎬 Generating ${posts.length} TikTok videos...\n`);

  // First generate images if they don't exist
  for (let i = 0; i < posts.length; i++) {
    const imgPath = path.join(IMG_DIR, `post_${i}.png`);
    if (!fs.existsSync(imgPath)) {
      console.log(`  Generating image for post ${i}...`);
      const imgScript = path.join(__dirname, 'generate_post_image.js');
      const tmpInput = path.join(IMG_DIR, 'input.json');
      fs.writeFileSync(tmpInput, JSON.stringify(posts));
      execSync(`node "${imgScript}" "${tmpInput}"`, { timeout: 30000 });
    }
  }

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    console.log(`\n--- ${post.category.toUpperCase()} ---`);

    const imgPath = path.join(IMG_DIR, `post_${i}.png`);
    const voicePath = path.join(TMP_DIR, `voice_${i}.mp3`);
    const musicPath = path.join(TMP_DIR, `music_${i}.mp3`);
    const videoPath = path.join(TMP_DIR, `tiktok_${i}.mp4`);

    // Step 1: Generate voiceover
    const script = getVoiceScript(post);
    console.log(`  Script: "${script}"`);
    await generateVoice(script, voicePath);

    // Step 2: Generate background music
    generateMusic(20, musicPath);

    // Step 3: Combine into video
    createVideo(imgPath, voicePath, musicPath, videoPath, 15);

    console.log(`  ✅ Done: ${videoPath}`);
  }

  console.log(`\n========================================`);
  console.log(`  ${posts.length} TikTok videos ready!`);
  console.log(`  Location: ${TMP_DIR}`);
  console.log(`========================================\n`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
