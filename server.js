const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000; // Use Render's dynamic port

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure streams directory exists
const streamsDir = path.join(__dirname, 'public', 'streams');
if (!fs.existsSync(streamsDir)) {
    fs.mkdirSync(streamsDir, { recursive: true });
}

let ffmpegProcess = null;

app.post('/start-restream', (req, res) => {
    const { m3u8Url } = req.body;

    // Server-side validation
    if (!m3u8Url || !m3u8Url.match(/\.m3u8$/)) {
        return res.status(400).json({ error: 'Invalid M3U8 URL. Must end with .m3u8' });
    }

    // Terminate any existing FFmpeg process
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
        ffmpegProcess = null;
    }

    // Define output path for HLS files
    const outputFileName = 'restream.m3u8';
    const outputPath = path.join(streamsDir, outputFileName);
    const segmentPath = path.join(streamsDir, 'restream_%03d.ts');

    // Start FFmpeg process
    ffmpegProcess = spawn('ffmpeg', [
        '-i', m3u8Url,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-f', 'hls',
        '-hls_time', '10',
        '-hls_list_size', '6',
        '-hls_segment_filename', segmentPath,
        '-hls_flags', 'delete_segments',
        outputPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    // Log FFmpeg errors
    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg stderr: ${data}`);
    });

    // Handle FFmpeg process exit
    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        ffmpegProcess = null;
        // Clean up old segments
        fs.readdir(streamsDir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                if (file.startsWith('restream_') && file.endsWith('.ts')) {
                    fs.unlink(path.join(streamsDir, file), () => {});
                }
            });
        });
    });

    // Check if FFmpeg started successfully
    setTimeout(() => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
            const restreamUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/streams/${outputFileName}`;
            res.json({ restreamUrl });
        } else {
            res.status(500).json({ error: 'Failed to start restream. Check FFmpeg logs.' });
        }
    }, 2000); // Wait 2 seconds to ensure FFmpeg initializes
});

// Error handling for invalid routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Clean up on server shutdown
process.on('SIGTERM', () => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
    process.exit(0);
});
