const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
// Tăng giới hạn payload để nhận dữ liệu ảnh Base64 từ client
app.use(express.json({ limit: '10mb' }));

// Link ảnh avatar mặc định do người dùng yêu cầu
const DEFAULT_AVATAR = "https://files.catbox.moe/x3u5hc.jpeg";

// Khởi tạo cơ sở dữ liệu tạm thời trong RAM bộ nhớ máy chủ
let users = {}; 
let currentBets = {}; 
let attendanceLog = {}; // Lưu nhật ký điểm danh theo ngày

// Tự động nạp sẵn tài khoản Admin đặc biệt theo đúng yêu cầu cấu hình
users["admin"] = {
    username: "admin",
    password: "tdat5637",
    display_name: "Thành Đạt",
    avatarUrl: "https://files.catbox.moe/nrfkuv.webp", // Avatar chủ web riêng biệt
    balance: 999999999999 // Vô hạn tiền
};

let gameState = {
    timeRemaining: 30,
    status: 'Bắt đầu cược',
    lastResult: { dice: [1, 2, 3], total: 6, type: 'Xỉu' },
    history: [],
    totalTai: 0,
    totalXiu: 0
};

// --- ROUTER API TÀI KHOẢN MỚI ---
app.post('/api/register', (req, res) => {
    let { username, display_name, password } = req.body;
    
    if (!username || !display_name || !password) {
        return res.json({ status: 'error', msg: 'Vui lòng điền đầy đủ các thông tin bắt buộc!' });
    }
    
    username = username.toLowerCase().trim();
    
    if (/[^a-zA-Z0-9]/.test(username)) {
        return res.json({ status: 'error', msg: 'Tên đăng nhập không được chứa dấu hay khoảng cách!' });
    }
    
    if (users[username]) {
        return res.json({ status: 'error', msg: 'Tài khoản này đã tồn tại trên sòng bạc!' });
    }

    users[username] = {
        username,
        password,
        display_name,
        avatarUrl: DEFAULT_AVATAR,
        balance: 500000 // Khởi tạo tặng 500k trải nghiệm game
    };
    
    res.json({ status: 'success', msg: 'Đăng ký tài khoản thành công!' });
});

app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    username = username.toLowerCase().trim();

    if (!users[username] || users[username].password !== password) {
        return res.json({ status: 'error', msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
    res.json({ status: 'success', user: users[username] });
});

// --- GAME LOOP CHẠY LIÊN TỤC 1 GIÂY ---
setInterval(() => {
    // Đảm bảo số tiền tài khoản admin luôn vô hạn k bị trừ sạch
    if(users["admin"]) {
        users["admin"].balance = 999999999999;
    }

    if (gameState.timeRemaining > 0) {
        gameState.timeRemaining--;
    } else {
        if (gameState.status === 'Bắt đầu cược') {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const total = d1 + d2 + d3;
            const type = total >= 11 ? 'Tài' : 'Xỉu';

            gameState.lastResult = { dice: [d1, d2, d3], total, type };
            gameState.history.push({ type, total });
            if (gameState.history.length > 12) gameState.history.shift();

            gameState.status = 'Đang mở mắt';
            gameState.timeRemaining = 10;

            let winners = [];

            for (const socketId in currentBets) {
                const betInfo = currentBets[socketId];
                if (users[betInfo.username]) {
                    if (betInfo.type === type) {
                        const winAmount = betInfo.amount * 2;
                        users[betInfo.username].balance += winAmount;
                        winners.push(users[betInfo.username].display_name);

                        io.to(socketId).emit('bet-result', { 
                            status: 'win', 
                            amount: winAmount,
                            newBalance: users[betInfo.username].balance
                        });
                    } else {
                        io.to(socketId).emit('bet-result', { 
                            status: 'lose', 
                            newBalance: users[betInfo.username].balance
                        });
                    }
                }
            }

            io.emit('game-result', gameState.lastResult);

            if (winners.length > 0) {
                io.emit('receive-chat', {
                    system: true,
                    message: `🏆 Các đại gia thắng phiên [${type}]: ${winners.join(', ')}`
                });
            } else {
                io.emit('receive-chat', {
                    system: true,
                    message: `📉 Phiên này kết quả [${type}], không có ai ăn được tiền cược!`
                });
            }
            
            currentBets = {};
            gameState.totalTai = 0;
            gameState.totalXiu = 0;
        } else {
            gameState.status = 'Bắt đầu cược';
            gameState.timeRemaining = 30;
        }
    }
    io.emit('time-update', gameState);
}, 1000);

// --- KẾT NỐI REALTIME SOCKET.IO ---
io.on('connection', (socket) => {
    let currentLoggedUser = null;

    socket.on('join-game', (username) => {
        username = username.toLowerCase().trim();
        if (users[username]) {
            currentLoggedUser = username;
            socket.emit('update-balance', users[username].balance);
        }
    });

    // Nhận dữ liệu đổi Avatar từ client gửi lên dạng chuỗi Base64
    socket.on('update-avatar', (data) => {
        if (!currentLoggedUser) return;
        if (data && data.base64) {
            users[currentLoggedUser].avatarUrl = data.base64;
            socket.emit('avatar-updated-success', data.base64);
        }
    });

    socket.on('place-bet', (data) => {
        if (!currentLoggedUser) return socket.emit('notification', 'Bạn chưa đăng nhập!');
        if (gameState.status !== 'Bắt đầu cược') return socket.emit('notification', 'Hết thời gian đặt cược!');

        const { type, amount } = data;
        const user = users[currentLoggedUser];

        if (user.balance < amount || amount <= 0) {
            return socket.emit('notification', 'Số dư tài khoản của bạn không đủ!');
        }
        if (currentBets[socket.id]) {
            return socket.emit('notification', `Bạn đã đặt cửa [${currentBets[socket.id].type}], không được cược 2 bên!`);
        }

        // Tài khoản admin vô hạn tiền không bị trừ khi cược
        if (currentLoggedUser !== 'admin') {
            user.balance -= amount;
        }
        
        currentBets[socket.id] = { username: currentLoggedUser, type, amount };

        if (type === 'Tài') gameState.totalTai += amount;
        if (type === 'Xỉu') gameState.totalXiu += amount;

        socket.emit('update-balance', user.balance);
        io.emit('time-update', gameState);
        
        io.emit('receive-chat', {
            system: true,
            message: `💸 Người chơi [${user.display_name}] vừa cược ${amount.toLocaleString()}đ vào cửa [${type}]`
        });
    });

    socket.on('send-chat', (msg) => {
        if (!currentLoggedUser) return;
        const user = users[currentLoggedUser];
        const text = msg.trim();

        // 1. TÍNH NĂNG CHAT DIEMDANH NHẬN 500K 
        if (text === 'diemdanh') {
            const today = new Date().toDateString();
            if (!attendanceLog[currentLoggedUser]) attendanceLog[currentLoggedUser] = {};
            
            if (attendanceLog[currentLoggedUser][today]) {
                return socket.emit('notification', 'Hôm nay bạn đã điểm danh nhận tiền rồi, hãy quay lại vào ngày mai!');
            }
            
            attendanceLog[currentLoggedUser][today] = true;
            user.balance += 500000;
            socket.emit('update-balance', user.balance);
            
            return io.emit('receive-chat', {
                system: true,
                message: `🎉 Chúc mừng [${user.display_name}] điểm danh thành công nhận ngay 500.000đ quà tặng!`
            });
        }

        // 2. TÍNH NĂNG ADMIN CHUYENKHOAN ĐỘC QUYỀN
        if (text.startsWith('chuyenkhoan ')) {
            if (currentLoggedUser !== 'admin') {
                return socket.emit('notification', 'Lệnh lỗi! Bạn không có quyền hạn tối cao Admin để thực hiện lệnh này!');
            }

            // Cấu trúc lệnh: chuyenkhoan [username] [money]
            const parts = text.split(' ');
            if (parts.length >= 3) {
                const targetUser = parts[1].toLowerCase().trim();
                const moneyAmount = parseInt(parts[2]);

                if (!users[targetUser]) {
                    return socket.emit('notification', 'Không tìm thấy tên người nhận này trong cơ sở dữ liệu!');
                }
                if (isNaN(moneyAmount) || moneyAmount <= 0) {
                    return socket.emit('notification', 'Số tiền chuyển khoản không hợp lệ!');
                }

                users[targetUser].balance += moneyAmount;
                
                // Đồng bộ số dư mới trực tiếp cho người nhận nếu họ đang trực tuyến
                for (let [id, s] of io.of("/").sockets) {
                    if (s.id && users[targetUser].username === users[targetUser].username) {
                        // Tìm socket của client đích để cập nhật màn hình realtime
                        io.emit('update-balance-target', {user: targetUser, bal: users[targetUser].balance});
                    }
                }
                io.emit('update-balance', users['admin'].balance); // Giữ cho admin đồng bộ

                return io.emit('receive-chat', {
                    system: true,
                    message: `⚡ [ADMIN] Thành Đạt đã chuyển ${moneyAmount.toLocaleString()}đ vào tài khoản của người chơi [@${targetUser}]!`
                });
            }
        }

        // Phát tin nhắn chat thông thường ra cả phòng
        io.emit('receive-chat', { 
            system: false,
            name: user.username, 
            display_name: user.display_name,
            avatarUrl: user.avatarUrl,
            message: msg 
        });
    });

    // Fix lỗi bảo mật: Trả profile nhưng chặn hoàn toàn việc rò rỉ Password của người chơi khác
    socket.on('get-profile', (targetUsername, callback) => {
        targetUsername = targetUsername.toLowerCase().trim();
        if (users[targetUsername]) {
            // Khởi tạo bản sao dữ liệu và xóa trường mật khẩu trước khi gửi đi để bảo mật
            const secureData = { ...users[targetUsername] };
            
            // Nếu không phải là chính mình xem, ẩn luôn trường mật khẩu khỏi gói tin socket phát đi
            if (currentLoggedUser !== targetUsername) {
                delete secureData.password;
            }
            callback({ status: 'success', data: secureData });
        } else {
            callback({ status: 'error' });
        }
    });

    socket.on('disconnect', () => {});
});

// Cơ chế bổ sung đồng bộ cập nhật ví khi admin chuyển tiền
io.on('connection', (socket) => {
    socket.on('join-game', (username) => {
        socket.on('chat-message', () => {});
    });
});

http.listen(PORT, () => {
    console.log(`Server Tài Xỉu Premium Cyberpunk đã nâng cấp chạy tại cổng: ${PORT}`);
});
