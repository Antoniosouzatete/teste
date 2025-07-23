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

let ffmpegProcesses = new Map();

function cleanupProcess(streamId) {
    const process = ffmpegProcesses.get(streamId);
    if (process) {
        process.kill('SIGTERM');
        ffmpegProcesses.delete(streamId);
        fs.readdir(streamsDir, (err, files) => {
            if (err) return;
            files.forEach(file => {
                if (file.startsWith(`${streamId}_`) && file.endsWith('.ts')) {
                    fs.unlink(path.join(streamsDir, file), () => {});
                }
            });
        });
    }
}

app.post('/generate-restream', (req, res) => {
    const { m3uContent } = req.body;

    if (!m3uContent) {
        return res.status(400).json({ error: 'Por favor, forneça o conteúdo da lista M3U.' });
    }

    // Limpar processos anteriores
    ffmpegProcesses.forEach((_, id) => cleanupProcess(id));

    try {
        const lines = m3uContent.split('\n');

        let newM3uContent = '#EXTM3U\n';
        const streamIds = new Map();

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXTINF:')) {
                const title = lines[i].match(/,(.+)/)[1];
                const url = lines[i + 1].trim();
                if (url && (url.match(/\.m3u8|\.ts$/) || url.includes('get.php'))) {
                    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    streamIds.set(url, streamId);

                    const outputFileName = `${streamId}.m3u8`;
                    const outputPath = path.join(streamsDir, outputFileName);
                    const segmentPath = path.join(streamsDir, `${streamId}_%03d.ts`);

                    const ffmpegProcess = spawn('ffmpeg', [
                        '-i', url,
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
                        console.error(`FFmpeg stderr (${streamId}): ${data}`);
                    });

                    ffmpegProcess.on('close', (code) => {
                        console.log(`FFmpeg process ${streamId} exited with code ${code}`);
                        cleanupProcess(streamId);
                    });

                    ffmpegProcesses.set(streamId, ffmpegProcess);

                    const restreamUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/streams/${outputFileName}`;
                    newM3uContent += `#EXTINF:-1,${title}\n${restreamUrl}\n`;
                }
            }
        }

        const newM3uPath = path.join(streamsDir, 'restream.m3u');
        fs.writeFileSync(newM3uPath, newM3uContent);

        const downloadUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/streams/restream.m3u`;
        res.json({ m3uUrl: downloadUrl });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao processar a lista M3U. Verifique o conteúdo e os logs. Detalhes: ' + error.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});

process.on('SIGTERM', () => {
    ffmpegProcesses.forEach((_, id) => cleanupProcess(id));
    process.exit(0);
});
