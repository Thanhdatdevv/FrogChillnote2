const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lưu trữ danh sách nhiều lệnh khác nhau
let notes = {};

// 1. Giao diện chỉnh sửa cho từng lệnh cụ thể
app.get('/note/:id', (req, res) => {
    const noteId = req.params.id;
    const content = notes[noteId] || `// Hãy dán mã nguồn của lệnh [${noteId}] vào đây...`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Sửa Lệnh: ${noteId}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { margin: 0; background: #0d1117; color: #c9d1d9; font-family: sans-serif; padding: 15px; }
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
                .title { font-weight: bold; font-size: 18px; color: #58a6ff; }
                .status { font-size: 12px; color: #8b949e; background: #21262d; padding: 4px 8px; border-radius: 12px; margin-left: 10px; }
                .btn-group { display: flex; gap: 8px; }
                .btn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 14px; cursor: pointer; }
                .btn-blue { background: #238636; border: none; }
                textarea { width: 100%; height: calc(100vh - 100px); background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 12px; box-sizing: border-box; font-family: monospace; font-size: 14px; resize: none; outline: none; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <span class="title">Lệnh: ${noteId}</span>
                    <span id="status" class="status">Ready</span>
                </div>
                <div class="btn-group">
                    <a href="/raw/${noteId}" class="btn" target="_blank">Raw</a>
                    <button class="btn btn-blue" onclick="copyText()">Copy Code</button>
                </div>
            </div>
            <textarea id="editor" placeholder="// Viết code ở đây...">${content}</textarea>

            <script>
                const editor = document.getElementById('editor');
                const status = document.getElementById('status');
                let timeout = null;

                editor.addEventListener('input', () => {
                    status.innerText = 'Typing...';
                    clearTimeout(timeout);

                    timeout = setTimeout(() => {
                        status.innerText = 'Saving...';
                        fetch('/api/note/${noteId}', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: editor.value })
                        })
                        .then(res => res.json())
                        .then(data => {
                            if(data.status === 'success') {
                                status.innerText = 'Ready';
                            } else {
                                status.innerText = 'Error';
                            }
                        })
                        .catch(() => status.innerText = 'Connection Error');
                    }, 1000); // Tự động lưu sau 1 giây
                });

                function copyText() {
                    editor.select();
                    document.execCommand('copy');
                    alert('Đã copy toàn bộ code lệnh!');
                }
            </script>
        </body>
        </html>
    `);
});

// 2. API lấy code thô (Raw)
app.get('/raw/:id', (req, res) => {
    const noteId = req.params.id;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(notes[noteId] || "");
});

// 3. API POST lưu code
app.post('/api/note/:id', (req, res) => {
    const noteId = req.params.id;
    const { content } = req.body;
    notes[noteId] = content || "";
    res.json({ status: "success" });
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
