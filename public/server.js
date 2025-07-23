const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const streamsDir = path.join(__dirname, 'public', 'streams');
if (!fs.existsSync(streamsDir)) {
    fs.mkdirSync(streamsDir, { recursive: true });
}

let ffmpegProcess = null;

app.post('/start-restream', (req, res) => {
    const { m3u8Url } = req.body;

    if (!m3u8Url || !m3u8Url.match(/\.m3u8$/)) {
        return res.status(400).json({ error: 'URL M3U8 inválida. Deve terminar com .m3u8' });
    }

    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
        ffmpegProcess = null;
    }

    const outputFileName = 'restream.m3u8';
    const outputPath = path.join(streamsDir, outputFileName);
    const segmentPath = path.join(streamsDir, 'restream_%03d.ts');

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

    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        ffmpegProcess = null;
        fs.readdir(streamsDir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                if (file.startsWith('restream_') && file.endsWith('.ts')) {
                    fs.unlink(path.join(streamsDir, file), () => {});
                }
            });
        });
    });

    setTimeout(() => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
            const restreamUrl = `http://${process.env.HOST || 'localhost'}:${port}/streams/${outputFileName}`;
            res.json({ restreamUrl });
        } else {
            res.status(500).json({ error: 'Falha ao iniciar o restream. Verifique os logs do FFmpeg.' });
        }
    }, 2000);
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});

process.on('SIGTERM', () => {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
    process.exit(0);
});
